//! Texture IO adapters: one pathway for every external video endpoint. Addressed
//! `<adapter>:<name>`; each adapter is a Cargo feature (crate behind it). Textures stay on
//! the GPU (Syphon = IOSurface); nothing is read back to the CPU here.

use anyhow::{Result, bail};

/// External texture in (TouchDesigner via Syphon, camera, NDI, ...).
pub trait TexSource {
    /// Pull the newest frame if any (call once per frame).
    fn poll(&mut self, device: &wgpu::Device, queue: &wgpu::Queue);
    /// current frame (None until the first arrives)
    fn tex(&self) -> Option<&wgpu::Texture>;
    fn live(&self) -> bool;
}

/// External texture out; `publish` is called once per rendered frame.
pub trait TexSink {
    fn publish(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture);
    /// connected consumers
    fn clients(&self) -> usize;
    /// seen by other apps (directory listing)
    fn visible(&self) -> bool;
    /// resolved endpoint name
    fn name(&self) -> &str;
}

/// Multichannel f32 sample stream, pulled by an audio sink's realtime callback (must not
/// allocate/block). Per period: `fill` each channel from the same start, then `advance`.
pub trait AudioSource: Send {
    fn fill(&mut self, ch: usize, rate: f32, buf: &mut [f32]);
    fn advance(&mut self, rate: f32, frames: usize);
}

/// External audio out (JACK, ...): plays its `AudioSource`.
pub trait AudioSink {
    fn clients(&self) -> usize;
    fn visible(&self) -> bool;
    fn name(&self) -> &str;
}

/// Compiled-in texture adapters (features).
pub fn tex_adapters() -> Vec<&'static str> {
    let mut v = vec![];
    if cfg!(feature = "syphon") {
        v.push("syphon");
    }
    if cfg!(feature = "camera") {
        v.push("camera");
    }
    v
}

/// Compiled-in audio adapters (features).
pub fn audio_adapters() -> Vec<&'static str> {
    let mut v = vec![];
    if cfg!(feature = "jack") {
        v.push("jack");
    }
    v
}

/// All compiled-in adapters.
pub fn adapters() -> Vec<&'static str> {
    [tex_adapters(), audio_adapters()].concat()
}

fn split(addr: &str) -> (&str, &str) {
    addr.split_once(':').unwrap_or((addr, ""))
}

/// `syphon:<server>` (exact server name, as listed by Syphon); `camera:<index>` (device
/// index, empty -> 0).
pub fn source(device: &wgpu::Device, queue: &wgpu::Queue, addr: &str) -> Result<Box<dyn TexSource>> {
    let _ = (device, queue);
    match split(addr) {
        #[cfg(feature = "syphon")]
        ("syphon", name) => {
            let mut i = syphon_wgpu::SyphonWgpuInput::new(device, queue);
            i.connect(name).map_err(|e| anyhow::anyhow!("syphon {name:?}: {e} (servers: {:?})", syphon_wgpu::list_servers()))?;
            Ok(Box::new(i))
        }
        #[cfg(feature = "camera")]
        ("camera", index) => Ok(Box::new(camera_in::Camera::open(index)?)),
        (a, _) => bail!("unknown texture source adapter {a:?} (compiled: {:?})", adapters()),
    }
}

/// `syphon:<server>`; empty name -> `default`.
pub fn sink(device: &wgpu::Device, queue: &wgpu::Queue, addr: &str, default: &str, w: u32, h: u32) -> Result<Box<dyn TexSink>> {
    let _ = (device, queue, w, h);
    let (a, name) = split(addr);
    let name = if name.is_empty() { default } else { name };
    let _ = name;
    match a {
        #[cfg(feature = "syphon")]
        "syphon" => Ok(Box::new(syphon_wgpu::SyphonWgpuOutput::new(name, device, queue, w, h)?)),
        a => bail!("unknown texture sink adapter {a:?} (compiled: {:?})", adapters()),
    }
}

#[cfg(feature = "syphon")]
impl TexSource for syphon_wgpu::SyphonWgpuInput {
    fn poll(&mut self, device: &wgpu::Device, queue: &wgpu::Queue) {
        self.receive_texture(device, queue);
    }
    fn tex(&self) -> Option<&wgpu::Texture> {
        self.output_texture()
    }
    fn live(&self) -> bool {
        self.is_connected()
    }
}

#[cfg(feature = "syphon")]
impl TexSink for syphon_wgpu::SyphonWgpuOutput {
    fn publish(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture) {
        syphon_wgpu::SyphonWgpuOutput::publish(self, tex, device, queue);
    }
    fn clients(&self) -> usize {
        self.client_count()
    }
    fn visible(&self) -> bool {
        syphon_wgpu::list_servers().iter().any(|s| s == self.name())
    }
    fn name(&self) -> &str {
        syphon_wgpu::SyphonWgpuOutput::name(self)
    }
}


/// `jack:<client>`; empty name -> `default`; `channels` out ports fed by `src`.
pub fn audio_sink(addr: &str, default: &str, channels: u32, src: Box<dyn AudioSource>) -> Result<Box<dyn AudioSink>> {
    let _ = (channels, &src);
    let (a, name) = split(addr);
    let name = if name.is_empty() { default } else { name };
    let _ = name;
    match a {
        #[cfg(feature = "jack")]
        "jack" => Ok(Box::new(jack_out::Jack::new(name, channels, src)?)),
        a => bail!("unknown audio sink adapter {a:?} (compiled: {:?})", audio_adapters()),
    }
}

#[cfg(feature = "jack")]
mod jack_out {
    use anyhow::{Result, anyhow};

    use super::AudioSource;

    pub struct Jack {
        client: jack::AsyncClient<(), Process>,
        name: String,
    }

    struct Process {
        ports: Vec<jack::Port<jack::AudioOut>>,
        src: Box<dyn AudioSource>,
    }

    impl jack::ProcessHandler for Process {
        fn process(&mut self, c: &jack::Client, ps: &jack::ProcessScope) -> jack::Control {
            let rate = c.sample_rate() as f32;
            for (ch, p) in self.ports.iter_mut().enumerate() {
                self.src.fill(ch, rate, p.as_mut_slice(ps));
            }
            self.src.advance(rate, ps.n_frames() as usize);
            jack::Control::Continue
        }
    }

    impl Jack {
        pub fn new(name: &str, channels: u32, src: Box<dyn AudioSource>) -> Result<Self> {
            let (client, _) = jack::Client::new(name, jack::ClientOptions::NO_START_SERVER).map_err(|e| anyhow!("jack: {e} (is jackd running?)"))?;
            let name = client.name().to_string();
            let ports = (1..=channels.clamp(1, 64)).map(|i| client.register_port(&format!("out_{i}"), jack::AudioOut::default())).collect::<Result<Vec<_>, _>>()?;
            Ok(Self { client: client.activate_async((), Process { ports, src })?, name })
        }

        fn ports(&self) -> Vec<String> {
            self.client.as_client().ports(Some(&format!("^{}:", self.name)), None, jack::PortFlags::empty())
        }
    }

    impl super::AudioSink for Jack {
        fn clients(&self) -> usize {
            let c = self.client.as_client();
            self.ports().iter().filter_map(|p| c.port_by_name(p)).filter(|p| p.connected_count().unwrap_or(0) > 0).count()
        }
        fn visible(&self) -> bool {
            !self.ports().is_empty()
        }
        fn name(&self) -> &str {
            &self.name
        }
    }
}

/// `camera:<index>` webcam source (nokhwa `input-native`: AVFoundation on macOS). Frames
/// decode off-thread (`output-threaded` callback camera) into a shared RGBA buffer; `poll`
/// (render thread) swizzles to BGRA and uploads to our own wgpu texture — we don't use
/// nokhwa's `output-wgpu` feature, which pins wgpu ^27 against this crate's wgpu 30.
#[cfg(feature = "camera")]
mod camera_in {
    use std::sync::{Arc, Mutex, Once, mpsc};

    use anyhow::{Result, anyhow};
    use nokhwa::{
        nokhwa_initialize,
        pixel_format::RgbAFormat,
        threaded::CallbackCamera,
        utils::{CameraIndex, RequestedFormat, RequestedFormatType},
    };

    struct Frame {
        w: u32,
        h: u32,
        rgba: Vec<u8>,
    }

    pub struct Camera {
        // kept alive: owns the callback thread + device
        _cam: CallbackCamera,
        latest: Arc<Mutex<Option<Frame>>>,
        tex: Option<wgpu::Texture>,
    }

    /// macOS: `nokhwa_initialize` triggers the AVFoundation permission prompt (first run) and
    /// must run before any camera is opened; only once per process. Denied / timed-out
    /// permission surfaces as an error here, never a panic.
    fn ensure_permission() -> Result<()> {
        static ONCE: Once = Once::new();
        static mut GRANTED: Option<bool> = None;
        let (tx, rx) = mpsc::channel();
        let mut called = false;
        ONCE.call_once(|| {
            called = true;
            nokhwa_initialize(move |granted| {
                let _ = tx.send(granted);
                unsafe { GRANTED = Some(granted) };
            });
        });
        if !called {
            // a prior call already initialized the process; reuse its result if we have one,
            // otherwise assume it succeeded (nokhwa has no re-query API).
            return match unsafe { GRANTED } {
                Some(false) => Err(anyhow!("camera: permission previously denied (System Settings > Privacy & Security > Camera)")),
                _ => Ok(()),
            };
        }
        match rx.recv_timeout(std::time::Duration::from_secs(15)) {
            Ok(true) => Ok(()),
            Ok(false) => Err(anyhow!("camera: permission denied (System Settings > Privacy & Security > Camera)")),
            Err(_) => Err(anyhow!("camera: permission prompt timed out waiting for a response")),
        }
    }

    impl Camera {
        pub fn open(index: &str) -> Result<Self> {
            let idx: u32 = if index.is_empty() { 0 } else { index.parse().map_err(|_| anyhow!("camera: index {index:?} must be a number"))? };
            ensure_permission()?;
            let latest = Arc::new(Mutex::new(None));
            let sink = latest.clone();
            let requested = RequestedFormat::new::<RgbAFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
            let mut cam = CallbackCamera::new(CameraIndex::Index(idx), requested, move |buf| {
                if let Ok(img) = buf.decode_image::<RgbAFormat>() {
                    let (w, h) = (img.width(), img.height());
                    *sink.lock().expect("camera frame lock") = Some(Frame { w, h, rgba: img.into_raw() });
                }
            })
            .map_err(|e| anyhow!("camera {idx}: {e} (no such device, or denied by the OS)"))?;
            cam.open_stream().map_err(|e| anyhow!("camera {idx}: open_stream: {e}"))?;
            Ok(Self { _cam: cam, latest, tex: None })
        }
    }

    /// RGBA (nokhwa decode) -> BGRA (our target format, `crate::FORMAT`).
    fn bgra(rgba: &[u8]) -> Vec<u8> {
        let mut out = rgba.to_vec();
        for px in out.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        out
    }

    impl super::TexSource for Camera {
        fn poll(&mut self, device: &wgpu::Device, queue: &wgpu::Queue) {
            let Some(Frame { w, h, rgba }) = self.latest.lock().expect("camera frame lock").take() else { return };
            if self.tex.as_ref().map(|t| t.width() != w || t.height() != h).unwrap_or(true) {
                self.tex = Some(crate::target(device, w, h));
            }
            queue.write_texture(
                wgpu::TexelCopyTextureInfo { texture: self.tex.as_ref().expect("just set"), mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                &bgra(&rgba),
                wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w * 4), rows_per_image: Some(h) },
                wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            );
        }
        fn tex(&self) -> Option<&wgpu::Texture> {
            self.tex.as_ref()
        }
        fn live(&self) -> bool {
            self.tex.is_some()
        }
    }

    #[cfg(test)]
    mod tests {
        //! No camera / no permission in CI -> `open` returns a clear `Err` (never panics);
        //! skip the texture assertions in that case instead of failing the suite.
        use super::*;

        #[test]
        fn opens_or_fails_clearly_without_panicking() {
            let (device, queue) = crate::device().expect("headless metal device");
            match Camera::open("0") {
                Ok(mut cam) => {
                    for _ in 0..5 {
                        <Camera as super::super::TexSource>::poll(&mut cam, &device, &queue);
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    // a real device may not have produced a frame yet in 250ms; just confirm
                    // the handle is alive and `tex()`/`live()` don't panic either way.
                    let _ = (<Camera as super::super::TexSource>::tex(&cam), <Camera as super::super::TexSource>::live(&cam));
                }
                Err(e) => {
                    let msg = e.to_string();
                    assert!(msg.contains("camera"), "expected a camera-prefixed error, got {msg:?}");
                    eprintln!("no camera available in this environment, skipping: {msg}");
                }
            }
        }

        #[test]
        fn bad_index_errors_without_panicking() {
            match Camera::open("not-a-number") {
                Ok(_) => panic!("non-numeric index must error, not open a camera"),
                Err(e) => assert!(e.to_string().contains("index")),
            }
        }
    }
}
