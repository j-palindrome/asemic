//! Texture node graph (mirrors the brain's noise/proc graph): every node renders one
//! texture under an id; nodes name other node ids as inputs, outputs publish any id.
//! Kinds: in (io adapter source, e.g. `syphon:TouchDesigner`), draw (asemic-repl brush over
//! gen ids or a compute node's GPU points), shader (WESL `fn shade(uv: vec2f) -> vec4f`, may
//! `import lygia::…`), compute (WESL `fn compute(p: vec2u) -> vec4f` and/or
//! `fn point(i: u32) -> Point`), feedback (main.wgsl), ascii (input luma -> glyph atlas, ascii.rs).
//! Default: a node renders straight into its single output. `pingpong: true`: it renders
//! `raw`, then the builtin mix pass blends it with last frame's output (`smooth`) into a
//! ping-pong pair, so self-inputs / cycles read last frame (opt-in; open() rejects them otherwise).

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Result, bail};
use asemic_font::Drawable;

use asemic_schema::Multi;

use crate::host::{Look, brush, curves, draw_with};

pub const MAX_INPUTS: usize = 8;
pub const MAX_PARAMS: usize = 16;

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(default)]
pub struct NodeSpec {
    pub kind: String,
    pub w: u32,
    pub h: u32,
    /// node ids sampled by shader/compute (`in0(uv)`..) / draw (`tex0(uv)`..) / feedback (first)
    pub inputs: Vec<String>,
    /// draw: gen ids
    pub src: Vec<String>,
    /// legacy kind syphon: server display name (-> kind in, adapter `syphon:<server>`)
    pub server: String,
    /// in: `<adapter>:<name>`
    pub adapter: String,
    /// shader / compute: WESL source
    pub wesl: String,
    /// draw: compute node id whose points feed the brush
    pub points: Option<String>,
    /// compute: number of points (`point(i)`); draw: points drawn (0 = all)
    pub count: u32,
    /// draw from GPU points, line/curve brushes: samples along the path (0 = count * 8).
    /// Upstream `to_curves` uses path length / width, which needs CPU points.
    pub instances: u32,
    /// keep last frame: self-inputs, cycles, `smooth`, compute `prev(i)`
    pub pingpong: bool,
    /// pingpong: 0 = raw each frame, -> 1 = slower blend with last frame
    pub smooth: f32,
    /// uniform `param(i)` (<= 16); ascii: [columns, colour]
    pub params: Vec<f32>,
    /// compute: preview as a text dump of sampled output values (AST1, `compute_text`) instead
    /// of the raster canvas (ASF1) -- numeric debugging of a field shader (`tex(..., text=true)`)
    pub text: bool,
    /// ascii: glyphs dark -> light (empty = ascii.rs `RAMP`)
    pub ramp: String,
    /// ascii: atlas `ascii` (bitmap chars) | `asemic` (asemic-repl glyphs)
    pub font: String,
    /// ascii: `text:<font path>` = ramp glyphs filled from the font's outlines (overrides
    /// `font`); ramp re-sorted by per-glyph coverage; rebuilt on `axes` / file change
    pub atlas: String,
    /// ascii text atlas: variable-font axis location {tag: value}; routable as
    /// `asemic/tex/<id>.param.<tag>` (`texparam(id, tag, v)`)
    pub axes: BTreeMap<String, f32>,
    /// sink addresses `<adapter>:<name>` (empty name -> `asemic:<id>`)
    pub publish: Vec<String>,
    /// draw / compute: declared point dims {name: default}, appended to the incoming layout
    /// (gens / compute src) when absent; modifiers read any dim as `attr(info, DIM_<name>)`.
    pub attrs: BTreeMap<String, f32>,
    #[serde(flatten)]
    pub look: Look,
}

#[derive(Debug, Clone, serde::Serialize, schemars::JsonSchema)]
pub struct NodeInfo {
    pub id: String,
    #[serde(flatten)]
    pub spec: NodeSpec,
    /// in: connected; others: true
    pub live: bool,
    /// (sink name, clients)
    pub sinks: Vec<(String, usize)>,
    /// live point dims (draw: gens layout; compute: `Point` fields)
    pub dims: Vec<String>,
}

#[expect(clippy::large_enum_variant, reason = "few long-lived values (per node/output/cmd), !hot path")]
enum Kind {
    In(Box<dyn crate::io::TexSource>),
    Draw {
        brush: Box<dyn Drawable + Send>,
        slots: BrushSlots,
    },
    /// draw with look `brush="mesh"` (mesh.rs: lyon stroke/fill)
    Mesh {
        mesh: crate::mesh::Mesh,
        slots: BrushSlots,
    },
    Shader(Shader),
    Compute(Compute),
    Feedback(crate::post::Post),
    Ascii(crate::ascii::Ascii),
}

struct Node {
    spec: NodeSpec,
    kind: Kind,
    /// pingpong only: this frame's render before the mix pass
    raw: Option<wgpu::Texture>,
    /// 1 texture, or 2 (pingpong)
    out: Vec<wgpu::Texture>,
    cur: usize,
    sinks: Vec<Box<dyn crate::io::TexSink>>,
    /// point dims the node's shaders are linked against (relinked when the layout changes)
    dims: Vec<String>,
    /// last runtime (post-open) error: relink / draw failure; reported on change via `take_errors`
    error: Option<String>,
}

/// Gen multiarrays `src` merged into one layout (`Multi::union`) + declared dims appended.
pub(crate) fn layout<'a>(
    ms: impl IntoIterator<Item = &'a Multi>,
    declared: &BTreeMap<String, f32>,
) -> Multi {
    let mut m = Multi::union(ms);
    for (k, v) in declared {
        m.with_attr(k, *v);
    }
    m
}

fn check_dims(declared: &BTreeMap<String, f32>) -> Result<()> {
    match declared.keys().find(|k| !Multi::valid_name(k)) {
        Some(k) => bail!("attrs: {k:?} is not an identifier"),
        None => Ok(()),
    }
}

/// Builtin passes shared by every node.
struct Builtins {
    mix: Shader,
    copy: Shader,
}

#[derive(Default)]
pub struct Graph {
    nodes: BTreeMap<String, Node>,
    builtins: Option<Builtins>,
    errors: Vec<(String, String)>,
    /// per-block timestretch (0.0 = frozen, 1.0 = real-time, >1 = faster): maps label -> ts
    timestretch: BTreeMap<String, f64>,
    /// COOK: blocks played at ts 1.0 for exactly the next `render` (brain `Engine::step_block`)
    steps: BTreeSet<String>,
    /// per-block playhead seconds (brain `asemic/block/<label>.time`): a node's `info.time`
    /// is its block's playhead, falling back to the global frame clock when unset.
    block_time: BTreeMap<String, f64>,
}

impl Graph {
    pub fn open(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        id: &str,
        spec: NodeSpec,
    ) -> Result<NodeInfo> {
        self.open_with(device, queue, id, spec, &BTreeMap::new())
    }

    /// `gens` = current multiarrays, so draw/compute link against their live dims.
    pub fn open_with(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        id: &str,
        mut spec: NodeSpec,
        gens: &BTreeMap<String, Multi>,
    ) -> Result<NodeInfo> {
        let (w, h) = (spec.w.max(1), spec.h.max(1));
        (spec.w, spec.h) = (w, h);
        if spec.kind == "syphon" {
            spec.kind = "in".into();
            spec.adapter = format!("syphon:{}", spec.server);
        }
        if spec.params.len() > MAX_PARAMS {
            bail!("at most {MAX_PARAMS} params");
        }
        let hint = |why: String| {
            anyhow::anyhow!(
                "node {id:?} {why}; set pingpong=true on {id:?} to read the previous frame (+ optional smooth)"
            )
        };
        if !spec.pingpong {
            if spec.smooth > 0.0 {
                return Err(hint(format!(
                    "has smooth={} (blends with last frame)",
                    spec.smooth
                )));
            }
            if spec.kind == "compute" && spec.wesl.contains("prev(") {
                return Err(hint("calls prev(i) (last frame's points)".into()));
            }
        }
        if let Some(cycle) = self.cycle(id, &spec) {
            let path = cycle.join(" -> ");
            let lacking: Vec<_> = cycle[..cycle.len() - 1]
                .iter()
                .filter(|n| {
                    if *n == id {
                        !spec.pingpong
                    } else {
                        !self.nodes[*n].spec.pingpong
                    }
                })
                .collect();
            if !lacking.is_empty() {
                let what = if cycle.len() == 2 {
                    "reads itself".to_string()
                } else {
                    format!("reads last frame (cycle {path})")
                };
                return Err(anyhow::anyhow!(
                    "node {id:?} {what}; set pingpong=true on {lacking:?} to read the previous frame (+ optional smooth)"
                ));
            }
        }
        check_dims(&spec.attrs)?;
        let dims = self.dims_for(&spec, gens);
        if self.builtins.is_none() {
            self.builtins = Some(Builtins {
                mix: Shader::new(device, MIX, 2)?,
                copy: Shader::copy(device),
            });
        }
        let kind = match spec.kind.as_str() {
            "in" => Kind::In(crate::io::source(device, queue, &spec.adapter)?),
            "draw" => {
                if spec.inputs.len() > asemic_font::link::BRUSH_SLOTS as usize {
                    bail!(
                        "draw: at most {} inputs (tex0..)",
                        asemic_font::link::BRUSH_SLOTS
                    );
                }
                if spec.look.brush == "mesh" {
                    if spec.points.is_some() {
                        bail!("draw: brush mesh tessellates gen src (not GPU points)");
                    }
                    Kind::Mesh {
                        mesh: crate::mesh::Mesh::new(device, &spec.look, &dims)?,
                        slots: BrushSlots::new(device),
                    }
                } else {
                    Kind::Draw {
                        brush: brush(device, w, h, &spec.look, &dims)?,
                        slots: BrushSlots::new(device),
                    }
                }
            }
            "shader" => {
                if spec.inputs.len() > MAX_INPUTS {
                    bail!("shader: at most {MAX_INPUTS} inputs");
                }
                Kind::Shader(Shader::new(device, &spec.wesl, spec.inputs.len())?)
            }
            "compute" => {
                if spec.inputs.len() > MAX_INPUTS {
                    bail!("compute: at most {MAX_INPUTS} inputs");
                }
                Kind::Compute(Compute::new(
                    device,
                    &spec.wesl,
                    spec.inputs.len(),
                    w,
                    h,
                    spec.count,
                    spec.pingpong,
                    &dims,
                )?)
            }
            "feedback" => {
                if spec.inputs.len() != 1 {
                    bail!("feedback: exactly 1 input");
                }
                Kind::Feedback(crate::post::Post::new(device, queue, w, h))
            }
            "ascii" => {
                if spec.inputs.len() != 1 {
                    bail!("ascii: exactly 1 input");
                }
                Kind::Ascii(crate::ascii::Ascii::new(
                    device,
                    queue,
                    &spec.ramp,
                    &spec.font,
                    &spec.atlas,
                    &spec.axes,
                )?)
            }
            k => bail!("unknown node kind {k:?} (in, draw, shader, compute, feedback, ascii)"),
        };
        // the old node may own the sink names we are about to claim; capture whether it carried a
        // runtime error so a reopen only queues a *clear* when there was actually one to clear
        // (a fresh node otherwise emits a spurious empty `err/tex/<id>` frame -- host.rs forwards it)
        let stale_error = self.nodes.remove(id).and_then(|n| n.error).is_some();
        let sinks = spec
            .publish
            .iter()
            .map(|a| crate::io::sink(device, queue, a, &format!("asemic:{id}"), w, h))
            .collect::<Result<Vec<_>>>()?;
        let out: Vec<_> = (0..1 + spec.pingpong as usize)
            .map(|_| crate::target(device, w, h))
            .collect();
        for t in &out {
            crate::clear(device, queue, t, wgpu::Color::BLACK);
        }
        let raw = spec.pingpong.then(|| crate::target(device, w, h));
        self.nodes.insert(
            id.into(),
            Node {
                spec,
                kind,
                raw,
                out,
                cur: 0,
                sinks,
                dims,
                error: None,
            },
        );
        if stale_error {
            self.errors.push((id.into(), String::new())); // reopened -> clear the stale runtime error
        }
        Ok(self.info(id).expect("just inserted"))
    }

    /// Dims a draw/compute node links against: its gens (src) layout, or a compute node's
    /// `Point` dims (draw from points), + declared attrs.
    fn dims_for(&self, spec: &NodeSpec, gens: &BTreeMap<String, Multi>) -> Vec<String> {
        match spec.points.as_ref().and_then(|p| self.nodes.get(p)) {
            Some(n) if spec.kind == "draw" => {
                layout(
                    [&Multi {
                        attrs: n.dims.clone(),
                        lines: vec![],
                    }],
                    &spec.attrs,
                )
                .attrs
            }
            _ => layout(spec.src.iter().filter_map(|g| gens.get(g)), &spec.attrs).attrs,
        }
    }

    /// Path id -> .. -> id through inputs/points if `spec` (for id) closes a cycle.
    fn cycle(&self, id: &str, spec: &NodeSpec) -> Option<Vec<String>> {
        fn walk<'a>(
            g: &'a Graph,
            id: &str,
            deps: Vec<&'a String>,
            path: &mut Vec<String>,
            seen: &mut BTreeSet<String>,
        ) -> bool {
            for d in deps {
                path.push(d.clone());
                if d == id {
                    return true;
                }
                if seen.insert(d.clone())
                    && let Some(n) = g.nodes.get(d)
                        && walk(
                            g,
                            id,
                            n.spec.inputs.iter().chain(&n.spec.points).collect(),
                            path,
                            seen,
                        ) {
                            return true;
                        }
                path.pop();
            }
            false
        }
        let mut path = vec![id.to_string()];
        walk(
            self,
            id,
            spec.inputs.iter().chain(&spec.points).collect(),
            &mut path,
            &mut BTreeSet::new(),
        )
        .then_some(path)
    }

    pub fn close(&mut self, id: &str) -> bool {
        self.nodes.remove(id).is_some()
    }

    /// Set uniform `param(i)` (`key` = index) or ascii text-atlas axis (`key` = tag) of node
    /// `id` (false: unknown node / index out of range / tag on a non-text-atlas node).
    pub fn param(&mut self, id: &str, key: &str, v: f32) -> bool {
        let Some(n) = self.nodes.get_mut(id) else {
            return false;
        };
        match key.parse::<usize>() {
            Ok(i) if i < MAX_PARAMS => {
                if n.spec.params.len() <= i {
                    n.spec.params.resize(i + 1, 0.0);
                }
                n.spec.params[i] = v;
                true
            }
            Err(_) if n.spec.atlas.starts_with("text:") => {
                n.spec.axes.insert(key.into(), v);
                true
            }
            _ => false,
        }
    }

    pub fn info(&self, id: &str) -> Option<NodeInfo> {
        let n = self.nodes.get(id)?;
        let live = match &n.kind {
            Kind::In(i) => i.live(),
            _ => true,
        };
        let sinks = n
            .sinks
            .iter()
            .map(|s| (s.name().to_string(), s.clients()))
            .collect();
        Some(NodeInfo {
            id: id.into(),
            spec: n.spec.clone(),
            live,
            sinks,
            dims: n.dims.clone(),
        })
    }

    pub fn list(&self) -> Vec<NodeInfo> {
        self.nodes.keys().filter_map(|id| self.info(id)).collect()
    }

    /// ascii node: text preview grid (terminal cells of the viewer's box)
    pub fn preview_grid(&mut self, id: &str, grid: (u32, u32)) {
        if let Some(Node {
            kind: Kind::Ascii(a),
            ..
        }) = self.nodes.get_mut(id)
        {
            a.preview_grid = Some(grid);
        }
    }

    /// ascii node's last glyph grid as text (terminal preview)
    pub fn ascii_text(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        id: &str,
    ) -> Option<(u32, u32, String)> {
        match &self.nodes.get(id)?.kind {
            Kind::Ascii(a) => a.text(device, queue),
            _ => None,
        }
    }

    /// node opened with `text=true` (a compute node) previews as its sampled-value text dump.
    pub fn preview_text(&self, id: &str) -> bool {
        self.nodes.get(id).is_some_and(|n| n.spec.text)
    }

    /// Compute texture preview: sampled output values from GPU readback, not a raster frame.
    pub fn compute_text(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        id: &str,
    ) -> Option<(u32, u32, String)> {
        let Node {
            kind: Kind::Compute(c),
            ..
        } = self.nodes.get(id)?
        else {
            return None;
        };
        c.tex.as_ref()?;
        let tex = self.tex(id)?;
        let (w, h) = (tex.width(), tex.height());
        let pixels = crate::host::readback(device, queue, tex);
        let samples = [
            ("top-left", 0, 0),
            ("center", w / 2, h / 2),
            ("top-right", w - 1, 0),
            ("bottom-left", 0, h - 1),
            ("bottom-right", w - 1, h - 1),
        ];
        let mut text = format!("compute {w}x{h} sampled RGBA (GPU readback)\n");
        for (label, x, y) in samples {
            let i = ((y * w + x) * 4) as usize;
            let (b, g, r, a) = (
                pixels[i] as f32,
                pixels[i + 1] as f32,
                pixels[i + 2] as f32,
                pixels[i + 3] as f32,
            );
            text.push_str(&format!(
                "{label} ({x},{y}): rgba=({:.3}, {:.3}, {:.3}, {:.3})\n",
                r / 255.0,
                g / 255.0,
                b / 255.0,
                a / 255.0
            ));
        }
        Some((w, h, text))
    }

    pub fn tex(&self, id: &str) -> Option<&wgpu::Texture> {
        self.nodes.get(id).map(|n| &n.out[n.cur])
    }

    /// Compute node's current points: (positions, brush coords `array<vec2f>`; dims,
    /// `array<f32>` stride = its dims).
    pub fn points(&self, id: &str) -> Option<(&wgpu::Buffer, &wgpu::Buffer)> {
        match &self.nodes.get(id)?.kind {
            Kind::Compute(c) => c.points(),
            _ => None,
        }
    }

    /// Render every node once, inputs before dependents; back-edges / self-inputs read
    /// last frame, missing inputs = black.
    /// Set per-block timestretch; ts = 0.0 means frozen (nodes skip rendering).
    pub fn timestretch(&mut self, label: &str, ts: f64) {
        self.timestretch.insert(label.into(), ts);
    }

    /// Play `label` for exactly one rendered frame (COOK).
    pub fn step_block(&mut self, label: &str) {
        self.steps.insert(label.into());
    }

    pub fn clear_timestretch(&mut self, label: &str) {
        self.timestretch.remove(label);
    }

    /// Set a block's playhead seconds (brain-published); a node's `info.time` reads this.
    pub fn block_time(&mut self, label: &str, t: f64) {
        self.block_time.insert(label.into(), t);
    }

    pub fn clear_block_time(&mut self, label: &str) {
        self.block_time.remove(label);
    }

    /// Effective playhead for a node id: its block's time (hierarchical lookup). None =
    /// fall back to the global frame clock.
    fn node_time(&self, id: &str) -> Option<f64> {
        asemic_schema::ids::ancestors(id)
            .find_map(|l| self.block_time.get(l).copied())
            .or_else(|| self.block_time.get("main").copied())
    }

    /// Effective timestretch for a node id (hierarchical lookup).
    fn node_timestretch(&self, id: &str) -> f64 {
        asemic_schema::ids::ancestors(id)
            .find_map(|l| self.timestretch.get(l).copied())
            .or_else(|| self.timestretch.get("main").copied())
            .unwrap_or(0.0)
    }

    /// Runtime error changes since the last call: (node id, message; "" = cleared).
    pub fn take_errors(&mut self) -> Vec<(String, String)> {
        std::mem::take(&mut self.errors)
    }

    /// Record `err` as `id`'s runtime error, queueing it for `take_errors` only when it changed.
    fn report(
        errors: &mut Vec<(String, String)>,
        id: &str,
        slot: &mut Option<String>,
        err: Option<String>,
    ) {
        if *slot != err {
            if let Some(e) = &err {
                tracing::warn!("node {id}: {e}");
            }
            errors.push((id.into(), err.clone().unwrap_or_default()));
            *slot = err;
        }
    }

    pub fn render(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        gens: &BTreeMap<String, Multi>,
        t: f32,
    ) {
        let mut order = vec![];
        let (mut done, mut busy) = (BTreeSet::new(), BTreeSet::new());
        for id in self.nodes.keys() {
            self.visit(id, &mut done, &mut busy, &mut order);
        }
        let Some(b) = self.builtins.take() else {
            return;
        };
        let stepped: Vec<(String, Option<f64>)> = std::mem::take(&mut self.steps)
            .into_iter()
            .map(|l| {
                let prev = self.timestretch.insert(l.clone(), 1.0);
                (l, prev)
            })
            .collect();
        let mut rendered = BTreeSet::new();
        for id in order {
            if self.node_timestretch(&id) == 0.0 {
                rendered.insert(id); // frozen: downstream still reads its last frame
                continue;
            }
            // `info.time` = this block's own playhead when the brain publishes one
            // (`asemic/block/<label>.time`), else the global frame clock
            let t = self.node_time(&id).map(|v| v as f32).unwrap_or(t);
            let mut n = self.nodes.remove(&id).expect("ordered ids exist");
            // layout changed (gens gained/lost dims) -> relink against the new dims
            let want = self.dims_for(&n.spec, gens);
            if want != n.dims
                && matches!(
                    n.kind,
                    Kind::Draw { .. } | Kind::Mesh { .. } | Kind::Compute(_)
                )
            {
                let (w, h) = (n.spec.w, n.spec.h);
                let relinked = match &n.kind {
                    Kind::Draw { .. } => {
                        brush(device, w, h, &n.spec.look, &want).map(|b| Kind::Draw {
                            brush: b,
                            slots: BrushSlots::new(device),
                        })
                    }
                    Kind::Mesh { .. } => {
                        crate::mesh::Mesh::new(device, &n.spec.look, &want).map(|m| Kind::Mesh {
                            mesh: m,
                            slots: BrushSlots::new(device),
                        })
                    }
                    _ => Compute::new(
                        device,
                        &n.spec.wesl,
                        n.spec.inputs.len(),
                        w,
                        h,
                        n.spec.count,
                        n.spec.pingpong,
                        &want,
                    )
                    .map(Kind::Compute),
                };
                let err = match relinked {
                    Ok(k) => {
                        n.kind = k;
                        None
                    }
                    Err(e) => Some(format!("relink for point dims {want:?}: {e:#}")),
                };
                Self::report(&mut self.errors, &id, &mut n.error, err);
                n.dims = want;
            }
            let Node {
                spec,
                kind,
                raw,
                out,
                cur,
                sinks,
                error,
                ..
            } = &mut n;
            let (w, aspect) = (spec.w, spec.h as f32 / spec.w as f32);
            // back-edge to a non-pingpong node (cycle made by a later reopen) = black
            let ready = |i: &String| {
                rendered.contains(i) || self.nodes.get(i).is_some_and(|m| m.spec.pingpong)
            };
            let ins: Vec<Option<&wgpu::Texture>> = spec
                .inputs
                .iter()
                .map(|i| {
                    if *i == id {
                        spec.pingpong.then(|| &out[*cur])
                    } else {
                        self.tex(i).filter(|_| ready(i))
                    }
                })
                .collect();
            let target: &wgpu::Texture = raw.as_ref().unwrap_or(&out[0]);
            let mut mix_src = target;
            match kind {
                Kind::In(i) => {
                    i.poll(device, queue);
                    match (i.tex(), spec.pingpong) {
                        // pingpong: external texture sampled by the mix pass directly (any size)
                        (Some(x), true) => mix_src = x,
                        (x, false) => b.copy.run(device, queue, &[x], target, t, &[]),
                        (None, true) => {}
                    }
                }
                Kind::Draw { brush, slots } => match spec.points.as_deref() {
                    Some(p) => {
                        let buf = self
                            .points(p)
                            .filter(|_| ready(&p.to_string()))
                            .map(|(a, b)| (a.clone(), b.clone()));
                        let avail = buf.as_ref().map_or(0, |(b, _)| (b.size() / 8) as u32);
                        let count = if spec.count == 0 {
                            avail
                        } else {
                            spec.count.min(avail)
                        };
                        // one line through the compute points; its dims buffer as is
                        slots.upload_lines(device, queue, &[[0, count]]);
                        let bind = slots.bind(device, &ins, buf.as_ref().map(|(_, d)| d));
                        brush.base().set_vertex_source(buf.map(|(b, _)| b));
                        let curves = (count > 0).then(|| {
                            gpu_curves(
                                count,
                                if spec.instances == 0 {
                                    count * 8
                                } else {
                                    spec.instances
                                },
                                10.0 / w as f32,
                            )
                        });
                        draw_with(
                            device,
                            queue,
                            target,
                            brush.as_mut(),
                            curves.as_ref(),
                            t,
                            aspect,
                            Some(&bind),
                        );
                    }
                    None => {
                        brush.base().set_vertex_source(None);
                        let src: Vec<&Multi> =
                            spec.src.iter().filter_map(|g| gens.get(g)).collect();
                        slots.upload(device, queue, &layout(src.iter().copied(), &spec.attrs));
                        let c = curves(src, aspect, w);
                        draw_with(
                            device,
                            queue,
                            target,
                            brush.as_mut(),
                            c.as_ref(),
                            t,
                            aspect,
                            Some(&slots.bind(device, &ins, None)),
                        );
                    }
                },
                Kind::Mesh { mesh, slots } => {
                    let src: Vec<&Multi> = spec.src.iter().filter_map(|g| gens.get(g)).collect();
                    slots.upload(device, queue, &layout(src.iter().copied(), &spec.attrs));
                    let err = mesh
                        .draw(
                            device,
                            queue,
                            target,
                            src,
                            t,
                            &slots.bind(device, &ins, None),
                        )
                        .err()
                        .map(|e| format!("mesh: {e:#}"));
                    Self::report(&mut self.errors, &id, error, err);
                }
                Kind::Shader(sh) => sh.run(device, queue, &ins, target, t, &spec.params),
                Kind::Compute(c) => {
                    let src = layout(spec.src.iter().filter_map(|g| gens.get(g)), &spec.attrs);
                    c.run(device, queue, &b.copy, &ins, target, t, &spec.params, &src)
                }
                Kind::Ascii(a) => {
                    // Always raster into `target`: the node's own texture (`g.tex(id)`) must
                    // reflect its rendered output whether or not a sink or downstream node
                    // consumes it — e.g. direct host/test readback has no entry in `sinks` or
                    // in another node's `inputs`, so gating on those alone silently drops pixels.
                    a.run(
                        device,
                        queue,
                        ins[0],
                        target,
                        t,
                        &spec.params,
                        &spec.axes,
                        true,
                    )
                }
                Kind::Feedback(post) => {
                    b.copy.run(device, queue, &ins[..1], &post.scene, t, &[]);
                    post.run(device, queue, target);
                }
            }
            if spec.pingpong {
                b.mix.run(
                    device,
                    queue,
                    &[Some(mix_src), Some(&out[*cur])],
                    &out[1 - *cur],
                    t,
                    &[spec.smooth.clamp(0.0, 1.0)],
                );
                *cur = 1 - *cur;
            }
            for s in sinks.iter_mut() {
                s.publish(device, queue, &out[*cur]);
            }
            rendered.insert(id.clone());
            self.nodes.insert(id, n);
        }
        for (l, prev) in stepped {
            match prev {
                Some(ts) => self.timestretch.insert(l, ts),
                None => self.timestretch.remove(&l),
            };
        }
        self.builtins = Some(b);
    }

    fn visit(
        &self,
        id: &str,
        done: &mut BTreeSet<String>,
        busy: &mut BTreeSet<String>,
        order: &mut Vec<String>,
    ) {
        if done.contains(id) || !busy.insert(id.into()) {
            return;
        }
        if let Some(n) = self.nodes.get(id) {
            for i in n.spec.inputs.iter().chain(&n.spec.points) {
                self.visit(i, done, busy, order);
            }
            order.push(id.into());
        }
        busy.remove(id);
        done.insert(id.into());
    }
}

/// One-path topology for `count` GPU-resident vertices (positions come from the vertex
/// source buffer; the zero CPU vertices only size the placeholder upload).
fn gpu_curves(count: u32, instances: u32, width: f32) -> asemic_font::Curves {
    let n = count as usize;
    asemic_font::Curves {
        vertices: vec![asemic_font::glam::Vec2::ZERO; n],
        curve_starts: vec![0, count],
        widths: vec![width; n],
        curve_lengths: vec![0, instances],
        total_instances: instances,
    }
}

/// Brush @group(1) (layout = asemic-font `brush_extra_layout`): `tex0(uv)`..`tex3(uv)` +
/// the drawn points' dims (stride D) and line table, read by `attr(info, DIM_<name>)`.
pub struct BrushSlots {
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    black: wgpu::Texture,
    dims: wgpu::Buffer,
    lines: wgpu::Buffer,
}

/// (Re)fill a storage buffer, exactly sized so `arrayLength` = element count (empty -> 1
/// zeroed element of `min` bytes).
pub(crate) fn fill_storage(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    buf: &mut wgpu::Buffer,
    bytes: &[u8],
    min: u64,
) {
    let need = (bytes.len() as u64).max(min).next_multiple_of(4);
    if buf.size() != need {
        *buf = storage(device, need);
    }
    if !bytes.is_empty() {
        queue.write_buffer(buf, 0, bytes);
    }
}

pub(crate) fn storage(device: &wgpu::Device, size: u64) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("asemic dims"),
        size,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

impl BrushSlots {
    pub(crate) fn new(device: &wgpu::Device) -> Self {
        Self {
            layout: asemic_font::brush_extra_layout(device).expect("asemic-font brush slots"),
            sampler: crate::linear_sampler(device),
            black: crate::target(device, 1, 1),
            dims: storage(device, 4),
            lines: storage(device, 8),
        }
    }

    /// Points of `m` (already in the linked layout) -> dims + line table buffers.
    pub(crate) fn upload(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, m: &Multi) {
        let flat: Vec<f32> = m.lines.concat();
        fill_storage(
            device,
            queue,
            &mut self.dims,
            bytemuck::cast_slice(&flat),
            4,
        );
        self.upload_lines(device, queue, &m.line_table());
    }

    pub(crate) fn upload_lines(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        lines: &[[u32; 2]],
    ) {
        fill_storage(
            device,
            queue,
            &mut self.lines,
            bytemuck::cast_slice(lines),
            8,
        );
    }

    /// slots beyond `texs` / None -> black; `dims` = external dims buffer (compute points).
    pub(crate) fn bind(
        &self,
        device: &wgpu::Device,
        texs: &[Option<&wgpu::Texture>],
        dims: Option<&wgpu::Buffer>,
    ) -> wgpu::BindGroup {
        let views: Vec<_> = (0..asemic_font::link::BRUSH_SLOTS as usize)
            .map(|i| {
                texs.get(i)
                    .copied()
                    .flatten()
                    .unwrap_or(&self.black)
                    .create_view(&Default::default())
            })
            .collect();
        let mut entries = vec![wgpu::BindGroupEntry {
            binding: 0,
            resource: wgpu::BindingResource::Sampler(&self.sampler),
        }];
        entries.extend(views.iter().enumerate().map(|(i, v)| wgpu::BindGroupEntry {
            binding: i as u32 + 1,
            resource: wgpu::BindingResource::TextureView(v),
        }));
        let d = asemic_font::link::BRUSH_DIMS;
        entries.push(wgpu::BindGroupEntry {
            binding: d,
            resource: dims.unwrap_or(&self.dims).as_entire_binding(),
        });
        entries.push(wgpu::BindGroupEntry {
            binding: d + 1,
            resource: self.lines.as_entire_binding(),
        });
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("asemic brush slots"),
            layout: &self.layout,
            entries: &entries,
        })
    }
}

/// Shared @group(0) for shader + compute nodes: sampler, `info` uniform, `in0..inN` textures.
struct Inputs {
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    uniform: wgpu::Buffer,
    black: wgpu::Texture,
    n: usize,
}

const INFO_SIZE: u64 = 96;

impl Inputs {
    /// WGSL declarations for group(0) + `param(i)` + `in<i>(uv)`.
    /// Raw bindings `tex0..tex7: texture_2d<f32>` + shared `samp: sampler` are exposed
    /// alongside the `in<i>(uv)` helpers so user WESL can call lygia filters that need the
    /// raw `(texture_2d<f32>, sampler, uv, ...)` signature (e.g. `filter/edge/prewitt.wesl`),
    /// which naga rejects behind a helper fn. Names avoid lygia idents and WESL keywords
    /// (`target` is reserved).
    fn preamble(n: usize) -> String {
        let mut s = "\nstruct Info { time: f32, inputs: u32, size: vec2f, frame: u32, p: array<vec4f, 4> }\n@group(0) @binding(0) var samp: sampler;\n@group(0) @binding(1) var<uniform> info: Info;\nfn param(i: u32) -> f32 { return info.p[i / 4u][i % 4u]; }\n".to_string();
        for i in 0..n {
            s += &format!(
                "@group(0) @binding({}) var tex{i}: texture_2d<f32>;\nfn in{i}(uv: vec2f) -> vec4f {{ return textureSampleLevel(tex{i}, samp, uv, 0.0); }}\n",
                i + 2
            );
        }
        s += SEED;
        s
    }

    fn new(device: &wgpu::Device, n: usize, vis: wgpu::ShaderStages) -> Self {
        let mut entries = vec![
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: vis,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: vis,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
        ];
        entries.extend((0..n as u32).map(|i| wgpu::BindGroupLayoutEntry {
            binding: i + 2,
            visibility: vis,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        }));
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("asemic node inputs"),
            entries: &entries,
        });
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: INFO_SIZE,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Self {
            layout,
            sampler: crate::linear_sampler(device),
            uniform,
            black: crate::target(device, 1, 1),
            n,
        }
    }

    /// Writes `info` and binds inputs (None / missing -> black).
    #[expect(clippy::too_many_arguments, reason = "wgpu device/queue/texture plumbing; a params struct would only rename them")]
    fn bind(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        inputs: &[Option<&wgpu::Texture>],
        size: (u32, u32),
        t: f32,
        frame: u32,
        params: &[f32],
    ) -> wgpu::BindGroup {
        let mut p = [0f32; MAX_PARAMS];
        p.iter_mut().zip(params).for_each(|(d, s)| *d = *s);
        let mut info = [
            t.to_le_bytes(),
            (self.n as u32).to_le_bytes(),
            (size.0 as f32).to_le_bytes(),
            (size.1 as f32).to_le_bytes(),
            frame.to_le_bytes(),
        ]
        .concat();
        info.resize(32, 0);
        p.iter().for_each(|v| info.extend(v.to_le_bytes()));
        queue.write_buffer(&self.uniform, 0, &info);
        let views: Vec<_> = (0..self.n)
            .map(|i| {
                inputs
                    .get(i)
                    .copied()
                    .flatten()
                    .unwrap_or(&self.black)
                    .create_view(&Default::default())
            })
            .collect();
        let mut entries = vec![
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::Sampler(&self.sampler),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: self.uniform.as_entire_binding(),
            },
        ];
        entries.extend(views.iter().enumerate().map(|(i, v)| wgpu::BindGroupEntry {
            binding: i as u32 + 2,
            resource: wgpu::BindingResource::TextureView(v),
        }));
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.layout,
            entries: &entries,
        })
    }
}

/// WESL -> validated module (lygia linked via asemic-font `link`); `build` creates the
/// pipelines inside the same validation scope.
fn compile<T>(
    device: &wgpu::Device,
    src: &str,
    what: &str,
    dims: Option<String>,
    build: impl FnOnce(&wgpu::ShaderModule) -> T,
) -> Result<T> {
    let wgsl =
        asemic_font::link::link_with(src, &[], dims).map_err(|e| anyhow::anyhow!("wesl: {e}"))?;
    let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(what),
        source: wgpu::ShaderSource::Wgsl(wgsl.into()),
    });
    let out = build(&module);
    match pollster::block_on(scope.pop()) {
        Some(e) => bail!("{what}: {e}"),
        None => Ok(out),
    }
}

/// WESL fullscreen pass: user `shade(uv)` + generated `in0(uv)`..`inN(uv)`, `info`, `param(i)`.
pub struct Shader {
    pipeline: wgpu::RenderPipeline,
    inputs: Inputs,
}

const COPY: &str = "fn shade(uv: vec2f) -> vec4f { return in0(uv); }";
const MIX: &str = "fn shade(uv: vec2f) -> vec4f { return mix(in0(uv), in1(uv), param(0u)); }";

/// Deterministic noise/seed helpers every compute/shader node gets (see [`Inputs::preamble`]):
/// seed a canvas on `info.frame == 0u` with `valueNoise`/`fbm` instead of hand-rolled hashes
/// (`select(last, seed, info.frame == 0u)`), so fields start with structure rather than the
/// zero init (a uniform field stays uniform under most dynamics -- e.g. blank Gray-Scott).
/// `hash21`/`hash22` = white noise in [0,1); `valueNoise` = smooth [0,1); `fbm` = octave sum.
const SEED: &str = "\
fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
fn hash22(p: vec2f) -> vec2f { return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)))) * 43758.5453123); }
fn valueNoise(p: vec2f) -> f32 {
    let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x), mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm(p: vec2f, octaves: u32) -> f32 {
    var v = 0.0; var a = 0.5; var q = p;
    for (var i = 0u; i < octaves; i++) { v += a * valueNoise(q); q = q * 2.0; a = a * 0.5; }
    return v;
}
";

impl Shader {
    pub fn copy(device: &wgpu::Device) -> Self {
        Self::new(device, COPY, 1).expect("builtin copy shader")
    }

    pub fn new(device: &wgpu::Device, wesl: &str, n: usize) -> Result<Self> {
        let src = format!(
            "{wesl}\n{}struct V {{ @builtin(position) pos: vec4f, @location(0) uv: vec2f }}
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {{
    let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
    return V(vec4f(p, 0.0, 1.0), vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5));
}}
@fragment fn fs(v: V) -> @location(0) vec4f {{ return shade(v.uv); }}
",
            Inputs::preamble(n)
        );
        let inputs = Inputs::new(device, n, wgpu::ShaderStages::FRAGMENT);
        let pipeline = compile(device, &src, "shader node", None, |module| {
            let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[Some(&inputs.layout)],
                immediate_size: 0,
            });
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("asemic shader node"),
                layout: Some(&pl),
                vertex: wgpu::VertexState {
                    module,
                    entry_point: Some("vs"),
                    buffers: &[],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module,
                    entry_point: Some("fs"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: crate::FORMAT,
                        blend: Some(wgpu::BlendState::REPLACE),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            })
        })?;
        Ok(Self { pipeline, inputs })
    }

    /// inputs[i] = None -> black; params -> `param(i)`.
    pub fn run(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        inputs: &[Option<&wgpu::Texture>],
        out: &wgpu::Texture,
        t: f32,
        params: &[f32],
    ) {
        let bind = self.inputs.bind(
            device,
            queue,
            inputs,
            (out.width(), out.height()),
            t,
            0,
            params,
        );
        let view = out.create_view(&Default::default());
        let mut enc = device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("asemic shader node"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                    depth_slice: None,
                })],
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bind, &[]);
            pass.draw(0..3, 0..1);
        }
        queue.submit([enc.finish()]);
    }
}

/// WESL compute node: `fn compute(p: vec2u) -> vec4f` (rgba16float texture) and/or
/// `fn point(i: u32) -> Point` (one f32 field per dim, generated `package::dims`) -> dims
/// buffer (stride D) + positions (dims x, y in brush coords, the upstream vertex source).
/// Src gens (spec `src`, merged + declared attrs = the same D dims) read as `attr(i, k)` /
/// `src_point(i)` / `src_count()`; pingpong: `prev(i) -> Point` = last frame. Inputs/params
/// as `Shader` (shared group(0)).
struct Compute {
    inputs: Inputs,
    layout: wgpu::BindGroupLayout,
    tex: Option<(wgpu::ComputePipeline, wgpu::Texture)>,
    /// (positions, dims) per buffer: 1, or 2 (pingpong)
    pts: Option<(wgpu::ComputePipeline, Vec<(wgpu::Buffer, wgpu::Buffer)>)>,
    /// src gens in the node's layout + line table (bindings 3, 4)
    src: (wgpu::Buffer, wgpu::Buffer),
    pcur: usize,
    size: (u32, u32),
    count: u32,
    frame: u32,
    /// Render pipeline for point-only nodes: draws positions as dots into the node texture,
    /// so the halfblock preview shows meaningful output even without `fn compute`.
    dot: Option<wgpu::RenderPipeline>,
    dot_layout: wgpu::BindGroupLayout,
}

const STORE: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

impl Compute {
    #[allow(clippy::too_many_arguments)]
    fn new(
        device: &wgpu::Device,
        wesl: &str,
        n: usize,
        w: u32,
        h: u32,
        count: u32,
        pingpong: bool,
        dims: &[String],
    ) -> Result<Self> {
        use asemic_font::link::{dims_import, dims_module};
        let (has_tex, has_pts) = (wesl.contains("fn compute"), wesl.contains("fn point"));
        if !has_tex && !has_pts {
            bail!(
                "compute: define `fn compute(p: vec2u) -> vec4f` and/or `fn point(i: u32) -> Point`"
            );
        }
        if has_pts && count == 0 {
            bail!("compute: `point` needs count > 0");
        }
        let d = dims.len();
        let mut src = format!(
            "{}{wesl}\n{}fn aspect() -> f32 {{ return info.size.y / info.size.x; }}
fn attr(i: u32, k: u32) -> f32 {{ return dim_at(i, k); }}
fn src_point(i: u32) -> Point {{ return point_at(i); }}
fn src_count() -> u32 {{ return dim_count(); }}
",
            dims_import(dims, true),
            Inputs::preamble(n)
        );
        let storage_ty = |read_only| wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        };
        let cs = wgpu::ShaderStages::COMPUTE;
        let mut entries = vec![
            wgpu::BindGroupLayoutEntry {
                binding: 3,
                visibility: cs,
                ty: storage_ty(true),
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 4,
                visibility: cs,
                ty: storage_ty(true),
                count: None,
            },
        ];
        if has_tex {
            src += "@group(1) @binding(0) var out_tex: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8) fn cs_tex(@builtin(global_invocation_id) g: vec3u) {
    if (g.x >= u32(info.size.x) || g.y >= u32(info.size.y)) { return; }
    textureStore(out_tex, g.xy, compute(g.xy));
}
";
            entries.push(wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: cs,
                ty: wgpu::BindingType::StorageTexture {
                    access: wgpu::StorageTextureAccess::WriteOnly,
                    format: STORE,
                    view_dimension: wgpu::TextureViewDimension::D2,
                },
                count: None,
            });
        }
        if has_pts {
            // dims out (all alike) + positions (engine coords 0..1, y down -> brush x, (1-y)*aspect)
            src += &format!(
                "@group(1) @binding(1) var<storage, read_write> pts: array<vec2f>;
@group(1) @binding(5) var<storage, read_write> out_dims: array<f32>;
@compute @workgroup_size(64) fn cs_pts(@builtin(global_invocation_id) g: vec3u) {{
    if (g.x >= arrayLength(&pts)) {{ return; }}
    let a = to_dims(point(g.x));
    for (var k = 0u; k < {d}u; k++) {{ out_dims[g.x * {d}u + k] = a[k]; }}
    pts[g.x] = vec2f(a[DIM_x], (1.0 - a[DIM_y]) * aspect());
}}
"
            );
            entries.push(wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: cs,
                ty: storage_ty(false),
                count: None,
            });
            entries.push(wgpu::BindGroupLayoutEntry {
                binding: 5,
                visibility: cs,
                ty: storage_ty(false),
                count: None,
            });
            if pingpong {
                src += &format!("@group(1) @binding(2) var<storage, read> prev_dims: array<f32>;
fn prev(i: u32) -> Point {{ var a: array<f32, {d}>; for (var k = 0u; k < {d}u; k++) {{ a[k] = prev_dims[i * {d}u + k]; }} return to_point(a); }}
");
                entries.push(wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: cs,
                    ty: storage_ty(true),
                    count: None,
                });
            }
        }
        let inputs = Inputs::new(device, n, wgpu::ShaderStages::COMPUTE);
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("asemic compute out"),
            entries: &entries,
        });
        let (ptex, ppts) = compile(
            device,
            &src,
            "compute node",
            Some(dims_module(dims, Some((1, 3, "src")))),
            |module| {
                let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: None,
                    bind_group_layouts: &[Some(&inputs.layout), Some(&layout)],
                    immediate_size: 0,
                });
                let pipe = |entry| {
                    device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                        label: Some("asemic compute node"),
                        layout: Some(&pl),
                        module,
                        entry_point: Some(entry),
                        compilation_options: Default::default(),
                        cache: None,
                    })
                };
                (
                    has_tex.then(|| pipe("cs_tex")),
                    has_pts.then(|| pipe("cs_pts")),
                )
            },
        )?;
        let tex = ptex.map(|p| {
            let t = device.create_texture(&wgpu::TextureDescriptor {
                label: Some("asemic compute texture"),
                size: wgpu::Extent3d {
                    width: w,
                    height: h,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: STORE,
                usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            (p, t)
        });
        let dot_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("asemic compute dot"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: true },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let dot = if has_pts && !has_tex {
            let dot_src = format!(
                "@group(0) @binding(0) var<storage, read> pts: array<vec2f>;
                struct V {{ @builtin(position) pos: vec4f }}
                @vertex fn vs(@builtin(vertex_index) vertex: u32) -> V {{
                let corners = array<vec2f, 6>(
                    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
                    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
                let p = pts[vertex / 6u];
                let aspect = {h}.0 / {w}.0;
                let center = vec2f(p.x * 2.0 - 1.0, p.y * 2.0 / aspect - 1.0);
                let half_size = vec2f(4.0 / {w}.0, 4.0 / {h}.0);
                return V(vec4f(center + corners[vertex % 6u] * half_size, 0.0, 1.0));
                }}
                @fragment fn fs() -> @location(0) vec4f {{ return vec4f(1.0); }}"
            );
            let module = {
                let scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
                let m = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("asemic compute dot"),
                    source: wgpu::ShaderSource::Wgsl(dot_src.into()),
                });
                if let Some(e) = pollster::block_on(scope.pop()) {
                    bail!("asemic compute dot: {e}");
                }
                m
            };
            let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("asemic compute dot"),
                layout: Some(
                    &device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                        label: None,
                        bind_group_layouts: &[Some(&dot_layout)],
                        immediate_size: 0,
                    }),
                ),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("vs"),
                    buffers: &[],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("fs"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: crate::FORMAT,
                        blend: Some(wgpu::BlendState::REPLACE),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: wgpu::PrimitiveState {
                    topology: wgpu::PrimitiveTopology::TriangleList,
                    ..Default::default()
                },
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            });
            Some(pipeline)
        } else {
            None
        };
        let buf = |size: u64| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("asemic points"),
                size,
                usage: wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::VERTEX
                    | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            })
        };
        let c = count.max(1) as u64;
        let pts = ppts.map(|p| {
            (
                p,
                (0..1 + pingpong as usize)
                    .map(|_| (buf(c * 8), buf(c * 4 * d as u64)))
                    .collect(),
            )
        });
        Ok(Self {
            inputs,
            layout,
            tex,
            pts,
            src: (storage(device, 4), storage(device, 8)),
            pcur: 0,
            size: (w, h),
            count,
            frame: 0,
            dot,
            dot_layout,
        })
    }

    fn points(&self) -> Option<(&wgpu::Buffer, &wgpu::Buffer)> {
        self.pts
            .as_ref()
            .map(|(_, b)| (&b[self.pcur].0, &b[self.pcur].1))
    }

    #[allow(clippy::too_many_arguments)]
    fn run(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        copy: &Shader,
        ins: &[Option<&wgpu::Texture>],
        raw: &wgpu::Texture,
        t: f32,
        params: &[f32],
        src: &Multi,
    ) {
        let frame = self.frame;
        self.frame = self.frame.wrapping_add(1);
        let g0 = self
            .inputs
            .bind(device, queue, ins, self.size, t, frame, params);
        fill_storage(
            device,
            queue,
            &mut self.src.0,
            bytemuck::cast_slice(&src.lines.concat()),
            4,
        );
        let lines = src.line_table();
        // empty src: one zero-length line (src_count() = 0)
        fill_storage(
            device,
            queue,
            &mut self.src.1,
            bytemuck::cast_slice(if lines.is_empty() {
                &[[0u32, 0]][..]
            } else {
                &lines
            }),
            8,
        );
        let view = self
            .tex
            .as_ref()
            .map(|(_, t)| t.create_view(&Default::default()));
        let mut entries = vec![
            wgpu::BindGroupEntry {
                binding: 3,
                resource: self.src.0.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 4,
                resource: self.src.1.as_entire_binding(),
            },
        ];
        if let Some(v) = &view {
            entries.push(wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(v),
            });
        }
        let next = |b: &Vec<(wgpu::Buffer, wgpu::Buffer)>| (self.pcur + 1) % b.len();
        if let Some((_, b)) = &self.pts {
            entries.push(wgpu::BindGroupEntry {
                binding: 1,
                resource: b[next(b)].0.as_entire_binding(),
            });
            entries.push(wgpu::BindGroupEntry {
                binding: 5,
                resource: b[next(b)].1.as_entire_binding(),
            });
            if b.len() == 2 {
                entries.push(wgpu::BindGroupEntry {
                    binding: 2,
                    resource: b[self.pcur].1.as_entire_binding(),
                });
            }
        }
        let g1 = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &self.layout,
            entries: &entries,
        });
        let mut enc = device.create_command_encoder(&Default::default());
        {
            let mut pass = enc.begin_compute_pass(&Default::default());
            pass.set_bind_group(0, &g0, &[]);
            pass.set_bind_group(1, &g1, &[]);
            if let Some((p, _)) = &self.tex {
                pass.set_pipeline(p);
                pass.dispatch_workgroups(self.size.0.div_ceil(8), self.size.1.div_ceil(8), 1);
            }
            if let Some((p, _)) = &self.pts {
                pass.set_pipeline(p);
                pass.dispatch_workgroups(self.count.div_ceil(64), 1, 1);
            }
        }
        queue.submit([enc.finish()]);
        if let Some((_, b)) = &self.pts {
            self.pcur = next(b);
        }
        match &self.tex {
            Some((_, tex)) => copy.run(device, queue, &[Some(tex)], raw, t, &[]),
            None => {
                // No `fn compute`: either render points as dots (if available) or clear to black.
                if let (Some(dot), Some((_, b))) = (&self.dot, &self.pts) {
                    let pos_buf = &b[self.pcur].0;
                    let dot_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("asemic compute dot"),
                        layout: &self.dot_layout,
                        entries: &[wgpu::BindGroupEntry {
                            binding: 0,
                            resource: pos_buf.as_entire_binding(),
                        }],
                    });
                    let view = raw.create_view(&Default::default());
                    let mut enc = device.create_command_encoder(&Default::default());
                    {
                        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                            label: Some("asemic compute dot"),
                            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                                view: &view,
                                resolve_target: None,
                                ops: wgpu::Operations {
                                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                                    store: wgpu::StoreOp::Store,
                                },
                                depth_slice: None,
                            })],
                            ..Default::default()
                        });
                        pass.set_pipeline(dot);
                        pass.set_vertex_buffer(0, pos_buf.slice(..));
                        pass.set_bind_group(0, &dot_bind, &[]);
                        pass.draw(0..self.count * 6, 0..1);
                    }
                    queue.submit([enc.finish()]);
                } else {
                    crate::clear(device, queue, raw, wgpu::Color::BLACK);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn px(device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture) -> [u8; 4] {
        let b = crate::host::readback(device, queue, tex);
        let i = b.len() / 2 / 4 * 4;
        [b[i], b[i + 1], b[i + 2], b[i + 3]]
    }

    fn spec(kind: &str, inputs: &[&str], wesl: &str) -> NodeSpec {
        NodeSpec {
            kind: kind.into(),
            w: 64,
            h: 64,
            inputs: inputs.iter().map(|s| s.to_string()).collect(),
            wesl: wesl.into(),
            ..Default::default()
        }
    }

    fn running_graph() -> Graph {
        let mut graph = Graph::default();
        graph.timestretch("main", 1.0);
        graph
    }

    fn lit(device: &wgpu::Device, queue: &wgpu::Queue, tex: &wgpu::Texture) -> usize {
        crate::host::readback(device, queue, tex)
            .as_chunks::<4>().0.iter()
            .filter(|p| p[0] > 32 || p[1] > 32 || p[2] > 32)
            .count()
    }

    #[test]
    fn nodes_chain_agnostically() {
        let (device, queue) = crate::device().unwrap();
        let mut g = running_graph();
        // red source -> lygia screen composite with a draw node -> feeds another shader
        g.open(
            &device,
            &queue,
            "red",
            spec(
                "shader",
                &[],
                "fn shade(uv: vec2f) -> vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }",
            ),
        )
        .unwrap();
        g.open(
            &device,
            &queue,
            "lines",
            NodeSpec {
                kind: "draw".into(),
                w: 64,
                h: 64,
                src: vec!["g".into()],
                ..Default::default()
            },
        )
        .unwrap();
        let comp = "import lygia::color::blend::screen::blendScreen3;\nfn shade(uv: vec2f) -> vec4f { return vec4f(blendScreen3(in0(uv).rgb, in1(uv).rgb), 1.0); }";
        g.open(
            &device,
            &queue,
            "comp",
            spec("shader", &["red", "lines"], comp),
        )
        .unwrap();
        g.open(
            &device,
            &queue,
            "half",
            spec(
                "shader",
                &["comp"],
                "fn shade(uv: vec2f) -> vec4f { return in0(uv) * 0.5; }",
            ),
        )
        .unwrap();
        g.open(&device, &queue, "trail", spec("feedback", &["half"], ""))
            .unwrap();
        let gens = BTreeMap::from([(
            "g".to_string(),
            Multi::from_xy([[[0.0f32, 0.5], [1.0, 0.5]]]),
        )]);
        g.render(&device, &queue, &gens, 0.0);
        let [_, _, r, _] = px(&device, &queue, g.tex("half").unwrap()); // BGRA
        assert!((120..=135).contains(&r), "half red {r}");
        let line = crate::host::readback(&device, &queue, g.tex("half").unwrap())
            .as_chunks::<4>().0.iter()
            .filter(|p| p[1] > 100)
            .count();
        assert!(line > 20, "screened line through comp -> half: {line} px");
        assert!(g.tex("trail").is_some());
        assert!(
            g.open(
                &device,
                &queue,
                "x",
                spec(
                    "shader",
                    &[],
                    "fn shade(uv: vec2f) -> vec4f { return nope; }"
                )
            )
            .is_err()
        );
        assert!(g.close("comp") && !g.close("comp"));
        g.render(&device, &queue, &gens, 0.0); // missing input -> black, no panic
        assert_eq!(px(&device, &queue, g.tex("half").unwrap())[2], 0);
    }

    #[test]
    fn cycles_read_last_frame_and_smooth() {
        let (device, queue) = crate::device().unwrap();
        let mut g = running_graph();
        let none = BTreeMap::new();
        // self-input accumulator: +param(0) red per frame
        let pp = |mut s: NodeSpec| {
            s.pingpong = true;
            s
        };
        let mut acc = pp(spec(
            "shader",
            &["acc"],
            "fn shade(uv: vec2f) -> vec4f { return in0(uv) + vec4f(param(0u), 0.0, 0.0, 1.0); }",
        ));
        acc.params = vec![0.1];
        g.open(&device, &queue, "acc", acc).unwrap();
        // smoothed constant white
        let mut s = pp(spec(
            "shader",
            &[],
            "fn shade(uv: vec2f) -> vec4f { return vec4f(1.0); }",
        ));
        s.smooth = 0.5;
        g.open(&device, &queue, "s", s).unwrap();
        // a <-> b cycle
        g.open(
            &device,
            &queue,
            "a",
            pp(spec(
                "shader",
                &["b"],
                "fn shade(uv: vec2f) -> vec4f { return in0(uv) * 0.5 + vec4f(0.25); }",
            )),
        )
        .unwrap();
        g.open(
            &device,
            &queue,
            "b",
            pp(spec(
                "shader",
                &["a"],
                "fn shade(uv: vec2f) -> vec4f { return in0(uv); }",
            )),
        )
        .unwrap();
        let mut sv = vec![];
        for _ in 0..3 {
            g.render(&device, &queue, &none, 0.0);
            sv.push(px(&device, &queue, g.tex("s").unwrap())[0]);
        }
        let r = px(&device, &queue, g.tex("acc").unwrap())[2];
        assert!((70..=84).contains(&r), "3 frames of +0.1: {r}");
        assert!(
            g.param("acc", "0", 0.0)
                && !g.param("nope", "0", 1.0)
                && !g.param("acc", &MAX_PARAMS.to_string(), 1.0)
                && !g.param("acc", "wght", 1.0)
        );
        g.render(&device, &queue, &none, 0.0);
        assert_eq!(
            px(&device, &queue, g.tex("acc").unwrap())[2],
            r,
            "param 0 holds"
        );
        assert!(
            sv[0] > 100 && sv[0] < 160 && sv[1] > sv[0] && sv[2] > sv[1] && sv[2] < 255,
            "smooth {sv:?}"
        );
        for _ in 0..12 {
            g.render(&device, &queue, &none, 0.0);
        }
        assert!(px(&device, &queue, g.tex("s").unwrap())[0] >= 253);
        let a = px(&device, &queue, g.tex("a").unwrap())[0];
        assert!(a > 64, "cycle accumulates toward 0.5: {a}");
    }

    #[test]
    fn compute_texture_and_points_feed_brush() {
        let (device, queue) = crate::device().unwrap();
        let mut g = running_graph();
        let none = BTreeMap::new();
        g.open(
            &device,
            &queue,
            "grad",
            spec(
                "compute",
                &[],
                "fn compute(p: vec2u) -> vec4f { return vec4f(f32(p.x) / 64.0, 0.0, 0.0, 1.0); }",
            ),
        )
        .unwrap();
        let mut pts = spec(
            "compute",
            &[],
            "fn point(i: u32) -> Point { return Point((f32(i) + 0.5) / 64.0 + prev(i).x * 0.0, 0.5); }",
        );
        pts.count = 64;
        pts.pingpong = true;
        g.open(&device, &queue, "pts", pts).unwrap();
        g.open(
            &device,
            &queue,
            "white",
            spec(
                "shader",
                &[],
                "fn shade(uv: vec2f) -> vec4f { return vec4f(1.0); }",
            ),
        )
        .unwrap();
        g.open(
            &device,
            &queue,
            "black",
            spec(
                "shader",
                &[],
                "fn shade(uv: vec2f) -> vec4f { return vec4f(0.0, 0.0, 0.0, 1.0); }",
            ),
        )
        .unwrap();
        let dots = |input: &str| NodeSpec {
            kind: "draw".into(),
            w: 64,
            h: 64,
            inputs: vec![input.into()],
            points: Some("pts".into()),
            count: 64,
            look: Look {
                brush: "dot".into(),
                brightness: Some("return tex0(vec2f(0.5)).r;".into()),
                ..Default::default()
            },
            ..Default::default()
        };
        g.open(&device, &queue, "lit", dots("white")).unwrap();
        g.open(&device, &queue, "dark", dots("black")).unwrap();
        assert!(
            g.open(
                &device,
                &queue,
                "bad",
                spec(
                    "compute",
                    &[],
                    "fn compute(p: vec2u) -> vec4f { return nope; }"
                )
            )
            .is_err()
        );
        g.render(&device, &queue, &none, 0.0);
        g.render(&device, &queue, &none, 0.0);
        let b = crate::host::readback(&device, &queue, g.tex("grad").unwrap());
        let row = 32 * 64 * 4;
        let (l, r) = (b[row + 8 * 4 + 2], b[row + 56 * 4 + 2]);
        assert!(l < 50 && r > 200, "gradient {l}..{r}");
        let (w, h, samples) = g.compute_text(&device, &queue, "grad").unwrap();
        assert_eq!((w, h), (64, 64));
        assert!(
            samples.contains("center (32,32): rgba=(0.502, 0.000, 0.000, 1.000)"),
            "{samples}"
        );
        assert!(g.compute_text(&device, &queue, "pts").is_none());
        assert!(g.points("pts").is_some() && g.points("grad").is_none());
        let on = lit(&device, &queue, g.tex("lit").unwrap());
        assert!(on > 64, "GPU points drawn: {on}");
        let row_lit = crate::host::readback(&device, &queue, g.tex("lit").unwrap())
            [row..row + 64 * 4]
            .as_chunks::<4>().0.iter()
            .filter(|p| p[0] > 32)
            .count();
        assert!(row_lit > 32, "dots along y=0.5 row: {row_lit}");
        assert_eq!(
            lit(&device, &queue, g.tex("dark").unwrap()),
            0,
            "brightness from tex0 (black input)"
        );
        // line brush over the same GPU points: one continuous stroke across the row
        g.open(
            &device,
            &queue,
            "line",
            NodeSpec {
                kind: "draw".into(),
                w: 64,
                h: 64,
                points: Some("pts".into()),
                ..Default::default()
            },
        )
        .unwrap();
        g.render(&device, &queue, &none, 0.0);
        let b = crate::host::readback(&device, &queue, g.tex("line").unwrap());
        let row_lit = (row - 2 * 64 * 4..row + 2 * 64 * 4)
            .step_by(4)
            .filter(|&i| b[i] > 32)
            .count();
        assert!(row_lit > 100, "line brush through GPU points: {row_lit}");
        // curve brush, default instances = count * 8: continuous stroke as well; explicit
        // instances = 4 covers only part of the row
        for (id, inst, min, max) in [("curve", 0, 100, usize::MAX), ("curve4", 4, 1, 100)] {
            let look = Look {
                brush: "curve".into(),
                ..Default::default()
            };
            g.open(
                &device,
                &queue,
                id,
                NodeSpec {
                    kind: "draw".into(),
                    w: 64,
                    h: 64,
                    points: Some("pts".into()),
                    instances: inst,
                    look,
                    ..Default::default()
                },
            )
            .unwrap();
            g.render(&device, &queue, &none, 0.0);
            let b = crate::host::readback(&device, &queue, g.tex(id).unwrap());
            let n = (row - 2 * 64 * 4..row + 2 * 64 * 4)
                .step_by(4)
                .filter(|&i| b[i] > 32)
                .count();
            assert!((min..max).contains(&n), "{id} through GPU points: {n} px");
        }
    }

    #[test]
    fn compute_frame_starts_at_zero_after_global_time_elapsed() {
        let (device, queue) = crate::device().unwrap();
        let mut g = Graph::default();
        g.open(
            &device,
            &queue,
            "frame",
            spec(
                "compute",
                &[],
                "fn compute(p: vec2u) -> vec4f { return vec4f(select(0.0, 1.0, info.frame == 0u), 0.0, 0.0, 1.0); }",
            ),
        )
        .unwrap();

        g.render(&device, &queue, &BTreeMap::new(), 42.0);
        assert_eq!(px(&device, &queue, g.tex("frame").unwrap())[2], 0);
        g.timestretch("main", 1.0);
        g.render(&device, &queue, &BTreeMap::new(), 42.1);
        assert!(px(&device, &queue, g.tex("frame").unwrap())[2] > 200);
        g.render(&device, &queue, &BTreeMap::new(), 42.2);
        assert!(px(&device, &queue, g.tex("frame").unwrap())[2] < 20);
    }

    #[test]
    fn seed_helpers_compile_and_are_noise() {
        // every node's preamble carries hash21/hash22/valueNoise/fbm (graph.rs `SEED`): a field
        // seeded from them is non-flat (a blank/uniform seed is what leaves RD canvases empty).
        let (device, queue) = crate::device().unwrap();
        let mut g = running_graph();
        g.open(
            &device,
            &queue,
            "seed",
            spec(
                "compute",
                &[],
                "fn compute(p: vec2u) -> vec4f { let uv = (vec2f(p) + 0.5) / info.size; \
                 return vec4f(fbm(uv * 8.0, 4u), valueNoise(uv * 3.0), hash21(uv * 50.0), 1.0); }",
            ),
        )
        .unwrap();
        g.render(&device, &queue, &BTreeMap::new(), 0.0);
        let px = crate::host::readback(&device, &queue, g.tex("seed").unwrap());
        let distinct: std::collections::BTreeSet<(u8, u8, u8)> =
            px.as_chunks::<4>().0.iter().map(|p| (p[0], p[1], p[2])).collect();
        assert!(distinct.len() > 4, "seed helpers produced a flat field: {distinct:?}");
    }

    #[test]
    fn point_only_compute_preview_renders_visible_aspect_correct_dots() {
        let (device, queue) = crate::device().unwrap();
        let mut g = running_graph();
        let mut points = spec(
            "compute",
            &[],
            "fn point(i: u32) -> Point { return Point(0.5, 0.5); }",
        );
        points.w = 1280;
        points.h = 720;
        points.count = 1;
        g.open(&device, &queue, "point", points).unwrap();

        g.render(&device, &queue, &BTreeMap::new(), 0.0);

        let tex = g.tex("point").unwrap();
        let pixels = crate::host::readback(&device, &queue, tex);
        let center = ((360 * 1280 + 640) * 4) as usize;
        assert!(
            pixels[center..center + 3]
                .iter()
                .any(|channel| *channel > 32)
        );
        assert!(
            lit(&device, &queue, tex) >= 8,
            "dot should survive preview downsampling"
        );
    }

    #[test]
    fn ascii_picks_ramp_glyph_per_cell() {
        let (device, queue) = crate::device().unwrap();
        let mut g = running_graph();
        // left half black, right half white -> 8 x 8 cells of 8 px: ' ' left, '@' right
        g.open(
            &device,
            &queue,
            "src",
            spec(
                "shader",
                &[],
                "fn shade(uv: vec2f) -> vec4f { return vec4f(step(0.5, uv.x)); }",
            ),
        )
        .unwrap();
        g.open(
            &device,
            &queue,
            "a",
            NodeSpec {
                params: vec![8.0],
                ramp: " @".into(),
                ..spec("ascii", &["src"], "")
            },
        )
        .unwrap();
        g.render(&device, &queue, &BTreeMap::new(), 0.0);
        let px = crate::host::readback(&device, &queue, g.tex("a").unwrap());
        let cell = |cx: usize, cy: usize| -> Vec<bool> {
            (0..64)
                .map(|i| px[((cy * 8 + i / 8) * 64 + cx * 8 + i % 8) * 4] > 127)
                .collect()
        };
        use font8x8::UnicodeFonts;
        let at = font8x8::BASIC_FONTS.get('@').unwrap();
        let want: Vec<bool> = (0..64).map(|i| at[i / 8] >> (i % 8) & 1 == 1).collect();
        for cy in 0..8 {
            assert!(cell(1, cy).iter().all(|b| !b), "dark cell = space");
            assert_eq!(cell(6, cy), want, "light cell = '@' bitmap");
        }
        // asemic glyph atlas builds and draws something on light cells
        g.open(
            &device,
            &queue,
            "b",
            NodeSpec {
                font: "asemic".into(),
                ramp: " AB".into(),
                ..spec("ascii", &["src"], "")
            },
        )
        .unwrap();
        g.render(&device, &queue, &BTreeMap::new(), 0.0);
        assert!(lit(&device, &queue, g.tex("b").unwrap()) > 0);
        assert!(
            g.open(&device, &queue, "c", spec("ascii", &[], ""))
                .is_err()
        );
    }

    #[test]
    fn mesh_strokes_and_fills_closed_square() {
        let (device, queue) = crate::device().unwrap();
        let mut g = running_graph();
        let mesh = |src: &str| NodeSpec {
            src: vec![src.into()],
            look: Look {
                brush: "mesh".into(),
                ..Default::default()
            },
            ..spec("draw", &[], "")
        };
        g.open(&device, &queue, "open", mesh("line")).unwrap();
        g.open(&device, &queue, "sq", mesh("square")).unwrap();
        let mut line = Multi::new(&["width"]);
        line.lines = vec![vec![0.1, 0.5, 1.0, 0.9, 0.5, 3.0]];
        let sq = Multi::from_xy([[
            [0.25f32, 0.25],
            [0.75, 0.25],
            [0.75, 0.75],
            [0.25, 0.75],
            [0.25, 0.25],
        ]]);
        let gens = BTreeMap::from([("line".to_string(), line), ("square".to_string(), sq)]);
        g.render(&device, &queue, &gens, 0.0);
        let px = |id: &str, x: usize, y: usize| {
            crate::host::readback(&device, &queue, g.tex(id).unwrap())[(y * 64 + x) * 4]
        };
        assert!(px("open", 32, 32) > 200, "stroke renders");
        let col = |x: usize| (0..64).filter(|&y| px("open", x, y) > 127).count();
        assert!(
            col(54) > col(10),
            "width attr widens the right end: {} vs {}",
            col(10),
            col(54)
        );
        assert!(
            px("sq", 32, 32) > 200,
            "fill covers the closed square's interior"
        );
        assert_eq!(px("sq", 4, 4), 0);
        assert!(
            g.open(
                &device,
                &queue,
                "bad",
                NodeSpec {
                    look: Look {
                        brush: "mesh".into(),
                        width: Some("return 2.0;".into()),
                        ..Default::default()
                    },
                    ..mesh("line")
                }
            )
            .is_err()
        );
    }

    #[test]
    fn shader_node_calls_lygia_prewitt_on_raw_bindings() {
        // raw tex0/samp bindings (alongside in0(uv)) let user WESL call lygia filters that
        // need the texture+sampler signature naga rejects behind a helper fn.
        let (device, queue) = crate::device().unwrap();
        let mut g = running_graph();
        g.open(
            &device,
            &queue,
            "half",
            spec(
                "shader",
                &[],
                "fn shade(uv: vec2f) -> vec4f { return vec4f(step(0.5, uv.x)); }",
            ),
        )
        .unwrap();
        let wesl = "import lygia::filter::edge::prewitt::edgePrewitt;\nfn shade(uv: vec2f) -> vec4f { return vec4f(edgePrewitt(tex0, samp, uv, 1.0 / info.size), 1.0); }";
        g.open(&device, &queue, "edges", spec("shader", &["half"], wesl))
            .unwrap();
        g.render(&device, &queue, &BTreeMap::new(), 0.0);
        // the vertical black/white edge at uv.x = 0.5 lights a column near the middle
        let b = crate::host::readback(&device, &queue, g.tex("edges").unwrap());
        let col = |x: usize| (0..64).filter(|&y| b[(y * 64 + x) * 4] > 32).count();
        assert!(col(32) > 20, "prewitt edge column at x=32: {}", col(32));
        assert_eq!(col(4), 0, "flat region = no edge");
    }

    #[test]
    fn last_frame_reads_need_pingpong() {
        let (device, queue) = crate::device().unwrap();
        let mut g = running_graph();
        let err = |g: &mut Graph, id: &str, s: NodeSpec| {
            g.open(&device, &queue, id, s)
                .err()
                .map(|e| e.to_string())
                .unwrap_or_default()
        };
        let e = err(&mut g, "y", spec("shader", &["y"], COPY));
        assert!(e.contains("pingpong") && e.contains("reads itself"), "{e}");
        let e = err(
            &mut g,
            "s",
            NodeSpec {
                smooth: 0.5,
                ..spec("shader", &[], COPY)
            },
        );
        assert!(e.contains("pingpong") && e.contains("smooth"), "{e}");
        let mut p = spec(
            "compute",
            &[],
            "fn point(i: u32) -> Point { return prev(i); }",
        );
        p.count = 4;
        let e = err(&mut g, "p", p);
        assert!(e.contains("pingpong") && e.contains("prev"), "{e}");
        g.open(
            &device,
            &queue,
            "a",
            NodeSpec {
                pingpong: true,
                ..spec("shader", &["b"], COPY)
            },
        )
        .unwrap();
        let e = err(&mut g, "b", spec("shader", &["a"], COPY));
        assert!(
            e.contains("pingpong") && e.contains("b -> a -> b") && e.contains("[\"b\"]"),
            "{e}"
        );
        g.open(
            &device,
            &queue,
            "b",
            NodeSpec {
                pingpong: true,
                ..spec("shader", &["a"], COPY)
            },
        )
        .unwrap();
        // later reopen makes "a" plain: its back-edge read stays black, no in-flight texture
        g.open(
            &device,
            &queue,
            "c",
            spec(
                "shader",
                &[],
                "fn shade(uv: vec2f) -> vec4f { return vec4f(1.0); }",
            ),
        )
        .unwrap();
        g.render(&device, &queue, &BTreeMap::new(), 0.0);
    }
}
