//! REPL verbs: every livecode helper (`param`, `xy`, `route`, ...) is a query on
//! `asemic/brain/do` handled here, so Python only forwards `(verb, args, kwargs)`.
//! Rust builds + validates the component/route (no hand-built dicts on the Python
//! side → no schema drift), writes it to storage, and tracks which label owns it.

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use serde_json::{Map, Value, json};
use tokio::sync::Mutex;
use zenoh::{
    Session,
    bytes::Encoding,
    qos::{CongestionControl, Priority},
};

use asemic_schema::{Component, Route, ids, keys};

pub const DO: &str = "asemic/brain/do";
pub const VERBS: &str = "asemic/brain/verbs";
const SESSION_PREFIX: &str = "asemic/state/session/";

/// (verb, positional arg names, doc). Python builds its namespace from this table.
pub const TABLE: &[(&str, &[&str], &str)] = &[
    (
        "param",
        &["id", "min", "max", "default"],
        "Slider -> asemic/value/<id>.value. kw: step curve label anim mode depth channel",
    ),
    (
        "multi",
        &["id", "min", "max", "default", "n"],
        "Multislider (param array) -> asemic/value/<id>.<i>, i = 0..n (default 8, max 64); each index routable as '<id>.<i>'. kw: step curve label",
    ),
    (
        "xy",
        &["id", "x", "y", "default"],
        "XY pad -> asemic/value/<id>.{x,y}. kw: label anim mode(drift) depth channel",
    ),
    (
        "proc",
        &[
            "id", "proc", "input", "seed", "text", "axiom", "rules", "scale_by", "path", "attrs",
        ],
        "Processor / signal generator -> asemic/value/<id>.<channel> + asemic/gen/<id> (point multiarray). proc: physics wave spectrum glyph (text=...) melody (voices base beats step slow; dims pitch dur) variations py (fn in the REPL via @proc(id, 'py'); brain sends params + input gen on change, caches reply) lsys (axiom=, rules='0.5: F -> F[+F]F; ...', n angle step growth; input=<gen id> roots a tree per point, stride, scale, scale_by=<attr>) text (text=, path=<font file, hot reload>, x y size + axis tags e.g. wght as params) chaos perlin simplex lfo random-walk white gauss; input = key (io stream / 'chaos:x' / 'gain'); other kw = params",
    ),
    (
        "vfont",
        &["name", "masters", "chars", "dir", "live", "hz"],
        "live=True: rebuild on master component/param changes (debounced, <= hz/s, default 10, latest only; block owns it). Variable font from glyph procs: masters = >= 2 glyph proc ids (seed + params; param stroke = outline width, font units, 60), chars (default 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; asemic font has no lowercase), dir ('fonts'); writes UFOs + designspace (norad), compiles <dir>/<name>.ttf (fontc), axis ASMC 0..n-1; announces asemic/state/vfont/<name>; returns path. proc('t', 'text', path=..) hot-reloads it, ASMC routable",
    ),
    (
        "set",
        &["comp", "key_or_value", "value"],
        "set('gain', .5) / set('arena', 'x', .2) / set('arena.x', .2); paths relative to the block: 'm.n', '../m.n', '/t/m.n'",
    ),
    (
        "route",
        &["src", "dst", "id"],
        "route('gain', 'supercollider.set.freq', frm=(0,1), to=(40,2000)); src 'chaos:vx' = noise channel. kw: combine='replace'|'add'|'multiply' (plugtype vs dst's current value)",
    ),
    ("delete", &["id"], "Delete a component"),
    ("tempo", &["bpm", "ppq", "beats_per_bar"], "Set clock"),
    (
        "ui",
        &[],
        "UI/perf settings (asemic_schema::UiSettings -> asemic/state/ui): image=auto|quad|halfcell|tgp|sixel|unicode hz=20 clock=True; no kw = return current",
    ),
    (
        "cue",
        &["id", "values", "fade"],
        "cue('drop', {'intensity': 2, 'arena.x': .3})",
    ),
    ("go", &["id"], "Fire a cue"),
    (
        "drop",
        &["label"],
        "Remove everything a block label created",
    ),
    ("stop", &["name"], "Stop adapter"),
    ("build", &["name"], "Build adapter"),
    ("status", &["name"], "Adapter status"),
    ("adapters", &[], "Adapter manifests"),
    (
        "output",
        &[
            "name",
            "kind",
            "w",
            "h",
            "src",
            "post",
            "brush",
            "width",
            "alpha",
            "brightness",
            "position",
            "hz",
            "node",
        ],
        "Open output (request/response; block owns it): kind syphon -> Syphon server asemic:<name> (w x h), draws src gen ids (str/list) with the asemic-repl line brush; post = none / feedback (asemic-repl main.wgsl); brush = line/curve/dot; width/alpha/brightness/position = WGSL modifier bodies (info: ModifierInfo); jack + src = x/y oscilloscope audio (out_1 x, out_2 y), drawing traced hz times/s (60); failed reopen keeps the old output; syphon outputs stream asemic/preview/<name> (~10 fps, <=160x90) only while subscribed (view(name, kind='frame')); kind jack -> JACK client asemic-<name>, w = channels; outputs() reports clients + visible; node = publish a texture node (tex) instead of src",
    ),
    (
        "tex",
        &[
            "id",
            "kind",
            "inputs",
            "attrs",
            "src",
            "adapter",
            "wesl",
            "w",
            "h",
            "brush",
            "width",
            "alpha",
            "brightness",
            "position",
            "points",
            "count",
            "instances",
            "pingpong",
            "smooth",
            "params",
            "text",
            "publish",
            "server",
            "ramp",
            "font",
            "atlas",
            "axes",
        ],
        "Texture node (request/response; block owns it), any node id usable as input/output node: kind in (adapter = '<adapter>:<name>', e.g. 'syphon:TouchDesigner'; legacy kind syphon + server) / draw (src gen ids or points = compute node id (count, instances for line/curve), brush look; inputs sampled as tex0(uv)..tex3(uv) in modifiers) / shader (wesl defines fn shade(uv: vec2f) -> vec4f, may import lygia::…; in0(uv)..in7(uv) sample inputs, info.time, info.size, param(i)) / compute (wesl fn compute(p: vec2u) -> vec4f and/or fn point(i: u32) -> Point with count; Point = struct over dims, DIM_<name> consts, src_point(i)/attr(i,k) read src gens; prev(i) -> Point needs pingpong; attrs={name: default} appends dims; brush modifiers read attr(info, DIM_<name>)) / feedback (1 input, asemic-repl trails) / ascii (1 input; luma per cell -> glyph of ramp (dark -> light), font ascii|asemic atlas, or atlas='text:<font path>' = font outlines filled at axes={tag: v} (routable via texparam / asemic/tex/<id>.param.<tag>; rebuilt on change + font hot-reload), ramp sorted by glyph coverage; params [columns, colour]); pingpong = keep last frame (self-inputs, cycles, smooth 0..1); params = up to 16 floats (texparam / asemic/tex/<id>.param.<i>); text = compute node: preview its sampled output values as a text grid (numbers) instead of the raster canvas; publish = sink addresses ('syphon' -> asemic:<id>); w h = 1280 720",
    ),
    (
        "texparam",
        &["id", "i", "v"],
        "Set texture node uniform param(i), or i = axis tag of an ascii text atlas (also Zenoh put asemic/tex/<id>.param.<i|tag>, JSON number; routable)",
    ),
    ("untex", &["id"], "Close a texture node"),
    (
        "texs",
        &[],
        "List texture nodes (+ dims = live point dims of draw/compute nodes)",
    ),
    (
        "procs",
        &[],
        "List procs: declared attrs {name: default} + live dims (point layout of asemic/gen/<id>)",
    ),
    ("close", &["name"], "Close an output"),
    ("outputs", &[], "List open outputs + client counts"),
];

#[derive(Default)]
struct Owners {
    owned: BTreeMap<String, BTreeSet<String>>,
    pending: BTreeMap<String, BTreeSet<String>>,
}

#[derive(Clone)]
pub struct Verbs {
    z: Session,
    o: Arc<Mutex<Owners>>,
    draw: asemic_draw::host::Host,
    /// per output: Zenoh matching on `asemic/preview/<id>` -> host preview on/off
    previews: Arc<std::sync::Mutex<BTreeMap<String, tokio::task::JoinHandle<()>>>>,
    /// live vfonts: name -> master watcher (block owns `vfont:<name>`; drop aborts it)
    vfonts: Arc<std::sync::Mutex<BTreeMap<String, tokio::task::JoinHandle<()>>>>,
}

/// Merge positional args into kwargs by the verb's arg names.
pub fn bind(verb: &str, args: &[Value], kwargs: &Map<String, Value>) -> Result<Map<String, Value>> {
    let (_, names, _) = TABLE
        .iter()
        .find(|t| t.0 == verb)
        .ok_or_else(|| anyhow!("unknown verb {verb:?}"))?;
    if args.len() > names.len() {
        bail!(
            "{verb}: takes {} positional args, got {}",
            names.len(),
            args.len()
        );
    }
    let mut m = kwargs.clone();
    for (n, v) in names.iter().zip(args) {
        if m.insert(n.to_string(), v.clone()).is_some() {
            bail!("{verb}: {n} given twice");
        }
    }
    Ok(m)
}

fn take(m: &mut Map<String, Value>, k: &str) -> Option<Value> {
    m.remove(k).filter(|v| !v.is_null())
}

fn s(m: &mut Map<String, Value>, k: &str) -> Result<String> {
    match take(m, k) {
        Some(Value::String(s)) => Ok(s),
        Some(v) => bail!("{k}: expected string, got {v}"),
        None => bail!("{k}: required"),
    }
}

fn pair(v: Value, k: &str) -> Result<[f64; 2]> {
    let a = v
        .as_array()
        .filter(|a| a.len() == 2)
        .ok_or_else(|| anyhow!("{k}: expected (lo, hi)"))?;
    let f = |i: usize| a[i].as_f64().ok_or_else(|| anyhow!("{k}: not a number"));
    Ok([f(0)?, f(1)?])
}

fn no_extra(verb: &str, m: &Map<String, Value>) -> Result<()> {
    match m.keys().next() {
        Some(k) => bail!("{verb}: unexpected argument {k:?}"),
        None => Ok(()),
    }
}

/// `anim='chaos'` + mode/depth/channel kwargs -> Anim JSON.
fn anim(m: &mut Map<String, Value>, default_mode: &str) -> Option<Value> {
    let a = take(m, "anim");
    let mode = take(m, "mode").unwrap_or(json!(default_mode));
    let depth = take(m, "depth").unwrap_or(json!(1.0));
    let channel = take(m, "channel");
    match a? {
        Value::String(src) => {
            Some(json!({"source": src, "mode": mode, "depth": depth, "channel": channel}))
        }
        other => Some(other),
    }
}

fn opt(o: &mut Map<String, Value>, m: &mut Map<String, Value>, k: &str) {
    if let Some(v) = take(m, k) {
        o.insert(k.into(), v);
    }
}

/// Build a validated Component from REPL kwargs.
pub fn component(verb: &str, mut m: Map<String, Value>) -> Result<Component> {
    let id = s(&mut m, "id")?;
    let mut o = Map::new();
    o.insert("id".into(), json!(id));
    o.insert("type".into(), json!(verb));
    o.insert("speed".into(), take(&mut m, "speed").unwrap_or(json!(1.0)));
    opt(&mut o, &mut m, "label");
    match verb {
        "param" => {
            o.insert("min".into(), take(&mut m, "min").unwrap_or(json!(0.0)));
            o.insert("max".into(), take(&mut m, "max").unwrap_or(json!(1.0)));
            for k in ["default", "step", "curve"] {
                opt(&mut o, &mut m, k);
            }
            if let Some(a) = anim(&mut m, "add") {
                o.insert("anim".into(), a);
            }
        }
        "multi" => {
            o.insert("min".into(), take(&mut m, "min").unwrap_or(json!(0.0)));
            o.insert("max".into(), take(&mut m, "max").unwrap_or(json!(1.0)));
            o.insert("n".into(), take(&mut m, "n").unwrap_or(json!(8)));
            for k in ["default", "step", "curve"] {
                opt(&mut o, &mut m, k);
            }
        }
        "xy" => {
            let d = take(&mut m, "default")
                .map(|v| pair(v, "default"))
                .transpose()?
                .unwrap_or([0.0, 0.0]);
            for (i, ax) in ["x", "y"].into_iter().enumerate() {
                let r = take(&mut m, ax)
                    .map(|v| pair(v, ax))
                    .transpose()?
                    .unwrap_or([-1.0, 1.0]);
                o.insert(
                    ax.into(),
                    json!({"min": r[0], "max": r[1], "default": d[i]}),
                );
            }
            if let Some(a) = anim(&mut m, "drift") {
                o.insert("anim".into(), a);
            }
        }
        "proc" => {
            o.insert(
                "proc".into(),
                take(&mut m, "proc").context("proc: kind required")?,
            );
            o.insert("seed".into(), take(&mut m, "seed").unwrap_or(json!(0)));
            let lsys = o["proc"] == "lsys";
            if let Some(Value::String(i)) = take(&mut m, "input") {
                // lsys reads a gen multiarray: id (block-qualified by `qualify`, may contain '/') = asemic/gen/<id>
                let (k, f) = if lsys && !i.contains(':') && !i.starts_with("asemic/") {
                    (crate::engine::gen_key(&i), None)
                } else {
                    src_key(&i)
                };
                o.insert(
                    "input".into(),
                    json!(match f {
                        Some(f) => format!("{k}#{f}"),
                        None => k,
                    }),
                );
            }
            if let Some(t) = take(&mut m, "text").or_else(|| take(&mut m, "scale_by")) {
                o.insert("text".into(), t);
            }
            if let Some(f) = take(&mut m, "path") {
                o.insert("path".into(), f);
            }
            if let Some(a) = take(&mut m, "attrs") {
                o.insert("attrs".into(), a);
            }
            if let Some(a) = take(&mut m, "axiom") {
                o.insert("axiom".into(), a);
            }
            match take(&mut m, "rules") {
                Some(Value::String(r)) => {
                    o.insert(
                        "rules".into(),
                        json!(
                            r.split(';')
                                .map(str::trim)
                                .filter(|r| !r.is_empty())
                                .collect::<Vec<_>>()
                        ),
                    );
                }
                Some(r) => {
                    o.insert("rules".into(), r);
                }
                None => {}
            }
            o.insert("params".into(), Value::Object(std::mem::take(&mut m)));
        }
        _ => bail!("{verb}: not a component"),
    }
    no_extra(verb, &m)?;
    let c: Component =
        serde_json::from_value(Value::Object(o)).with_context(|| format!("{verb} {id:?}"))?;
    c.validate()?;
    Ok(c)
}

/// 'intensity' / 'arena.x' / 'plant/pos.x' / 'chaos:vx' / full key -> (key, field).
pub fn src_key(s: &str) -> (String, Option<String>) {
    // Raw Zenoh key (already resolved/absolute) -- everything else (including a leftover
    // `/`-nested path the caller didn't resolve) still needs dotted-id parsing below.
    if s.starts_with("asemic/") {
        return (s.into(), None);
    }
    if let Some((nid, field)) = s.split_once(':') {
        return (keys::value(nid, field), None);
    }
    let (comp, key) = ids::field(s, "value");
    (keys::value(comp, key), None)
}

pub fn dst_key(s: &str) -> String {
    if s.starts_with("asemic/") {
        return s.into();
    }
    // `<gen>.attr.<name>` = offset of that gen's dim (param `attr.<name>`)
    if let (g, f) = ids::field(s, "") && f.starts_with("attr.") {
        return keys::param(g, f);
    }
    let (adapter, key) = s.split_once('.').unwrap_or((s, "value"));
    format!("asemic/out/{adapter}/{}", key.replace('.', "/"))
}

/// Path-resolve every id/ref field of `verb` from the calling block's scope (`asemic_schema::ids`).
/// route src/dst resolve in `call` (they may also name adapters/io).
fn qualify(verb: &str, sc: &[&str], m: &mut Map<String, Value>) {
    let fields: &[&str] = match verb {
        "param" | "multi" | "xy" | "proc" => &["id", "input"],
        "set" => &["comp"],
        "delete" | "texparam" | "untex" => &["id"],
        "tex" => &["id", "inputs", "src", "points"],
        "output" => &["src", "node"],
        "vfont" => &["masters"],
        _ => &[],
    };
    let r = |v: &mut Value| {
        if let Value::String(s) = v {
            *s = ids::resolve(sc, s);
        }
    };
    for k in fields {
        match m.get_mut(*k) {
            Some(Value::Array(a)) => a.iter_mut().for_each(r),
            Some(v) => r(v),
            None => {}
        }
    }
    if let Some(Value::String(a)) = m.get_mut("anim") {
        *a = ids::resolve(sc, a);
    }
    if verb == "cue"
        && let Some(Value::Object(vals)) = m.get_mut("values") {
            *vals = std::mem::take(vals)
                .into_iter()
                .map(|(t, v)| (ids::resolve(sc, &t), v))
                .collect();
        }
}


pub fn route(mut m: Map<String, Value>) -> Result<Route> {
    let label = take(&mut m, "label").and_then(|v| match v {
        Value::String(s) if !s.is_empty() && s != "main" => Some(s),
        _ => None,
    });
    let mut src = s(&mut m, "src")?;
    let mut dst = s(&mut m, "dst")?;
    if let Some(l) = &label {
        if !dst.contains('.') && !dst.contains('/') {
            dst = ids::join(l, &dst);
        }
        if src.starts_with('.') && !src.starts_with("./") && !src.starts_with("..") {
            src = format!("{l}{src}");
        } else if !src.contains(['.', '/', ':']) {
            // bare id = block-local param (same scoping as `param(...)`)
            src = ids::join(l, &src);
        }
    }
    let (skey, sfield) = src_key(&src);
    let id = match take(&mut m, "id") {
        Some(Value::String(i)) => i,
        // one route per destination: the route IS keyed by its (canonical) dst
        _ => dst.clone(),
    };
    let field = take(&mut m, "field")
        .and_then(|v| v.as_str().map(String::from))
        .or(sfield);
    let from = take(&mut m, "frm")
        .or_else(|| take(&mut m, "from"))
        .map(|v| pair(v, "frm"))
        .transpose()?
        .unwrap_or([0.0, 1.0]);
    let to = take(&mut m, "to")
        .map(|v| pair(v, "to"))
        .transpose()?
        .unwrap_or([0.0, 1.0]);
    let curve = take(&mut m, "curve").unwrap_or(json!("linear"));
    let combine = take(&mut m, "combine").unwrap_or(json!("replace"));
    no_extra("route", &m)?;
    let r: Route = serde_json::from_value(json!({
        "id": id, "src": skey, "field": field, "dst": dst_key(&dst), "from": from, "to": to, "curve": curve, "combine": combine,
    }))?;
    r.validate()?;
    Ok(r)
}

fn num(v: &Value, what: &str) -> Result<f64> {
    v.as_f64()
        .ok_or_else(|| anyhow!("{what}: not a number: {v}"))
}

impl Verbs {
    pub async fn new(z: Session, draw: asemic_draw::host::Host) -> Result<Self> {
        let mut o = Owners::default();
        let replies = z
            .get(format!("{SESSION_PREFIX}**"))
            .timeout(Duration::from_secs(2))
            .await
            .map_err(anyhow::Error::msg)?;
        while let Ok(r) = replies.recv_async().await {
            if let Ok(sm) = r.result() {
                let label = sm
                    .key_expr()
                    .as_str()
                    .trim_start_matches(SESSION_PREFIX)
                    .to_string();
                let v: Value = serde_json::from_slice(&sm.payload().to_bytes()).unwrap_or_default();
                let owns = v["owns"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|t| t.as_str().map(String::from))
                    .collect();
                o.owned.insert(label, owns);
            }
        }
        let v = Self {
            z,
            o: Arc::new(Mutex::new(o)),
            draw,
            previews: Default::default(),
            vfonts: Default::default(),
        };
        // graph starts empty: drop stale node state from the storage
        v.del(&format!("{}**", keys::TEX_PREFIX)).await?;
        Ok(v)
    }

    /// Node state for the controls panel (`asemic/state/tex/<id>` = NodeInfo), pushed on change.
    async fn push_node(&self, id: &str) -> Result<()> {
        match self.draw.nodes().await?.into_iter().find(|n| n.id == id) {
            Some(n) => self.put(&format!("{}{id}", keys::TEX_PREFIX), &n).await,
            None => self.del(&format!("{}{id}", keys::TEX_PREFIX)).await,
        }
    }

    async fn param(&self, id: &str, key: &str, v: f32) -> Result<()> {
        self.draw.param(id, key, v);
        self.push_node(id).await
    }

    /// Control scalars -> texture node uniforms: `asemic/tex/<id>.param.<i>`, JSON number
    /// (bridges.rs convention); same path as the `texparam` verb, so the panel state follows.
    pub async fn params(self) -> Result<()> {
        let sub = self
            .z
            .declare_subscriber(keys::TEX_PARAMS)
            .with(flume::unbounded())
            .await
            .map_err(anyhow::Error::msg)?;
        while let Ok(s) = sub.recv_async().await {
            let v = serde_json::from_slice::<f32>(&s.payload().to_bytes()).ok();
            if let (Some((id, key)), Some(v)) = (keys::tex_param_of(s.key_expr().as_str()), v) {
                let _ = self.param(id, key, v).await;
            }
        }
        Ok(())
    }

    /// COOK (`asemic/block/<label>.step`) -> draw host: tex nodes play exactly one frame.
    pub async fn sync_step(self) -> Result<()> {
        let sub = self
            .z
            .declare_subscriber(keys::BLOCK_STEP)
            .with(flume::unbounded())
            .await
            .map_err(anyhow::Error::msg)?;
        while let Ok(s) = sub.recv_async().await {
            let k = s.key_expr().as_str();
            if let Some(l) = keys::id_of(k, keys::BLOCK_TIME_PREFIX, keys::BLOCK_STEP_SUFFIX) { self.draw.step_block(l); }
        }
        Ok(())
    }

    /// Per-block timestretch -> draw host (tex nodes freeze when ts=0.0); restore = storage replay.
    pub async fn sync_timestretch(self) -> Result<()> {
        let sub = self
            .z
            .declare_subscriber(keys::BLOCK_TIMESTRETCH)
            .with(flume::unbounded())
            .await
            .map_err(anyhow::Error::msg)?;
        for (k, v) in self.query(keys::BLOCK_TIMESTRETCH, 2.0).await.unwrap_or_default() {
            if let Some(rest) = k.strip_prefix(keys::BLOCK_PREFIX)
                && let Some(label) = rest.strip_suffix(keys::TIMESTRETCH_SUFFIX) {
                    let ts = v.as_f64().unwrap_or(0.0);
                    self.draw.timestretch(label, ts);
                }
        }
        while let Ok(s) = sub.recv_async().await {
            let Some(rest) = s.key_expr().as_str().strip_prefix(keys::BLOCK_PREFIX) else {
                continue;
            };
            let Some(label) = rest.strip_suffix(keys::TIMESTRETCH_SUFFIX) else {
                continue;
            };
            if s.kind() == zenoh::sample::SampleKind::Put {
                let ts = serde_json::from_slice::<f64>(&s.payload().to_bytes()).unwrap_or(0.0);
                self.draw.timestretch(label, ts);
            } else {
                self.draw.clear_timestretch(label);
            }
        }
        Ok(())
    }

    /// Live per-block playhead -> draw host: each node's `info.time` = its own block's time
    /// (falls back to the global frame clock when a block has no clock).
    pub async fn sync_block_time(self) -> Result<()> {
        let sub = self
            .z
            .declare_subscriber(keys::BLOCK_TIME)
            .with(flume::unbounded())
            .await
            .map_err(anyhow::Error::msg)?;
        while let Ok(s) = sub.recv_async().await {
            let Some(rest) = s.key_expr().as_str().strip_prefix(keys::BLOCK_TIME_PREFIX) else {
                continue;
            };
            let Some(label) = rest.strip_suffix(keys::BLOCK_TIME_SUFFIX) else {
                continue;
            };
            match s.kind() {
                zenoh::sample::SampleKind::Put => {
                    if let Ok(t) = serde_json::from_slice::<f64>(&s.payload().to_bytes()) {
                        self.draw.block_time(label, t);
                    }
                }
                _ => self.draw.clear_block_time(label),
            }
        }
        Ok(())
    }

    async fn close_node(&self, id: &str) -> Result<bool> {        if let Some(t) = self
            .previews
            .lock()
            .unwrap()
            .remove(&format!("{}{id}", asemic_draw::host::NODE_PREVIEW))
        {
            t.abort();
        }
        let r = self.draw.node_close(id).await?;
        self.del(&format!("{}{id}", keys::TEX_PREFIX)).await?;
        Ok(r)
    }

    /// Terminal preview is demand-driven: frames flow only while `asemic/preview/<id>` has a
    /// subscriber (REPL `view(name, kind='frame')`), via Zenoh publisher matching.
    fn watch_preview(&self, name: &str) {
        let (z, draw, name) = (self.z.clone(), self.draw.clone(), name.to_string());
        let key = name.clone();
        let task = tokio::spawn(async move {
            let Ok(p) = z.declare_publisher(keys::preview(preview_id(&name))).await else {
                return;
            };
            let Ok(l) = p.matching_listener().await else {
                return;
            };
            draw.preview(&name, p.matching_status().await.is_ok_and(|s| s.matching()));
            // viewer's box size (cells) -> preview grid
            let Ok(sizes) = z
                .declare_subscriber(keys::preview_size(preview_id(&name)))
                .with(flume::unbounded())
                .await
            else {
                return;
            };
            loop {
                tokio::select! {
                    s = l.recv_async() => match s { Ok(s) => draw.preview(&name, s.matching()), Err(_) => break },
                    s = sizes.recv_async() => match s {
                        Ok(s) => match serde_json::from_slice::<asemic_schema::PreviewSize>(&s.payload().to_bytes()) {
                            Ok(v) => draw.preview_size(&name, v.cols, v.rows),
                            Err(e) => tracing::warn!("preview size {name}: {e}"),
                        },
                        Err(_) => break,
                    },
                }
            }
        });
        if let Some(old) = self.previews.lock().unwrap().insert(key, task) {
            old.abort();
        }
    }

    async fn close_output(&self, name: &str) -> Result<bool> {
        if let Some(t) = self.previews.lock().unwrap().remove(name) {
            t.abort();
        }
        self.draw.close(name).await
    }

    async fn put(&self, key: &str, v: &impl serde::Serialize) -> Result<()> {
        self.z
            .put(key, serde_json::to_vec(v)?)
            .encoding(Encoding::APPLICATION_JSON)
            .priority(Priority::InteractiveHigh)
            .congestion_control(CongestionControl::Block)
            .await
            .map_err(anyhow::Error::msg)
    }

    async fn del(&self, key: &str) -> Result<()> {
        self.z.delete(key).await.map_err(anyhow::Error::msg)
    }

    async fn own(&self, label: Option<&str>, tag: String) {
        if let Some(l) = label {
            self.o
                .lock()
                .await
                .pending
                .entry(l.into())
                .or_default()
                .insert(tag);
        }
    }

    /// Masters (component seed + params, overlaid by live `asemic/state/param/<id>.$*`) ->
    /// compile off the runtime (spawn_blocking) -> atomic .ttf write -> announce.
    async fn vfont_build(
        &self,
        name: &str,
        chars: &str,
        ids: &[String],
        dir: &str,
    ) -> Result<String> {
        let mut masters = vec![];
        for id in ids {
            // masters put earlier in the same block may not be in storage yet: retry ~1s
            let mut got = None;
            for _ in 0..20 {
                got = self.query(&keys::component(id), 2.0).await?.into_iter().next();
                if got.is_some() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let (_, v) = got.with_context(|| format!("vfont: no component {id:?}"))?;
            match serde_json::from_value::<Component>(v)?.kind {
                asemic_schema::ComponentKind::Proc {
                    processor: asemic_schema::ProcKind::Glyph,
                    seed,
                    mut params,
                    ..
                } => {
                    for (k, v) in self
                        .query(&format!("{}{id}.$*", keys::PARAM_PREFIX), 2.0)
                        .await?
                    {
                        if let (Some(p), Some(v)) = (keys::id_of(&k, &format!("{}{id}.", keys::PARAM_PREFIX), ""), v.as_f64()) {
                            params.insert(p.into(), v);
                        }
                    }
                    masters.push(crate::vfont::Master::new(seed, &params));
                }
                _ => bail!("vfont: {id:?} is not a glyph proc"),
            }
        }
        let (n, c, d) = (name.to_string(), chars.to_string(), dir.to_string());
        let ttf = tokio::task::spawn_blocking(move || {
            crate::vfont::build(&n, &c, &masters, std::path::Path::new(&d))
        })
        .await??;
        let path = std::fs::canonicalize(&ttf)?.display().to_string();
        self.put(
            &format!("asemic/state/vfont/{name}"),
            &json!({ "path": path, "axis": crate::vfont::AXIS.1, "masters": ids }),
        )
        .await?;
        Ok(path)
    }

    /// Live vfont: storage change events on the masters' component / param keys mark dirty;
    /// at most `hz` rebuilds/s, one compile in flight (awaited in this loop), so bursts
    /// coalesce into one rebuild of the latest state.
    async fn vfont_watch(
        self,
        name: String,
        chars: String,
        ids: Vec<String>,
        dir: String,
        hz: f64,
    ) -> Result<()> {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
        let mut subs = vec![];
        for id in &ids {
            for key in [keys::component(id), format!("{}{id}.$*", keys::PARAM_PREFIX)] {
                let tx = tx.clone();
                subs.push(
                    self.z
                        .declare_subscriber(&key)
                        .callback(move |_| {
                            let _ = tx.send(());
                        })
                        .await
                        .map_err(anyhow::Error::msg)?,
                );
            }
        }
        let period = Duration::from_secs_f64(1.0 / hz);
        while rx.recv().await.is_some() {
            tokio::time::sleep(period).await; // debounce
            while rx.try_recv().is_ok() {} // coalesce: latest state only
            let t0 = std::time::Instant::now();
            match self.vfont_build(&name, &chars, &ids, &dir).await {
                Ok(_) => tracing::debug!("vfont {name}: rebuilt in {:?}", t0.elapsed()),
                Err(e) => tracing::warn!("vfont {name}: {e:#}"),
            }
        }
        drop(subs);
        Ok(())
    }

    async fn remove(&self, tag: &str) -> Result<()> {
        let (kind, id) = tag.split_once(':').unwrap_or((tag, ""));
        match kind {
            "component" => {
                self.del(&keys::pause(id)).await?;
                self.del(&keys::component(id)).await?;
                self.del(&format!("{}{id}.$*", keys::PARAM_PREFIX)).await
            }
            "route" => self.del(&format!("{}{id}", keys::ROUTE_PREFIX)).await,
            "cue" => self.del(&format!("asemic/state/cue/{id}")).await,
            "output" => self.close_output(id).await.map(|_| ()),
            "tex" => {
                self.del(&keys::pause(id)).await?;
                self.close_node(id).await.map(|_| ())
            }
            "vfont" => {
                if let Some(h) = self.vfonts.lock().unwrap().remove(id) {
                    h.abort();
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    async fn query(&self, sel: &str, timeout: f64) -> Result<Vec<(String, Value)>> {
        let replies = self
            .z
            .get(sel)
            .timeout(Duration::from_secs_f64(timeout))
            .await
            .map_err(anyhow::Error::msg)?;
        let mut out = vec![];
        while let Ok(r) = replies.recv_async().await {
            match r.result() {
                Ok(sm) => out.push((
                    sm.key_expr().to_string(),
                    serde_json::from_slice(&sm.payload().to_bytes()).unwrap_or(Value::Null),
                )),
                Err(e) => bail!("{}", e.payload().try_to_string().unwrap_or_default()),
            }
        }
        Ok(out)
    }

    /// Block lifecycle: `begin` clears what this run creates; `commit` prunes what the
    /// label created last run but not this one (only when the block ran without error).
    pub async fn begin(&self, label: &str) {
        self.o
            .lock()
            .await
            .pending
            .insert(label.into(), BTreeSet::new());
    }

    pub async fn commit(&self, label: &str, ok: bool, code: &str) -> Result<Value> {
        let (stale, owns) = {
            let mut o = self.o.lock().await;
            let made = o.pending.remove(label).unwrap_or_default();
            let prev = o.owned.remove(label).unwrap_or_default();
            if ok {
                let stale: Vec<String> = prev.difference(&made).cloned().collect();
                o.owned.insert(label.into(), made.clone());
                (stale, Some(made))
            } else {
                o.owned.insert(label.into(), &prev | &made);
                (vec![], None)
            }
        };
        for t in &stale {
            self.remove(t).await?;
        }
        if let Some(owns) = owns {
            self.put(
                &format!("{SESSION_PREFIX}{label}"),
                &json!({"code": code, "owns": owns}),
            )
            .await?;
        }
        Ok(json!(stale))
    }

    /// Drop every label not in `keep` (labels deleted from the file).
    pub async fn sync(&self, keep: &[String]) -> Result<Value> {
        let gone: Vec<String> = self
            .o
            .lock()
            .await
            .owned
            .keys()
            .filter(|l| !keep.contains(l))
            .cloned()
            .collect();
        for l in &gone {
            self.drop_label(l).await?;
        }
        Ok(json!(gone))
    }

    async fn drop_label(&self, label: &str) -> Result<()> {
        let tags = self.o.lock().await.owned.remove(label).unwrap_or_default();
        for t in &tags {
            self.remove(t).await?;
        }
        self.del(&format!("{SESSION_PREFIX}{label}")).await
    }

    /// `r` (resolved, maybe `<id>.<field>` / `<id>:<ch>`) names a live component?
    async fn is_comp_ref(&self, r: &str) -> bool {
        self.query(&keys::component(ids::split_field(r).0), 1.0)
            .await
            .is_ok_and(|v| !v.is_empty())
    }

    async fn set(&self, comp: &str, key: &str, v: f64) -> Result<()> {
        self.put(&keys::param(comp, key), &v).await
    }

    /// Run one verb; `label` = the block calling it (ownership).
    pub async fn call(
        &self,
        verb: &str,
        label: Option<&str>,
        args: &[Value],
        kwargs: &Map<String, Value>,
    ) -> Result<Value> {
        match verb {
            "begin" => {
                self.begin(label.context("begin: label")?).await;
                return Ok(Value::Null);
            }
            "commit" => {
                let ok = kwargs.get("ok").and_then(Value::as_bool).unwrap_or(true);
                let code = kwargs.get("code").and_then(Value::as_str).unwrap_or("");
                return self.commit(label.context("commit: label")?, ok, code).await;
            }
            "sync" => {
                let keep: Vec<String> =
                    serde_json::from_value(kwargs.get("labels").cloned().unwrap_or(json!([])))?;
                return self.sync(&keep).await;
            }
            _ => {}
        }
        let mut m = bind(verb, args, kwargs)?;
        let sc = ids::scope(label);
        // a param named in a block that is itself a component (e.g. `with block("word")`) also sets it
        let bare = m.get("id").and_then(Value::as_str).map(String::from);
        qualify(verb, &sc, &mut m);
        match verb {
            "param" | "multi" | "xy" => {
                if let (Some(l), Some(name)) = (label.filter(|_| !sc.is_empty()), &bare)
                    && !self.query(&keys::component(l), 1.0).await?.is_empty()
                        && let Some(def) = m.get("default").and_then(Value::as_f64) {
                            let _ = self.set(l, name, def).await;
                        }
                let c = component(verb, m)?;
                self.put(&keys::component(&c.id), &c).await?;
                self.own(label, format!("component:{}", c.id)).await;
                Ok(json!(c.id))
            }
            "noise" | "proc" | "randomizer" => {
                let c = component(verb, m)?;
                self.put(&keys::component(&c.id), &c).await?;
                self.own(label, format!("component:{}", c.id)).await;
                Ok(json!(c.id))
            }
            "route" => {
                let mut scoped_dst = false;
                if let Some(l) = label.filter(|l| !l.is_empty() && *l != "main") {
                    m.entry("label").or_insert_with(|| json!(l));
                    if let Some(Value::String(dst)) = m.get_mut("dst") {
                        scoped_dst = dst.starts_with("attr.") || !dst.contains(['.', '/']);
                        if dst.starts_with("attr.") {
                            *dst = format!("{l}.{dst}");
                        } else if !dst.contains(['.', '/']) {
                            let is_attr = if let Ok(comps) =
                                self.query(&keys::component(l), 1.0).await
                            {
                                comps
                                    .into_iter()
                                    .next()
                                    .and_then(|(_, v)| serde_json::from_value::<Component>(v).ok())
                                    .is_some_and(|c| {
                                        if let asemic_schema::ComponentKind::Proc {
                                            attrs, ..
                                        } = c.kind
                                        {
                                            attrs.contains_key(dst.as_str())
                                        } else {
                                            false
                                        }
                                    })
                            } else {
                                false
                            };
                            *dst = if is_attr {
                                format!("{l}.attr.{dst}")
                            } else {
                                ids::resolve(&sc, dst)
                            };
                        }
                    }
                }
                // src/dst = paths to components, else adapter/io names (`supercollider.set.freq`, `osc.x`) kept raw.
                // `/` is unambiguous nesting syntax -- any ref using it is resolved unconditionally;
                // bare `name.field` strings resolve only if they name a component, so adapter/io
                // names (`supercollider.set.freq`) aren't clobbered.
                for k in ["src", "dst"] {
                    if k == "dst" && scoped_dst {
                        continue; // already block-scoped above; re-resolving doubles the label
                    }
                    if let Some(Value::String(v)) = m.get(k).cloned() {
                        let r = ids::resolve(&sc, &v);
                        if r != v && (v.contains('/') || self.is_comp_ref(&r).await) {
                            m.insert(k.into(), json!(r));
                        }
                    }
                }
                // `<comp>.<k>` with comp a component -> its param (what `set` writes), else
                // adapter out (`asemic/out/<adapter>/<k>`, in `route`/`dst_key`). Route id =
                // the canonical dst (one route per destination).
                let dst_opt = m
                    .get("dst")
                    .and_then(|v| v.as_str())
                    .filter(|d| !d.starts_with("asemic/"))
                    .map(String::from);
                if let Some(dst_str) = dst_opt {
                    let (comp, k) = ids::field(&dst_str, "value");
                    if !k.starts_with("attr.")
                        && !self.query(&keys::component(comp), 1.0).await?.is_empty()
                    {
                        let canon = format!("{comp}.{k}");
                        m.entry("id").or_insert_with(|| json!(canon));
                        m.insert("dst".into(), json!(keys::param(comp, k)));
                    }
                }
                let r = route(m)?;
                self.put(&format!("{}{}", keys::ROUTE_PREFIX, r.id), &r)
                    .await?;
                self.own(label, format!("route:{}", r.id)).await;
                Ok(json!(r.id))
            }
            "set" => {
                let mut comp = s(&mut m, "comp")?;
                let kv = take(&mut m, "key_or_value").context("set: value")?;
                let (key, v) = match take(&mut m, "value") {
                    Some(v) => (
                        kv.as_str()
                            .context("set: key must be a string")?
                            .to_string(),
                        num(&v, "set")?,
                    ),
                    None => ("value".into(), num(&kv, "set")?),
                };
                // `set('m.n', v)` / `set('/t/m.n', v)`: path to the component, `.n` = its property
                let mut key = key;
                if key == "value" {
                    let (c, k) = ids::field(&comp, "value");
                    (comp, key) = (c.to_string(), k.to_string());
                }
                // `set('size', v)` in a block that is itself a component -> that component's param
                if let Some(l) = label.filter(|_| !sc.is_empty())
                    && self.query(&keys::component(&comp), 1.0).await?.is_empty()
                        && !self.query(&keys::component(l), 1.0).await?.is_empty()
                    {
                        comp = l.into();
                    }
                anyhow::ensure!(
                    !self.query(&keys::component(&comp), 1.0).await?.is_empty(),
                    "set: no component {comp:?} (paths are block-relative: 'm.n', '../m.n', '/t/m.n')"
                );
                self.set(&comp, &key, v).await?;
                Ok(Value::Null)
            }
            "delete" => {
                self.remove(&format!("component:{}", s(&mut m, "id")?))
                    .await?;
                Ok(Value::Null)
            }
            "tempo" => {
                let bpm = num(&take(&mut m, "bpm").context("tempo: bpm")?, "bpm")?;
                let ppq = take(&mut m, "ppq").unwrap_or(json!(24));
                let bpb = take(&mut m, "beats_per_bar").unwrap_or(json!(4));
                self.put(
                    keys::CLOCK_STATE,
                    &json!({"bpm": bpm, "ppq": ppq, "beats_per_bar": bpb}),
                )
                .await?;
                Ok(Value::Null)
            }
            "ui" => {
                let cur = match self
                    .query(keys::UI_STATE, 0.5)
                    .await
                    .ok()
                    .and_then(|r| r.into_iter().next())
                {
                    Some((_, v)) => v,
                    None => serde_json::to_value(asemic_schema::UiSettings::default())?,
                };
                let mut merged = cur;
                for (k, v) in m {
                    merged[k] = v;
                }
                let ui: asemic_schema::UiSettings = serde_json::from_value(merged).context("ui")?;
                self.put(keys::UI_STATE, &ui).await?;
                Ok(serde_json::to_value(ui)?)
            }
            "cue" => {
                let id = s(&mut m, "id")?;
                let values = take(&mut m, "values")
                    .filter(Value::is_object)
                    .context("cue: values must be a dict")?;
                for (t, v) in values.as_object().unwrap() {
                    num(v, t)?;
                }
                let fade = take(&mut m, "fade").unwrap_or(json!(0.0));
                self.put(
                    &format!("asemic/state/cue/{id}"),
                    &json!({"id": id, "values": values, "fade": fade}),
                )
                .await?;
                self.own(label, format!("cue:{id}")).await;
                Ok(json!(id))
            }
            "go" => {
                let id = s(&mut m, "id")?;
                let r = self.query(&format!("asemic/state/cue/{id}"), 2.0).await?;
                let (_, cue) = r
                    .into_iter()
                    .next()
                    .with_context(|| format!("no cue {id:?}"))?;
                for (t, v) in cue["values"].as_object().into_iter().flatten() {
                    let (comp, key) = ids::field(t, "value");
                    self.set(comp, key, num(v, t)?).await?;
                }
                Ok(Value::Null)
            }
            "drop" => {
                self.drop_label(&s(&mut m, "label")?).await?;
                Ok(Value::Null)
            }
            "stop" | "build" => {
                let name = s(&mut m, "name")?;
                let r = self.query(&keys::adapter(&name, verb), 10.0).await?;
                match r.len() {
                    0 => bail!("no adapter {name:?}"),
                    1 => Ok(r.into_iter().next().unwrap().1),
                    _ => Ok(r
                        .into_iter()
                        .collect::<Map<_, _>>()
                        .into()),
                }
            }
            "output" => {
                let name = s(&mut m, "name")?;
                let kind = take(&mut m, "kind")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or("syphon".into());
                let dim = |v: Option<Value>, d: u32| {
                    v.and_then(|v| v.as_u64()).map(|v| v as u32).unwrap_or(d)
                };
                let (dw, dh) = if asemic_draw::io::audio_adapters().contains(&kind.as_str()) {
                    (2, 0)
                } else {
                    (1280, 720)
                }; // audio: w = channels
                let (w, h) = (dim(take(&mut m, "w"), dw), dim(take(&mut m, "h"), dh));
                let src = match take(&mut m, "src") {
                    Some(Value::String(s)) => vec![s],
                    Some(v) => serde_json::from_value(v)
                        .map_err(|_| anyhow!("output: src = gen id or list of ids"))?,
                    None => vec![],
                };
                let post = take(&mut m, "post")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or("none".into());
                let look = [
                    "brush",
                    "width",
                    "alpha",
                    "brightness",
                    "position",
                    "hz",
                    "node",
                ]
                .into_iter()
                .filter_map(|k| take(&mut m, k).map(|v| (k.to_string(), v)))
                .collect::<Map<_, _>>();
                let look = serde_json::from_value(Value::Object(look))
                    .map_err(|e| anyhow!("output: {e}"))?;
                no_extra("output", &m)?;
                let info = self.draw.open(&name, &kind, w, h, src, &post, look).await?;
                if kind == "syphon" {
                    self.watch_preview(&name);
                }
                self.own(label, format!("output:{name}")).await;
                Ok(serde_json::to_value(info)?)
            }
            "tex" => {
                let id = s(&mut m, "id")?;
                let ids = |v: Option<Value>, k: &str| -> Result<Vec<String>> {
                    Ok(match v {
                        Some(Value::String(s)) => vec![s],
                        Some(v) => serde_json::from_value(v)
                            .map_err(|_| anyhow!("tex: {k} = id or list of ids"))?,
                        None => vec![],
                    })
                };
                let (inputs, src, publish) = (
                    ids(take(&mut m, "inputs"), "inputs")?,
                    ids(take(&mut m, "src"), "src")?,
                    ids(take(&mut m, "publish"), "publish")?,
                );
                // draw links against its gens' live dims (attr(info, DIM_<k>)): a gen declared in
                // the same block may not have published yet -> await its dims announce (event, <= 2 s)
                let mut decl = Map::new();
                for g in &src {
                    let key = keys::attrs(g);
                    let sub = self
                        .z
                        .declare_subscriber(&key)
            .with(flume::unbounded())
                        .await
                        .map_err(anyhow::Error::msg)?;
                    // ready = every declared attr live in dims (a stale announce may predate re-declare)
                    let ready = |v: &Value| {
                        v["declared"].as_object().is_some_and(|d| {
                            let dims = v["dims"].as_array().cloned().unwrap_or_default();
                            d.keys().all(|k| dims.iter().any(|x| x == k))
                        })
                    };
                    let mut got = self
                        .query(&key, 0.5)
                        .await?
                        .into_iter()
                        .map(|(_, v)| v)
                        .find(ready);
                    if got.is_none() {
                        got = tokio::time::timeout(Duration::from_secs(2), async {
                            while let Ok(sm) = sub.recv_async().await {
                                match serde_json::from_slice::<Value>(&sm.payload().to_bytes()) {
                                    Ok(v) if ready(&v) => return Some(v),
                                    _ => {}
                                }
                            }
                            None
                        })
                        .await
                        .ok()
                        .flatten();
                    }
                    // draw links against its own gen frames, which may lag the announce -> pin every live dim
                    // (declared default, else 0 for generator-made dims e.g. lsys depth/root) in the spec
                    if let Some(v) = &got {
                        for d in v["dims"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter_map(Value::as_str)
                            .filter(|d| !matches!(*d, "x" | "y"))
                        {
                            decl.insert(
                                d.into(),
                                v["declared"].get(d).cloned().unwrap_or(json!(0.0)),
                            );
                        }
                    }
                }
                if !decl.is_empty() {
                    let a = m.entry("attrs").or_insert(json!({}));
                    if let Some(a) = a.as_object_mut() {
                        for (k, v) in decl {
                            a.entry(k).or_insert(v);
                        }
                    }
                }
                m.insert("publish".into(), json!(publish));
                m.entry("w").or_insert(json!(1280));
                m.entry("h").or_insert(json!(720));
                m.insert("inputs".into(), json!(inputs));
                m.insert("src".into(), json!(src));
                let spec =
                    serde_json::from_value(Value::Object(m)).map_err(|e| anyhow!("tex: {e}"))?;
                let info = self.draw.node(&id, spec).await?;
                self.watch_preview(&format!("{}{id}", asemic_draw::host::NODE_PREVIEW));
                self.put(&format!("{}{id}", keys::TEX_PREFIX), &info)
                    .await?;
                self.own(label, format!("tex:{id}")).await;
                Ok(serde_json::to_value(info)?)
            }
            "texparam" => {
                let id = s(&mut m, "id")?;
                let key = match take(&mut m, "i") {
                    Some(Value::Number(i)) if i.is_u64() => i.to_string(),
                    Some(Value::String(tag)) => tag,
                    _ => bail!("texparam: i = param index or ascii atlas axis tag"),
                };
                let v = num(
                    &take(&mut m, "v").ok_or_else(|| anyhow!("texparam: v"))?,
                    "texparam v",
                )? as f32;
                no_extra("texparam", &m)?;
                self.param(&id, &key, v).await?;
                Ok(Value::Null)
            }
            "vfont" => {
                let name = s(&mut m, "name")?;
                let ids: Vec<String> = serde_json::from_value(
                    take(&mut m, "masters").context("vfont: masters = glyph proc ids")?,
                )?;
                let chars = take(&mut m, "chars")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_else(|| "ABCDEFGHIJKLMNOPQRSTUVWXYZ".into());
                let dir = take(&mut m, "dir")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_else(|| "fonts".into());
                let live = take(&mut m, "live").is_some_and(|v| v.as_bool() == Some(true));
                let hz = take(&mut m, "hz")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(10.0)
                    .clamp(0.1, 120.0);
                no_extra("vfont", &m)?;
                if let Some(h) = self.vfonts.lock().unwrap().remove(&name) {
                    h.abort();
                }
                let path = self.vfont_build(&name, &chars, &ids, &dir).await?;
                let name_key = name.clone();
                if live {
                    self.own(label, format!("vfont:{name}")).await;
                    let me = self.clone();
                    let h = tokio::spawn(async move {
                        if let Err(e) = me.vfont_watch(name.clone(), chars, ids, dir, hz).await {
                            tracing::warn!("vfont {name}: {e:#}");
                        }
                    });
                    if let Some(old) = self.vfonts.lock().unwrap().insert(name_key, h) {
                        old.abort();
                    }
                }
                Ok(json!(path))
            }
            "untex" => Ok(json!(self.close_node(&s(&mut m, "id")?).await?)),
            "texs" => Ok(serde_json::to_value(self.draw.nodes().await?)?),
            "procs" => {
                let live: Map<String, Value> = self
                    .query(&keys::wildcard("asemic/meta/", ".attrs"), 2.0)
                    .await?
                    .into_iter()
                    .filter_map(|(k, v)| Some((keys::id_of(&k, "asemic/meta/", ".attrs")?.to_string(), v)))
                    .collect();
                let mut out = Map::new();
                for (_, v) in self.query(keys::COMPONENTS, 2.0).await? {
                    let Ok(c) = serde_json::from_value::<Component>(v) else {
                        continue;
                    };
                    if let asemic_schema::ComponentKind::Proc {
                        processor, attrs, ..
                    } = c.kind
                    {
                        let dims = live
                            .get(&c.id)
                            .map(|l| l["dims"].clone())
                            .unwrap_or(json!([]));
                        out.insert(
                            c.id.clone(),
                            json!({"proc": processor, "attrs": attrs, "dims": dims}),
                        );
                    }
                }
                Ok(Value::Object(out))
            }
            "close" => Ok(json!(self.close_output(&s(&mut m, "name")?).await?)),
            "outputs" => Ok(serde_json::to_value(self.draw.list().await?)?),
            "status" | "adapters" => {
                let name = take(&mut m, "name")
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or("*".into());
                let what = if verb == "status" { "status" } else { "schema" };
                let r = self.query(&keys::adapter(&name, what), 2.0).await?;
                Ok(r.into_iter()
                    .filter_map(|(k, v)| {
                        let name = k.strip_prefix("asemic/adapter/")?.split_once('/')?.0;
                        Some((name.to_string(), v))
                    })
                    .collect::<Map<_, _>>()
                    .into())
            }
            _ => bail!("unknown verb {verb:?}"),
        }
    }

    pub async fn serve(self) -> Result<()> {
        let q_do = self
            .z
            .declare_queryable(DO)
            .await
            .map_err(anyhow::Error::msg)?;
        let q_verbs = self
            .z
            .declare_queryable(VERBS)
            .await
            .map_err(anyhow::Error::msg)?;
        // ready = token, !polled: frontends wait on liveliness (rig.py `ensure`)
        let _ready = self
            .z
            .liveliness()
            .declare_token(asemic_schema::keys::BRAIN_READY)
            .await
            .map_err(anyhow::Error::msg)?;
        let table: Value = TABLE
            .iter()
            .map(|(v, a, d)| json!({"verb": v, "args": a, "doc": d}))
            .collect();
        loop {
            tokio::select! {
                q = q_verbs.recv_async() => {
                    let q = q.map_err(anyhow::Error::msg)?;
                    let _ = q.reply(VERBS, table.to_string()).encoding(Encoding::APPLICATION_JSON).await;
                }
                q = q_do.recv_async() => {
                    let q = q.map_err(anyhow::Error::msg)?;
                    let me = self.clone();
                    // spawn: adapter start/build can take seconds; callers wait on their own reply
                    tokio::spawn(async move {
                        let body: Value = q.payload().and_then(|p| serde_json::from_slice(&p.to_bytes()).ok()).unwrap_or_default();
                        let verb = body["verb"].as_str().unwrap_or("");
                        let label = body["label"].as_str();
                        let args = body["args"].as_array().cloned().unwrap_or_default();
                        let kwargs = body["kwargs"].as_object().cloned().unwrap_or_default();
                        let r = me.call(verb, label, &args, &kwargs).await;
                        let out = match r {
                            Ok(v) => q.reply(DO, serde_json::to_vec(&v).unwrap_or_default()).encoding(Encoding::APPLICATION_JSON).await,
                            Err(e) => q.reply_err(format!("{e:#}")).await,
                        };
                        if let Err(e) = out {
                            tracing::warn!("do {verb}: {e}");
                        }
                    });
                }
            }
        }
    }
}

/// draw-host preview name -> wire id: tex nodes drop their internal `tex/` prefix, so every
/// preview is `asemic/preview/<id>` (output name / node id).
pub fn preview_id(name: &str) -> &str {
    name.strip_prefix(asemic_draw::host::NODE_PREVIEW).unwrap_or(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kw(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn param_positional_and_anim() {
        let m = bind(
            "param",
            &[json!("gain"), json!(0), json!(2)],
            &kw(json!({"anim": "chaos", "depth": 0.5})),
        )
        .unwrap();
        let c = component("param", m).unwrap();
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["max"], json!(2.0));
        assert_eq!(v["anim"]["source"], json!("chaos"));
        assert_eq!(v["anim"]["mode"], json!("add"));
    }

    #[test]
    fn xy_defaults_and_drift() {
        let c = component(
            "xy",
            kw(json!({"id": "arena", "anim": "chaos", "default": [0.2, 0.3]})),
        )
        .unwrap();
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["x"]["default"], json!(0.2));
        assert_eq!(v["anim"]["mode"], json!("drift"));
    }

    #[test]
    fn rejects_typos_and_bad_values() {
        assert!(component("param", kw(json!({"id": "g", "mx": 2}))).is_err());
        assert!(component("param", kw(json!({"id": "g", "min": 1, "max": 1}))).is_err());
        assert!(component("noise", kw(json!({"id": "n", "gen": "nope"}))).is_err());
        assert!(bind("param", &[json!("g")], &kw(json!({"id": "h"}))).is_err());
    }

    #[test]
    fn route_shorthands() {
        let r = route(kw(
            json!({"src": "chaos:vx", "dst": "hue.bri", "frm": [-1, 1], "to": [0, 254]}),
        ))
        .unwrap();
        assert_eq!(r.src, "asemic/value/chaos.vx");
        assert_eq!(r.field, None);
        assert_eq!(r.dst, "asemic/out/hue/bri");
        assert_eq!(r.id, "hue.bri"); // route id = canonical dst
    }

    #[test]
    fn route_relative_scoping_with_label() {
        let r = route(kw(
            json!({"src": "chaos:vx", "dst": "angle", "label": "plant"}),
        ))
        .unwrap();
        assert_eq!(r.dst, "asemic/out/plant/angle/value");
        assert_eq!(r.id, "plant/angle");

        // relative src with leading dot
        let r2 = route(kw(
            json!({"src": ".bias", "dst": "angle", "label": "plant"}),
        ))
        .unwrap();
        assert_eq!(r2.src, "asemic/value/plant.bias");
        assert_eq!(r2.dst, "asemic/out/plant/angle/value");
    }

    #[test]
    fn route_multislider_index_to_texture_param() {
        let r = route(kw(json!({
            "src": "gpgpu.controls.knobs.0",
            "dst": "asemic/tex/gpgpu/swarm.param.0"
        })))
        .unwrap();
        assert_eq!(r.src, "asemic/value/gpgpu.controls.knobs.0");
        assert_eq!(r.dst, "asemic/tex/gpgpu/swarm.param.0");
    }
}
