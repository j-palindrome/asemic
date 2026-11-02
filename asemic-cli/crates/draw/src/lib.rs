//! asemic-draw: draw prep after brain arrays (postprocess, shaders) → headless wgpu → Syphon.
//! Plan §8.4, §11.7. Syphon via `syphon-wgpu` (wgpu 30).

pub mod ascii;
pub mod graph;
pub mod host;
pub mod mesh;
pub mod io;
pub mod post;
pub mod scope;

/// Headless Metal device for draw + Syphon.
pub fn device() -> anyhow::Result<(wgpu::Device, wgpu::Queue)> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::METAL,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default()))?;
    Ok(pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default()))?)
}

pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Bgra8Unorm;

/// Bgra8Unorm render target Syphon accepts.
pub fn target(device: &wgpu::Device, w: u32, h: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("asemic-draw target"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    })
}

/// Linear-filtered sampler shared by every pass.
pub fn linear_sampler(device: &wgpu::Device) -> wgpu::Sampler {
    device.create_sampler(&wgpu::SamplerDescriptor { mag_filter: wgpu::FilterMode::Linear, min_filter: wgpu::FilterMode::Linear, ..Default::default() })
}

/// Clear `tex` to a colour (spike stand-in for the draw pass).
pub fn clear(device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture, c: wgpu::Color) {
    let view = tex.create_view(&Default::default());
    let mut enc = device.create_command_encoder(&Default::default());
    enc.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: None,
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view: &view,
            depth_slice: None,
            resolve_target: None,
            ops: wgpu::Operations { load: wgpu::LoadOp::Clear(c), store: wgpu::StoreOp::Store },
        })],
        ..Default::default()
    });
    queue.submit([enc.finish()]);
}

/// Syphon discovery = Apple distributed notifications, delivered via the *main* thread's
/// CFRunLoop. Park main here (event-driven, no polling); servers may then be created and
/// published from any thread, at any time (✓ examples/syphon_late_create.rs).
/// A far-future timer keeps the loop alive before any server registers sources.
/// Returns once [`stop_main_run_loop`] is called -- also when that ran before main parked
/// (a bare `CFRunLoop::stop` on a not-yet-running loop is lost: `--verbs` hung forever).
pub fn park_main_in_run_loop() {
    use core_foundation::{date::CFDate, runloop::*};
    extern "C" fn noop(_: CFRunLoopTimerRef, _: *mut std::ffi::c_void) {}
    let keepalive = CFRunLoopTimer::new(CFDate::now().abs_time() + 1e9, 0.0, 0, 0, noop, std::ptr::null_mut());
    CFRunLoop::get_current().add_timer(&keepalive, unsafe { kCFRunLoopDefaultMode });
    while !STOPPED.load(std::sync::atomic::Ordering::SeqCst) {
        CFRunLoop::run_in_mode(unsafe { kCFRunLoopDefaultMode }, std::time::Duration::from_secs(1), false);
    }
}

static STOPPED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Wake the parked main thread so `park_main_in_run_loop` returns (shutdown).
pub fn stop_main_run_loop() {
    STOPPED.store(true, std::sync::atomic::Ordering::SeqCst);
    core_foundation::runloop::CFRunLoop::get_main().stop();
}
