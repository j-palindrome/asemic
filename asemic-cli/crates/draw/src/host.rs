//! Output host: texture adapters (io.rs: Syphon, ...) and JACK (audio) outputs opened/closed by request/response, so
//! sources come and go freely. Owns the wgpu device on a render thread; servers can be
//! created off-main because main is parked in its run loop (lib.rs).

use std::{collections::BTreeMap, sync::mpsc, time::Duration};

use anyhow::{Result, anyhow, bail};
use asemic_font::{CurveBrush, DotBrush, Drawable, LineBrush, Paths, ShaderModifiers, Uniforms, glam::{Vec2, Vec4}};
use asemic_schema::{
    Multi,
    wire::{FRAME_HEAD_LEN, FRAME_MAGIC, TEXT_MAGIC},
};
use tokio::sync::oneshot;

pub const FPS: u64 = 60;
/// terminal preview rate (`asemic/preview/<out>`) and max size (cells: half-blocks = 2 px/row)
pub const PREVIEW_FPS: u64 = 10;
pub const PREVIEW_MAX: (u32, u32) = (160, 90);
/// preview name prefix for texture nodes (stripped on the wire: `asemic/preview/<id>`)
pub const NODE_PREVIEW: &str = "tex/";

/// (preview name, ASF1/AST1 frame) for the brain to put on `asemic/preview/<id>`.
pub type Frames = tokio::sync::mpsc::UnboundedReceiver<(String, Vec<u8>)>;

#[derive(Debug, Clone, serde::Serialize)]
pub struct OutputInfo {
    pub name: String,
    pub kind: String,
    pub server: String,
    pub w: u32,
    pub h: u32,
    /// gen ids (`asemic/gen/<id>`) drawn into this output
    pub src: Vec<String>,
    /// postprocess: "none" / "feedback" (asemic-repl main.wgsl)
    pub post: String,
    pub look: Look,
    pub clients: usize,
    /// seen by other apps (Syphon directory / JACK port graph), checked from the brain
    pub visible: bool,
}

/// Brush + asemic-repl shader modifiers (WGSL bodies, e.g. `return 2.0;`; see brush.rs
/// `build_shader_module` for `info: ModifierInfo`). None = upstream default.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(default)]
pub struct Look {
    /// line / curve / dot (asemic-repl brushes); empty = line
    pub brush: String,
    pub width: Option<String>,
    pub alpha: Option<String>,
    pub brightness: Option<String>,
    pub position: Option<String>,
    /// jack: whole drawing traced hz times/s as x/y audio (oscilloscope); None = 60
    pub hz: Option<f32>,
    /// syphon: publish this texture node (graph.rs) instead of drawing src
    pub node: Option<String>,
}

#[expect(clippy::large_enum_variant, reason = "few long-lived values (per node/output/cmd), !hot path")]
enum Cmd {
    Open { name: String, kind: String, w: u32, h: u32, src: Vec<String>, post: String, look: Look, reply: oneshot::Sender<Result<OutputInfo>> },
    Close { name: String, reply: oneshot::Sender<bool> },
    List { reply: oneshot::Sender<Vec<OutputInfo>> },
    /// terminal preview on/off (brain: Zenoh matching on `asemic/preview/<id>`); name
    /// `tex/<id>` = texture node
    Preview { name: String, on: bool },
    /// viewer's preview box in terminal cells (`asemic_schema::keys::preview_size`, `PreviewSize`); ascii nodes render
    /// their text preview at exactly this grid
    PreviewSize { name: String, cols: u32, rows: u32 },
    /// latest point multiarray of a gen source (ASP1, decoded)
    Points { id: String, m: Multi },
    Node { id: String, spec: crate::graph::NodeSpec, reply: oneshot::Sender<Result<crate::graph::NodeInfo>> },
    NodeClose { id: String, reply: oneshot::Sender<bool> },
    Nodes { reply: oneshot::Sender<Vec<crate::graph::NodeInfo>> },
    /// control scalar -> node uniform `param(i)` (brain: Zenoh `asemic/tex/<id>.param.<i>`)
    Param { id: String, key: String, v: f32 },
    /// per-block timestretch: ts (0.0 = frozen, 1.0 = real-time); graph maps label -> ts
    Timestretch { label: String, ts: f64 },
    ClearTimestretch { label: String },
    /// COOK: play a block for exactly one rendered frame
    Step { label: String },
    /// per-block playhead seconds (brain `asemic/block/<label>.time`); node `info.time`
    BlockTime { label: String, t: f64 },
    ClearBlockTime { label: String },
}

#[expect(clippy::large_enum_variant, reason = "few long-lived values (per node/output/cmd), !hot path")]
enum Sink {
    /// texture adapter (io.rs: syphon, ...)
    /// `dims` = point layout the brush is linked against (relinked when gens change it)
    Tex { sink: Box<dyn crate::io::TexSink>, tex: wgpu::Texture, brush: Box<dyn Drawable + Send>, post: Option<crate::post::Post>, copy: crate::graph::Shader, slots: crate::graph::BrushSlots, dims: Vec<String> },
    /// audio adapter (io.rs: jack, ...) fed by the scope converter
    Audio { sink: Box<dyn crate::io::AudioSink>, pts: crate::scope::Points },
}

struct Out {
    sink: Sink,
    preview: bool,
    info: OutputInfo,
}

impl Out {
    fn info(&self) -> OutputInfo {
        let (clients, visible) = match &self.sink {
            Sink::Tex { sink, .. } => (sink.clients(), sink.visible()),
            Sink::Audio { sink, .. } => (sink.clients(), sink.visible()),
        };
        OutputInfo { clients, visible, ..self.info.clone() }
    }
}

#[derive(Clone)]
pub struct Host(mpsc::Sender<Cmd>);

impl Host {
    pub fn spawn() -> Result<(Self, Frames)> {
        let (tx, rx) = mpsc::channel();
        let (ftx, frx) = tokio::sync::mpsc::unbounded_channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        std::thread::Builder::new().name("asemic-draw".into()).spawn(move || {
            let (device, queue) = match crate::device() {
                Ok(d) => {
                    let _ = ready_tx.send(Ok(()));
                    d
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            render_loop(rx, device, queue, ftx);
        })?;
        ready_rx.recv()??;
        Ok((Self(tx), frx))
    }

    #[expect(clippy::too_many_arguments, reason = "wgpu device/queue/texture plumbing; a params struct would only rename them")]
    pub async fn open(&self, name: &str, kind: &str, w: u32, h: u32, src: Vec<String>, post: &str, look: Look) -> Result<OutputInfo> {
        let (reply, rx) = oneshot::channel();
        self.0.send(Cmd::Open { name: name.into(), kind: kind.into(), w, h, src, post: post.into(), look, reply }).map_err(|_| anyhow!("draw host gone"))?;
        rx.await?
    }

    pub async fn close(&self, name: &str) -> Result<bool> {
        let (reply, rx) = oneshot::channel();
        self.0.send(Cmd::Close { name: name.into(), reply }).map_err(|_| anyhow!("draw host gone"))?;
        Ok(rx.await?)
    }

    /// Feed a gen source's ASP1 buffer (brain forwards `asemic/gen/**`); bad buffers ignored.
    pub fn feed(&self, id: &str, asp1: &[u8]) {
        if let Some((_, m)) = Multi::decode(asp1) {
            let _ = self.0.send(Cmd::Points { id: id.into(), m });
        }
    }

    pub async fn node(&self, id: &str, spec: crate::graph::NodeSpec) -> Result<crate::graph::NodeInfo> {
        let (reply, rx) = oneshot::channel();
        self.0.send(Cmd::Node { id: id.into(), spec, reply }).map_err(|_| anyhow!("draw host gone"))?;
        rx.await?
    }

    pub async fn node_close(&self, id: &str) -> Result<bool> {
        let (reply, rx) = oneshot::channel();
        self.0.send(Cmd::NodeClose { id: id.into(), reply }).map_err(|_| anyhow!("draw host gone"))?;
        Ok(rx.await?)
    }

    pub async fn nodes(&self) -> Result<Vec<crate::graph::NodeInfo>> {
        let (reply, rx) = oneshot::channel();
        self.0.send(Cmd::Nodes { reply }).map_err(|_| anyhow!("draw host gone"))?;
        Ok(rx.await?)
    }

    /// `key` = uniform index or ascii text-atlas axis tag ([`crate::graph::Graph::param`]).
    pub fn param(&self, id: &str, key: &str, v: f32) {
        let _ = self.0.send(Cmd::Param { id: id.into(), key: key.into(), v });
    }

    pub fn timestretch(&self, label: &str, ts: f64) {
        let _ = self.0.send(Cmd::Timestretch { label: label.into(), ts });
    }

    pub fn step_block(&self, label: &str) {
        let _ = self.0.send(Cmd::Step { label: label.into() });
    }

    pub fn clear_timestretch(&self, label: &str) {
        let _ = self.0.send(Cmd::ClearTimestretch { label: label.into() });
    }

    /// Set a block's playhead seconds (brain `asemic/block/<label>.time`).
    pub fn block_time(&self, label: &str, t: f64) {
        let _ = self.0.send(Cmd::BlockTime { label: label.into(), t });
    }

    pub fn clear_block_time(&self, label: &str) {
        let _ = self.0.send(Cmd::ClearBlockTime { label: label.into() });
    }

    pub fn preview(&self, name: &str, on: bool) {
        let _ = self.0.send(Cmd::Preview { name: name.into(), on });
    }

    pub fn preview_size(&self, name: &str, cols: u32, rows: u32) {
        let _ = self.0.send(Cmd::PreviewSize { name: name.into(), cols, rows });
    }

    pub async fn list(&self) -> Result<Vec<OutputInfo>> {
        let (reply, rx) = oneshot::channel();
        self.0.send(Cmd::List { reply }).map_err(|_| anyhow!("draw host gone"))?;
        Ok(rx.await?)
    }
}

/// asemic-repl brush (compiled in place via asemic-font `gpu`) on the output texture,
/// linked against point `dims` (modifiers: `attr(info, DIM_<name>)`).
pub(crate) fn brush(device: &wgpu::Device, w: u32, h: u32, look: &Look, dims: &[String]) -> Result<Box<dyn Drawable + Send>> {
    let m = ShaderModifiers {
        width: look.width.clone(),
        alpha: look.alpha.clone(),
        brightness: look.brightness.clone(),
        position: look.position.clone(),
        particle: None,
    };
    let (f, a) = (crate::FORMAT, h as f32 / w as f32);
    // bad WGSL panics in wgpu's validation; scope it into an error instead
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let b: Box<dyn Drawable + Send> = asemic_font::link::with_dims(dims, || {
        Ok::<Box<dyn Drawable + Send>, anyhow::Error>(match look.brush.as_str() {
            "" | "line" => Box::new(LineBrush::new(device, f, 1, a, m, None)),
            "curve" => Box::new(CurveBrush::new(device, f, 1, a, m, None)),
            "dot" => Box::new(DotBrush::new(device, f, 1, a, m, None)),
            k => bail!("unknown brush {k:?} (line, curve, dot; mesh = draw nodes only)"),
        })
    })?;
    if let Some(e) = asemic_font::link::LINK_ERROR.with(|l| l.borrow_mut().take()) {
        let _ = pollster::block_on(scope.pop());
        bail!("shader modifier wesl: {e}");
    }
    match pollster::block_on(scope.pop()) {
        Some(e) => bail!("shader modifier: {e}"),
        None => Ok(b),
    }
}

/// Builds everything fallible first; `retire` drops the old output (same name) only right
/// before the new sink claims its server name, so a failed reopen keeps the old one.
#[allow(clippy::too_many_arguments)]
fn open(device: &wgpu::Device, queue: &wgpu::Queue, name: &str, kind: &str, w: u32, h: u32, src: Vec<String>, post: &str, look: Look, gens: &BTreeMap<String, Multi>, retire: impl FnOnce()) -> Result<Out> {
    let info = |server: String| OutputInfo { name: name.into(), kind: kind.into(), server, w, h, src: src.clone(), post: post.into(), look: look.clone(), clients: 0, visible: false };
    match kind {
        // audio adapters: src traced as x/y oscilloscope (jack: w = channels, h unused)
        adapter if crate::io::audio_adapters().contains(&adapter) => {
            retire();
            let (scope, pts) = crate::scope::Scope::new(look.hz.unwrap_or(60.0));
            let sink = crate::io::audio_sink(adapter, &format!("asemic-{name}"), w, Box::new(scope))?;
            let server = sink.name().to_string();
            Ok(Out { preview: false, sink: Sink::Audio { sink, pts }, info: info(server) })
        }
        adapter => {
            let post = match post {
                "none" => None,
                "feedback" => Some(crate::post::Post::new(device, queue, w, h)),
                p => bail!("unknown post {p:?} (none, feedback)"),
            };
            let dims = crate::graph::layout(src.iter().filter_map(|g| gens.get(g)), &Default::default()).attrs;
            let brush = brush(device, w, h, &look, &dims)?;
            let server = format!("asemic:{name}");
            if !crate::io::adapters().contains(&adapter) {
                bail!("unknown output kind {adapter:?} ({:?})", crate::io::adapters());
            }
            retire();
            let sink = crate::io::sink(device, queue, adapter, &server, w, h)?;
            let tex = crate::target(device, w, h);
            Ok(Out { preview: false, sink: Sink::Tex { sink, tex, brush, post, copy: crate::graph::Shader::copy(device), slots: crate::graph::BrushSlots::new(device), dims }, info: info(server) })
        }
    }
}

fn render_loop(rx: mpsc::Receiver<Cmd>, device: wgpu::Device, queue: wgpu::Queue, frames: tokio::sync::mpsc::UnboundedSender<(String, Vec<u8>)>) {
    let mut outs: BTreeMap<String, Out> = BTreeMap::new();
    let mut gens: BTreeMap<String, Multi> = BTreeMap::new();
    let mut graph = crate::graph::Graph::default();
    let mut frame = 0u64;
    // texture nodes previewed (`tex/<id>`)
    let mut node_previews = std::collections::BTreeSet::new();
    loop {
        loop {
            match rx.try_recv() {
                Ok(Cmd::Open { name, kind, w, h, src, post, look, reply }) => {
                    // reopen = replace (size/kind change); old kept if the new one fails early
                    let r = open(&device, &queue, &name, &kind, w, h, src, &post, look, &gens, || drop(outs.remove(&name))).map(|o| {
                        let info = o.info.clone();
                        outs.insert(name, o);
                        info
                    });
                    let _ = reply.send(r);
                }
                Ok(Cmd::Close { name, reply }) => {
                    let _ = reply.send(outs.remove(&name).is_some());
                }
                Ok(Cmd::List { reply }) => {
                    let _ = reply.send(outs.values().map(Out::info).collect());
                }
                Ok(Cmd::Preview { name, on }) => {
                    if let Some(id) = name.strip_prefix(NODE_PREVIEW) {
                        if on { node_previews.insert(id.to_string()) } else { node_previews.remove(id) };
                    } else if let Some(o) = outs.get_mut(&name) {
                        o.preview = on;
                    }
                }
                Ok(Cmd::PreviewSize { name, cols, rows }) => {
                    if let Some(id) = name.strip_prefix(NODE_PREVIEW) {
                        graph.preview_grid(id, (cols.max(1), rows.max(1)));
                    }
                }
                Ok(Cmd::Points { id, m }) => {
                    gens.insert(id, m);
                }
                Ok(Cmd::Node { id, spec, reply }) => {
                    let _ = reply.send(graph.open_with(&device, &queue, &id, spec, &gens));
                }
                Ok(Cmd::NodeClose { id, reply }) => {
                    let _ = reply.send(graph.close(&id));
                }
                Ok(Cmd::Nodes { reply }) => {
                    let _ = reply.send(graph.list());
                }
                Ok(Cmd::Param { id, key, v }) => {
                    graph.param(&id, &key, v);
                }
                Ok(Cmd::Timestretch { label, ts }) => graph.timestretch(&label, ts),
                Ok(Cmd::ClearTimestretch { label }) => graph.clear_timestretch(&label),
                Ok(Cmd::Step { label }) => graph.step_block(&label),
                Ok(Cmd::BlockTime { label, t }) => graph.block_time(&label, t),
                Ok(Cmd::ClearBlockTime { label }) => graph.clear_block_time(&label),
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => return,
            }
        }
        frame += 1;
        let t = frame as f64 / FPS as f64;
        graph.render(&device, &queue, &gens, t as f32);
        for (id, e) in graph.take_errors() {
            let _ = frames.send((format!("err/tex/{id}"), e.into_bytes())); // brain -> asemic/err/tex/<id>
        }
        if frame.is_multiple_of(FPS / PREVIEW_FPS) {
            for id in &node_previews {
                // compute node with `text=true` reports sampled values (numbers); ascii nodes
                // report glyphs; every other node previews as its raster canvas (a compute node
                // without `text` shows its field image).
                let sampled = if graph.preview_text(id) {
                    graph.compute_text(&device, &queue, id)
                } else {
                    None
                };
                if let Some((w, h, s)) = sampled {
                    let _ = frames.send((
                        format!("{NODE_PREVIEW}{id}"),
                        text_frame(w, h, &s, frame as u32),
                    ));
                } else if let Some((w, h, s)) = graph.ascii_text(&device, &queue, id) {
                    let _ = frames.send((
                        format!("{NODE_PREVIEW}{id}"),
                        text_frame(w, h, &s, frame as u32),
                    ));
                } else if let Some(tex) = graph.tex(id) {
                    let _ = frames.send((
                        format!("{NODE_PREVIEW}{id}"),
                        preview(&device, &queue, tex, frame as u32),
                    ));
                }
            }
        }
        for o in outs.values_mut() {
            if let Sink::Tex { sink, tex, brush, post, copy, slots, dims } = &mut o.sink {
                let target = post.as_ref().map_or(&*tex, |p| &p.scene);
                if let Some(n) = &o.info.look.node {
                    // texture node (graph.rs) -> [post] -> tex; missing node = black
                    copy.run(&device, &queue, &[graph.tex(n)], target, t as f32, &[]);
                } else {
                    // gen multiarrays -> Curves (x, y, width dims) + all dims (modifiers) -> brush -> [post] -> tex
                    let aspect = o.info.h as f32 / o.info.w as f32;
                    let src: Vec<&Multi> = o.info.src.iter().filter_map(|id| gens.get(id)).collect();
                    let all = crate::graph::layout(src.iter().copied(), &Default::default());
                    if all.attrs != *dims {
                        match self::brush(&device, o.info.w, o.info.h, &o.info.look, &all.attrs) {
                            Ok(b) => *brush = b,
                            Err(e) => tracing::warn!("output {}: relink for dims {:?}: {e:#}", o.info.name, all.attrs),
                        }
                        *dims = all.attrs.clone();
                    }
                    slots.upload(&device, &queue, &all);
                    let c = curves(src, aspect, o.info.w);
                    draw_with(&device, &queue, target, brush.as_mut(), c.as_ref(), t as f32, aspect, Some(&slots.bind(&device, &[], None)));
                }
                if let Some(p) = post {
                    p.run(&device, &queue, tex);
                }
                if o.preview && frame.is_multiple_of(FPS / PREVIEW_FPS) {
                    let _ = frames.send((o.info.name.clone(), preview(&device, &queue, tex, frame as u32)));
                }
                sink.publish(&device, &queue, tex);
            }
            if let Sink::Audio { pts, .. } = &o.sink {
                // one line (O(1) lookup in the audio callback), all dims kept
                let mut m = crate::graph::layout(o.info.src.iter().filter_map(|id| gens.get(id)), &Default::default());
                m.lines = vec![m.lines.concat()];
                pts.store(m.into());
            }
        }
        std::thread::sleep(Duration::from_millis(1000 / FPS));
    }
}

/// GPU -> CPU copy of a Bgra8 texture, tightly packed rows.
pub fn readback(device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture) -> Vec<u8> {
    let (w, h) = (tex.width(), tex.height());
    let bpr = (w * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let buf = device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: (bpr * h) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = device.create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        tex.as_image_copy(),
        wgpu::TexelCopyBufferInfo { buffer: &buf, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(bpr), rows_per_image: None } },
        tex.size(),
    );
    queue.submit([enc.finish()]);
    buf.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    let px = buf.slice(..).get_mapped_range().expect("mapped");
    px.chunks_exact(bpr as usize).flat_map(|r| &r[..(w * 4) as usize]).copied().collect()
}

/// ASF1 terminal frame (asemic_py/points.py): area-averaged (`image::imageops::thumbnail`) to
/// PREVIEW_MAX, RGBA8. !nearest: it hit one texel per k x k block (= glyph row 0 of every
/// ascii cell -> all black; thin ink strokes dropped).
fn preview(device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture, frame: u32) -> Vec<u8> {
    let (w, h) = (tex.width(), tex.height());
    let k = w.div_ceil(PREVIEW_MAX.0).max(h.div_ceil(PREVIEW_MAX.1)).max(1);
    let (pw, ph) = (w / k, h / k);
    let mut px = readback(device, queue, tex);
    px.as_chunks_mut::<4>().0.iter_mut().for_each(|p| p.swap(0, 2)); // BGRA -> RGBA
    let img = image::RgbaImage::from_raw(w, h, px).expect("readback = w*h*4");
    let small = image::imageops::thumbnail(&img, pw, ph);
    let mut b = Vec::with_capacity(FRAME_HEAD_LEN + (pw * ph * 4) as usize);
    b.extend(FRAME_MAGIC);
    b.extend(frame.to_le_bytes());
    b.extend((pw as u16).to_le_bytes());
    b.extend((ph as u16).to_le_bytes());
    b.extend(small.pixels().flat_map(|p| [p[0], p[1], p[2], 255]));
    b
}

/// AST1 text frame (asemic_schema::wire::TEXT_MAGIC): header, then UTF-8 rows.
fn text_frame(w: u32, h: u32, s: &str, frame: u32) -> Vec<u8> {
    let mut b = Vec::with_capacity(FRAME_HEAD_LEN + s.len());
    b.extend(TEXT_MAGIC);
    b.extend(frame.to_le_bytes());
    b.extend((w as u16).to_le_bytes());
    b.extend((h as u16).to_le_bytes());
    b.extend(s.as_bytes());
    b
}

/// Gen multiarrays -> asemic-repl `Paths` in brush coords (general.wgsl `normalCoords`: x
/// 0..1, y 0..aspect, y up) -> `Curves`. Renderer reads named dims: position = x, y (0..1, y
/// down), stroke scale = width if present (upstream `Paths::to_curves_scaled`); every other
/// dim reaches modifiers via the dims buffer. Curve i = line i of `Multi::union`. None =
/// nothing to draw.
pub(crate) fn curves<'a>(ms: impl IntoIterator<Item = &'a Multi>, aspect: f32, w: u32) -> Option<asemic_font::Curves> {
    let (mut paths, mut scale) = (Paths { paths: vec![] }, vec![]);
    for m in ms {
        let wa = m.attr("width");
        let xy: Vec<Vec<[f32; 2]>> = m.xy().map(Iterator::collect).collect();
        for i in (0..m.lines.len()).filter(|&i| m.lines[i].len() >= 2 * m.stride()) {
            paths.paths.push(xy[i].iter().map(|p| Vec2::new(p[0], (1.0 - p[1]) * aspect)).collect());
            scale.push(m.points(i).map(|p| wa.map_or(1.0, |a| p[a])).collect());
        }
    }
    (!paths.paths.is_empty()).then(|| paths.to_curves_scaled(10.0 / w as f32, Some(&scale)))
}

/// Brush pass over `curves` (None = clear only); `slots` = group(1) texture slots.
#[expect(clippy::too_many_arguments, reason = "wgpu device/queue/texture plumbing; a params struct would only rename them")]
pub(crate) fn draw_with(device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture, brush: &mut dyn Drawable, curves: Option<&asemic_font::Curves>, t: f32, aspect: f32, slots: Option<&wgpu::BindGroup>) {
    let view = tex.create_view(&Default::default());
    let mut enc = device.create_command_encoder(&Default::default());
    if let Some(c) = curves {
        brush.create_draw_command(device, c);
        brush.update_uniforms(queue, Uniforms::new(t, aspect, 1.0, 1.0, Vec4::ZERO));
    }
    {
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("asemic draw"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::BLACK), store: wgpu::StoreOp::Store },
                depth_slice: None,
            })],
            ..Default::default()
        });
        if let (true, Some(cmd)) = (curves.is_some(), brush.draw_command()) {
            if let Some(s) = slots {
                pass.set_bind_group(1, s, &[]);
            }
            brush.base_ref().render_draw_command(&mut pass, cmd);
        }
    }
    queue.submit([enc.finish()]);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asp1_lines_render_through_repl_brush() {
        // brain-encoded buffer: two polylines split by NaN
        let flat = [0.1f32, 0.5, 0.9, 0.5, f32::NAN, f32::NAN, 0.5, 0.1, 0.5, 0.9];
        let mut b = b"ASP1".to_vec();
        b.extend(0u32.to_le_bytes());
        b.extend(5u32.to_le_bytes());
        b.extend(2u16.to_le_bytes());
        b.extend(0u16.to_le_bytes());
        flat.iter().for_each(|f| b.extend(f.to_le_bytes()));
        let (_, lines) = Multi::decode(&b).unwrap(); // old (pre-attr) payload still reads
        assert_eq!(lines.lines.len(), 2);

        let (device, queue) = crate::device().unwrap();
        let (w, h) = (256, 256);
        let tex = crate::target(&device, w, h);
        let mut br = brush(&device, w, h, &Look::default(), &xy()).unwrap();
        draw_with(&device, &queue, &tex, &mut *br, curves([&lines], 1.0, w).as_ref(), 0.0, 1.0, slot(&device));
        let thin = lit(&device, &queue, &tex);
        assert!(thin > 100, "lit pixels {thin}");

        // per-point `width` attr widens the stroke
        let mut wide = Multi::new(&["width"]);
        wide.lines = lines.lines.iter().map(|l| l.chunks(2).flat_map(|p| [p[0], p[1], 4.0]).collect()).collect();
        draw_with(&device, &queue, &tex, &mut *br, curves([&wide], 1.0, w).as_ref(), 0.0, 1.0, slot(&device));
        let fat = lit(&device, &queue, &tex);
        assert!(fat > thin * 2, "width attr: {thin} -> {fat}");
    }

    fn slot(device: &wgpu::Device) -> Option<&'static wgpu::BindGroup> {
        Some(Box::leak(Box::new(crate::graph::BrushSlots::new(device).bind(device, &[], None))))
    }

    fn xy() -> Vec<String> {
        vec!["x".into(), "y".into()]
    }

    fn lit(device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture) -> usize {
        readback(device, queue, tex).as_chunks::<4>().0.iter().filter(|p| p[0] > 32 || p[1] > 32 || p[2] > 32).count()
    }

    #[test]
    fn node_preview_frames_flow_only_while_on() {
        let (host, mut frames) = Host::spawn().unwrap();
        host.timestretch("main", 1.0); // nodes freeze at ts 0.0; this test needs the node to render
        let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        rt.block_on(async {
            let spec = crate::graph::NodeSpec { kind: "shader".into(), w: 32, h: 32, wesl: "fn shade(uv: vec2f) -> vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }".into(), ..Default::default() };
            host.node("n", spec).await.unwrap();
            host.preview("tex/n", true);
            let (name, b) = tokio::time::timeout(Duration::from_secs(2), frames.recv()).await.unwrap().unwrap();
            assert_eq!(name, "tex/n");
            assert_eq!(&b[..4], b"ASF1");
            assert_eq!(&b[12..16], &[255, 0, 0, 255], "red node as RGBA");
            host.preview("tex/n", false);
            tokio::time::sleep(Duration::from_millis(300)).await;
            while frames.try_recv().is_ok() {}
            assert!(tokio::time::timeout(Duration::from_millis(400), frames.recv()).await.is_err(), "no frames once off");
        });
    }

    #[test]
    fn compute_preview_text_flag_selects_dump() {
        let (host, mut frames) = Host::spawn().unwrap();
        host.timestretch("main", 1.0); // nodes freeze at ts 0.0; this test needs the nodes to render
        let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        rt.block_on(async {
            let wesl = "fn compute(p: vec2u) -> vec4f { return vec4f(0.5, 0.25, 0.0, 1.0); }";
            let spec = |text| crate::graph::NodeSpec { kind: "compute".into(), w: 32, h: 32, wesl: wesl.into(), text, ..Default::default() };
            host.node("plain", spec(false)).await.unwrap();
            host.node("dump", spec(true)).await.unwrap();
            host.preview("tex/plain", true);
            host.preview("tex/dump", true);
            let mut got = std::collections::BTreeMap::new();
            while got.len() < 2 {
                let (name, b) = tokio::time::timeout(Duration::from_secs(3), frames.recv()).await.unwrap().unwrap();
                got.insert(name, b);
            }
            assert_eq!(&got["tex/plain"][..4], b"ASF1", "no `text` -> raster canvas");
            assert_eq!(&got["tex/dump"][..4], b"AST1", "`text=true` -> sampled-values dump");
            assert!(String::from_utf8_lossy(&got["tex/dump"]).contains("rgba="), "dump carries numbers");
        });
    }

    #[test]
    fn preview_is_downsampled_asf1() {
        let (device, queue) = crate::device().unwrap();
        let tex = crate::target(&device, 1000, 500); // row pitch not 256-aligned
        crate::clear(&device, &queue, &tex, wgpu::Color { r: 1.0, g: 0.0, b: 0.0, a: 1.0 });
        let b = preview(&device, &queue, &tex, 7);
        assert_eq!(&b[..4], b"ASF1");
        let (w, h) = (u16::from_le_bytes([b[8], b[9]]) as usize, u16::from_le_bytes([b[10], b[11]]) as usize);
        assert!(w <= 160 && h <= 90 && w > 0 && h > 0, "{w}x{h}");
        assert_eq!(b.len(), 12 + w * h * 4);
        assert_eq!(&b[12..16], &[255, 0, 0, 255], "red as RGBA");
    }

    #[test]
    fn feedback_post_leaves_trails() {
        let (device, queue) = crate::device().unwrap();
        let (w, h) = (128, 128);
        let (tex, post) = (crate::target(&device, w, h), crate::post::Post::new(&device, &queue, w, h));
        let mut br = brush(&device, w, h, &Look::default(), &xy()).unwrap();
        let line = vec![vec![[0.1f32, 0.5], [0.9, 0.5]]];
        draw_with(&device, &queue, &post.scene, &mut *br, curves([&Multi::from_xy(line.clone())], 1.0, w).as_ref(), 0.0, 1.0, slot(&device));
        post.run(&device, &queue, &tex);
        let first = lit(&device, &queue, &tex);
        assert!(first > 50, "post output lit {first}");
        // empty frame: only the previous frame's half survives
        draw_with(&device, &queue, &post.scene, &mut *br, None, 0.0, 1.0, None);
        post.run(&device, &queue, &tex);
        let trail = lit(&device, &queue, &tex);
        assert!(trail > 0 && trail <= first, "trail {trail} vs {first}");
    }

    #[test]
    fn brush_kinds_and_modifiers() {
        let (device, queue) = crate::device().unwrap();
        let (w, h) = (128, 128);
        let line = vec![vec![[0.1f32, 0.5], [0.5, 0.2], [0.9, 0.5]]];
        let mut counts = vec![];
        for (kind, width) in [("line", None), ("curve", None), ("dot", None), ("line", Some("return 4.0;"))] {
            let look = Look { brush: kind.into(), width: width.map(String::from), ..Default::default() };
            let tex = crate::target(&device, w, h);
            let mut br = brush(&device, w, h, &look, &xy()).unwrap();
            draw_with(&device, &queue, &tex, &mut *br, curves([&Multi::from_xy(line.clone())], 1.0, w).as_ref(), 0.0, 1.0, slot(&device));
            counts.push(lit(&device, &queue, &tex));
        }
        assert!(counts.iter().all(|&n| n > 0), "{counts:?}");
        assert!(counts[3] > counts[0], "width modifier should thicken: {counts:?}");
        assert!(brush(&device, w, h, &Look { brush: "nope".into(), ..Default::default() }, &xy()).is_err());
        assert!(brush(&device, w, h, &Look { width: Some("return nonsense;".into()), ..Default::default() }, &xy()).is_err());
    }
}
