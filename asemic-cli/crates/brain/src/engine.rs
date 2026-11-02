//! Component engine (plan §8.1.2–8.1.3): holds component defs + manual base values,
//! steps noisegens, applies `anim`, emits `asemic/value/<id>.<key>` (component values and noise/proc channels alike).
//! Pure state machine; zenoh glue lives in `live.rs`.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Value, json};

use asemic_schema::{Anim, AnimMode, Component, ComponentKind, Range, ids, keys};

use crate::node::{Channels, Gen, Params};

struct ProcSlot {
    source: Box<dyn Gen>,
    params: Params,
    last: Channels,
    /// Processor input: (key, json field); `asemic/io/..` = fed by `feed_io`.
    /// `asemic/gen/<id>` = previous frame's multiarray of that gen (`feed_points`).
    input: Option<(String, Option<String>)>,
    frame: u32,
    /// last emitted multiarray (fed to processors reading `asemic/gen/<id>`)
    pts: Option<asemic_schema::Multi>,
    /// declared dims {name: default} (proc `attrs`)
    attrs: BTreeMap<String, f64>,
    /// last announced dim names (`asemic/meta/<id>.attrs`)
    dims: Vec<String>,
}


/// Derived channel names (multiarray attrs) → `&'static str` for `Channels`; bounded by the
/// distinct attr names ever seen.
fn intern(k: &str) -> &'static str {
    static SEEN: std::sync::Mutex<std::collections::BTreeSet<&'static str>> =
        std::sync::Mutex::new(std::collections::BTreeSet::new());
    let mut seen = SEEN.lock().unwrap();
    if let Some(s) = seen.get(k) {
        return s;
    }
    let s: &'static str = Box::leak(k.into());
    seen.insert(s);
    s
}

#[derive(Default)]
pub struct Engine {
    components: BTreeMap<String, Component>,
    /// Manual values from `asemic/state/param/<comp>.<key>`.
    base: BTreeMap<(String, String), f64>,
    procs: BTreeMap<String, ProcSlot>,
    /// Drift positions per (comp, key).
    drift: BTreeMap<(String, String), f64>,
    /// Keys changed outside the frame loop; published on next step.
    dirty: BTreeSet<(String, String)>,
    /// Latest published payload per key; answers `get` on value/proc keys.
    last: BTreeMap<String, Value>,
    /// Per-block timestretch (`keys::BLOCK_PREFIX + label + "/timestretch"`): f64 multiplier
    /// for dt (0.0 = frozen, 1.0 = real-time, >1 = faster). Blocks are hierarchical: a
    /// component `foo.bar.baz` uses the nearest defined value walking from `foo` to its full id.
    /// Missing scopes default to frozen (0.0).
    /// Supersedes the old `paused` (bool set) system.
    timestretch: BTreeMap<String, f64>,
    /// Per-block playback clock (J 2026-10-13): a playhead that advances by `dt * timestretch`,
    /// bounded by an optional `length` (seconds; None = infinite) and shaped by a `loop`
    /// envelope (a point multiarray, the same curve data procs emit, so proc-generated timing
    /// can drive blocks later). Keyed by block label like `timestretch`.
    blocks: BTreeMap<String, BlockClock>,
    /// COOK (`asemic/block/<label>.step`): blocks played for exactly the next frame, i.e.
    /// timestretch 1 for one `step` then restored -- the same path as play, one frame long.
    steps: BTreeSet<String>,
    /// py procs whose reply landed while frozen: published once even at timestretch 0 (the
    /// reply to a stepped frame's call is that frame's output).
    fresh: BTreeSet<String>,
}

/// One block's playback state. `raw` = linear accumulated seconds; `eval` maps it through
/// `length` + `envelope` to the playhead shaders see.
#[derive(Clone)]
struct BlockClock {
    raw: f64,
    /// Playback length in seconds; None or <= 0 = infinite (`raw` is the playhead).
    length: Option<f64>,
    /// Loop envelope: dims `phase` (0..1 in) -> `time` (0..1 out). Empty = identity ramp.
    envelope: asemic_schema::Multi,
    /// Wrap the phase (repeat) vs clamp it at 1 (play once and hold). Default: wrap.
    wrap: bool,
    /// Last published playhead seconds; a frozen/idle clock then republishes nothing.
    out: Option<f64>,
}

impl Default for BlockClock {
    fn default() -> Self {
        Self { raw: 0.0, length: None, envelope: asemic_schema::Multi::default(), wrap: true, out: None }
    }
}

impl BlockClock {
    /// Envelope output 0..1 for a 0..1 `phase` (identity when no envelope is set).
    fn shape(&self, phase: f64) -> f64 {
        let k = self.envelope.attr("time").or_else(|| self.envelope.attr("y"));
        match k {
            Some(k) if !self.envelope.is_empty() => {
                self.envelope.sample_dim(phase.clamp(0.0, 1.0) as f32, k).unwrap_or(phase as f32) as f64
            }
            _ => phase,
        }
    }

    /// Playhead seconds from the accumulated `raw` seconds.
    fn eval(&self) -> f64 {
        match self.length.filter(|l| *l > 0.0) {
            None => self.raw,
            Some(len) => {
                let phase = self.raw / len;
                let phase = if self.wrap { phase.rem_euclid(1.0) } else { phase.clamp(0.0, 1.0) };
                len * self.shape(phase)
            }
        }
    }

    /// Loop presets as curves: `off`/`hold` = ramp (play once), `loop` = ramp (wrapped),
    /// `pingpong` = triangle. Unknown = `loop`.
    fn preset(name: &str) -> (asemic_schema::Multi, bool) {
        let mut m = asemic_schema::Multi { attrs: vec!["phase".into(), "time".into()], lines: vec![] };
        let pts: &[[f32; 2]] = match name {
            "off" | "once" | "hold" => &[[0.0, 0.0], [1.0, 1.0]],
            "pingpong" | "bounce" => &[[0.0, 0.0], [0.5, 1.0], [1.0, 0.0]],
            _ => &[[0.0, 0.0], [1.0, 1.0]],
        };
        m.lines = vec![pts.iter().flat_map(|p| p.iter().copied()).collect()];
        (m, !matches!(name, "off" | "once" | "hold"))
    }
}

pub enum Out {
    Put(String, Value),
    Delete(String),
    /// Binary payload (point buffers); not remembered for late joiners.
    Bytes(String, Vec<u8>),
    /// `py` proc call: query `asemic/py/<id>` (the REPL's queryable); the reply -> `py_reply`.
    Call(String, Vec<u8>),
}

pub fn gen_key(id: &str) -> String {
    format!("asemic/gen/{id}")
}

/// Value keys a component exposes.
fn value_keys(c: &Component) -> &'static [&'static str] {
    match c.kind {
        ComponentKind::Param { .. } => &["value"],
        ComponentKind::Multi { n, .. } => {
            &asemic_schema::MULTI_KEYS[..n.min(asemic_schema::MULTI_MAX)]
        }
        ComponentKind::Xy { .. } => &["x", "y"],
        ComponentKind::Proc { .. } => &[],
    }
}

fn range_for<'a>(c: &'a Component, key: &str) -> Option<(&'a Range, Option<&'a Anim>)> {
    match &c.kind {
        ComponentKind::Param { range, anim } => Some((range, anim.as_ref())),
        ComponentKind::Multi { range, .. } => Some((range, None)),
        ComponentKind::Xy { x, anim, .. } if key == "x" => Some((x, anim.as_ref())),
        ComponentKind::Xy { y, anim, .. } if key == "y" => Some((y, anim.as_ref())),
        _ => None,
    }
}

fn default_value(r: &Range) -> f64 {
    r.default.unwrap_or((r.min + r.max) / 2.0)
}

/// Toroidal wrap into [min, max).
pub fn wrap(v: f64, min: f64, max: f64) -> f64 {
    min + (v - min).rem_euclid(max - min)
}

impl Engine {
    pub fn last(&self) -> &BTreeMap<String, Value> {
        &self.last
    }

    /// Remember a value published outside the frame loop (route outputs).
    pub fn remember(&mut self, key: &str, v: Value) {
        self.last.insert(key.to_string(), v);
    }

    /// `asemic/py/<id>/out`: the frontend's reply to a `py` proc call (cached until the next).
    pub fn py_reply(&mut self, id: &str, b: &[u8]) {
        if let Some(slot) = self.procs.get_mut(id) {
            slot.source.reply(b);
            self.fresh.insert(id.to_string());
        }
    }

    fn record(&mut self, out: &[Out]) {
        for o in out {
            match o {
                Out::Put(k, v) => {
                    self.last.insert(k.clone(), v.clone());
                }
                Out::Delete(k) => {
                    self.last.remove(k);
                }
                Out::Bytes(..) | Out::Call(..) => {}
            }
        }
    }

    /// Upsert. Returns deletes for value keys that vanished (type change).
    pub fn put_component(&mut self, c: Component) -> Vec<Out> {
        let out = self.put_component_inner(c);
        self.record(&out);
        out
    }

    fn put_component_inner(&mut self, c: Component) -> Vec<Out> {
        let mut out = Vec::new();
        let id = c.id.clone();
        if let Some(old) = self.components.get(&id) {
            for k in value_keys(old) {
                if !value_keys(&c).contains(k) {
                    out.push(Out::Delete(keys::value(&id, k)));
                }
            }
        }
        match &c.kind {
            ComponentKind::Proc {
                processor,
                params,
                seed,
                input,
                text,
                axiom,
                rules,
                path,
                attrs,
            } => {
                let mut p = crate::proc::defaults(*processor);
                p.extend(params.clone());
                out.push(Out::Put(keys::props(&id), json!(p)));
                for ((comp, key), v) in &self.base {
                    if comp == &id {
                        p.insert(key.clone(), *v);
                    }
                }
                let input = input.as_ref().map(|k| match k.split_once('#') {
                    Some((k, f)) => (k.to_string(), Some(f.to_string())),
                    None => (k.clone(), None),
                });
                let keep = matches!(self.components.get(&id).map(|o| &o.kind),
                    Some(ComponentKind::Proc { processor: g, seed: s, text: t, axiom: a, rules: r, path: f, .. }) if g == processor && s == seed && t == text && a == axiom && r == rules && f == path);
                match self.procs.get_mut(&id) {
                    Some(slot) if keep => {
                        slot.source.rerun(); // (re)registered fn: call it again
                        slot.params = p;
                        slot.input = input;
                        slot.attrs = attrs.clone();
                    }
                    _ => {
                        let spec = crate::proc::Spec {
                            seed: *seed,
                            text: text.as_deref(),
                            axiom: axiom.as_deref(),
                            rules,
                            path: path.as_deref(),
                        };
                        match crate::proc::make(*processor, spec) {
                            Ok(source) => {
                                self.procs.insert(
                                    id.clone(),
                                    ProcSlot {
                                        source,
                                        params: p,
                                        last: Channels::new(),
                                        input,
                                        frame: 0,
                                        pts: None,
                                        attrs: attrs.clone(),
                                        dims: vec![],
                                    },
                                );
                            }
                            Err(e) => {
                                tracing::warn!("proc {id}: {e:#}");
                                self.procs.remove(&id);
                            }
                        }
                    }
                }
            }
            _ => {
                self.procs.remove(&id);
                for k in value_keys(&c) {
                    self.drift.remove(&(id.clone(), k.to_string()));
                    self.dirty.insert((id.clone(), k.to_string()));
                }
            }
        }
        self.components.insert(id, c);
        out
    }

    pub fn delete_component(&mut self, id: &str) -> Vec<Out> {
        let out = self.delete_component_inner(id);
        self.record(&out);
        out
    }

    fn delete_component_inner(&mut self, id: &str) -> Vec<Out> {
        let Some(c) = self.components.remove(id) else {
            return vec![];
        };
        let chans: Vec<&str> = self.procs.remove(id).map(|s| s.last.keys().copied().collect()).unwrap_or_default();
        self.base.retain(|(comp, _), _| comp != id);
        self.drift.retain(|(comp, _), _| comp != id);
        let mut out: Vec<Out> = value_keys(&c)
            .iter()
            .map(|k| Out::Delete(keys::value(id, k)))
            .collect();
        if matches!(c.kind, ComponentKind::Proc { .. }) {
            out.extend(chans.iter().map(|k| Out::Delete(keys::value(id, k))));
            out.push(Out::Delete(keys::props(id)));
            out.push(Out::Delete(gen_key(id)));
            out.push(Out::Delete(keys::attrs(id)));
        }
        out
    }

    /// Manual edit. For noise components, updates gen params. Resets drift to the new base.
    pub fn put_param(&mut self, comp: &str, key: &str, v: f64) {
        if !v.is_finite() {
            return;
        }
        let k = (comp.to_string(), key.to_string());
        self.base.insert(k.clone(), v);
        if let Some(slot) = self.procs.get_mut(comp) {
            slot.params.insert(key.to_string(), v);
        }
        self.drift.remove(&k);
        self.dirty.insert(k);
    }

    pub fn delete_param(&mut self, comp: &str, key: &str) {
        let k = (comp.to_string(), key.to_string());
        self.base.remove(&k);
        self.drift.remove(&k);
        self.dirty.insert(k);
    }

    fn base_of(&self, comp: &str, key: &str, r: &Range) -> f64 {
        self.base
            .get(&(comp.to_string(), key.to_string()))
            .copied()
            .unwrap_or_else(|| default_value(r))
    }

    fn channel(&self, anim: &Anim, key: &str) -> Option<f64> {
        let slot = self.procs.get(&anim.source)?;
        let default = match (anim.mode, key) {
            (AnimMode::Drift, "x") => "vx",
            (AnimMode::Drift, "y") => "vy",
            (AnimMode::Drift, _) => "vx",
            (_, "y") => "y",
            (_, "x") => "x",
            _ => "value",
        };
        let ch = match (&anim.channel, key) {
            // explicit channel on an xy names the x channel; y takes its partner
            (Some(c), "y") if c == "x" || c == "vx" => {
                if c == "x" {
                    "y"
                } else {
                    "vy"
                }
            }
            (Some(c), _) => c.as_str(),
            (None, _) => default,
        };
        slot.last.get(ch).copied()
    }

    /// Raw f32 LE samples on `asemic/io/<adapter>/<name>` → processors reading that key.
    pub fn feed_io(&mut self, key: &str, bytes: &[u8]) {
        let samples: Vec<f32> = bytes
            .as_chunks::<4>().0.iter()
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        for slot in self.procs.values_mut() {
            if slot.input.as_ref().is_some_and(|(k, _)| k == key) {
                slot.source.feed(&samples);
            }
        }
    }

    /// Advance one frame.
    pub fn set_timestretch(&mut self, label: &str, ts: f64) {
        let prev = self.timestretch.insert(label.into(), ts).unwrap_or(0.0);
        self.blocks.entry(label.into()).or_default(); // ensure a playhead exists for this block
        if prev == 0.0 && ts != 0.0 {
            // Unfreezing block: trigger immediate rerun of child procs so generator output is fresh
            for (id, slot) in self.procs.iter_mut() {
                if Self::under(label)(id) {
                    slot.source.rerun();
                }
            }
        }
    }

    /// Play `label` for exactly one frame (COOK).
    pub fn step_block(&mut self, label: &str) {
        self.steps.insert(label.into());
        self.blocks.entry(label.into()).or_default();
    }

    pub fn clear_timestretch(&mut self, label: &str) {
        self.timestretch.remove(label);
    }

    /// `length` in seconds; <= 0 / non-finite = infinite playback.
    pub fn set_block_length(&mut self, label: &str, len: f64) {
        let c = self.blocks.entry(label.into()).or_default();
        c.length = (len.is_finite() && len > 0.0).then_some(len);
    }

    pub fn clear_block_length(&mut self, label: &str) {
        if let Some(c) = self.blocks.get_mut(label) {
            c.length = None;
        }
    }

    /// Loop envelope from explicit curve data (dims `phase`/`time`); wraps unless `wrap` = false.
    pub fn set_block_loop(&mut self, label: &str, envelope: asemic_schema::Multi, wrap: bool) {
        let c = self.blocks.entry(label.into()).or_default();
        c.envelope = envelope;
        c.wrap = wrap;
    }

    /// Loop from a preset name (`off`/`hold`, `loop`, `pingpong`/`bounce`; default `loop`).
    pub fn set_block_loop_preset(&mut self, label: &str, name: &str) {
        let (env, wrap) = BlockClock::preset(name);
        self.set_block_loop(label, env, wrap);
    }

    pub fn clear_block_loop(&mut self, label: &str) {
        if let Some(c) = self.blocks.get_mut(label) {
            c.envelope = asemic_schema::Multi::default();
        }
    }

    /// Seek: move a block's playhead to `t` seconds (scrub).
    pub fn seek_block(&mut self, label: &str, t: f64) {
        if t.is_finite() {
            self.blocks.entry(label.into()).or_default().raw = t;
        }
    }

    /// Live playhead seconds for a block (None = no clock).
    #[cfg(test)]
    pub fn block_time_of(&self, label: &str) -> Option<f64> {
        self.blocks.get(label).map(BlockClock::eval)
    }

    /// Advance every block's playhead by `dt * timestretch` and emit its live `time` plus the
    /// resolved loop curve (so procs / plots read the same data the engine evaluates).
    pub fn step_time(&mut self, dt: f64) -> Vec<Out> {
        let mut out = Vec::new();
        // resolve timestretches first (borrowck: `effective_timestretch` borrows `self`)
        let clocks: Vec<(String, f64)> = self
            .blocks
            .keys()
            .map(|l| (l.clone(), self.effective_timestretch(l)))
            .collect();
        for (label, ts) in clocks {
            let c = self.blocks.get_mut(&label).expect("keyed above");
            if ts != 0.0 {
                c.raw += dt * ts;
            }
            // publish only on change: a frozen clock (timestretch 0) would otherwise stream a
            // constant 60 Hz `asemic/block/<label>.time` forever -- every stale label ever seen.
            let t = c.eval();
            if c.out != Some(t) {
                c.out = Some(t);
                out.push(Out::Put(keys::block_time(&label), json!(t)));
            }
        }
        out
    }

    /// Effective timestretch for `id` (hierarchical lookup: longest matching block prefix).
    fn effective_timestretch(&self, id: &str) -> f64 {
        ids::ancestors(id)
            .find_map(|l| self.timestretch.get(l).copied())
            .or_else(|| self.timestretch.get("main").copied())
            .unwrap_or(0.0)
    }

    /// Slots of block `label` (itself or nested; `main` = all).
    fn under<'a>(label: &'a str) -> impl Fn(&String) -> bool + 'a {
        move |id: &String| asemic_schema::ids::under(label, id)
    }

    pub fn step(&mut self, dt: f64) -> Vec<Out> {
        // COOK reruns every fn in the block once; its call goes out when the previous one replied
        let ready = std::mem::take(&mut self.steps);
        if !ready.is_empty() {
            let ids: Vec<&String> = self.procs.keys().filter(|id| ready.iter().any(|l| Self::under(l)(id))).collect();
            tracing::info!("cook frame {ready:?}: fns {ids:?}");
        }
        for (id, slot) in self.procs.iter_mut() {
            if ready.iter().any(|l| Self::under(l)(id)) {
                slot.source.rerun();
            }
        }
        // cook cascades down: the block and every block nested under it (their own
        // timestretch would otherwise win in `effective_timestretch`) play this one frame
        let mut labels: BTreeSet<String> = self
            .timestretch
            .keys()
            .filter(|k| ready.iter().any(|l| Self::under(l)(k)))
            .cloned()
            .collect();
        labels.extend(ready);
        let stepped: Vec<(String, Option<f64>)> = labels
            .into_iter()
            .map(|l| {
                let prev = self.timestretch.insert(l.clone(), 1.0);
                (l, prev)
            })
            .collect();
        let mut out = self.step_inner(dt);
        out.extend(self.step_time(dt));
        for (l, prev) in stepped {
            match prev {
                Some(ts) => self.timestretch.insert(l, ts),
                None => self.timestretch.remove(&l),
            };
        }
        self.record(&out);
        out
    }

    fn step_inner(&mut self, dt: f64) -> Vec<Out> {
        let mut out = Vec::new();
        let gens: BTreeMap<String, asemic_schema::Multi> = self
            .procs
            .iter()
            .filter_map(|(id, s)| Some((gen_key(id), s.pts.clone()?)))
            .collect();
        // resolve all timestretches before the mutable loop (borrowck conflict with effective_timestretch)
        let ts_map: BTreeMap<String, f64> = self
            .procs
            .keys()
            .map(|id| (id.clone(), self.effective_timestretch(id)))
            .collect();
        for (id, slot) in self.procs.iter_mut() {
            let ts = ts_map.get(id).copied().unwrap_or(0.0);
            if ts == 0.0 {
                // frozen: last value/points stay published; a reply landing now still goes out
                if self.fresh.remove(id)
                    && let Some(m) = slot.source.points()
                {
                    slot.frame = slot.frame.wrapping_add(1);
                    out.push(Out::Bytes(gen_key(id), m.encode(slot.frame)));
                }
                continue;
            }
            self.fresh.remove(id);
            if let Some(m) = slot.input.as_ref().and_then(|(k, _)| gens.get(k)) {
                slot.source.feed_points(m);
            }
            // per-frame sampling of a value/noise key (io streams arrive via feed_io)
            if let Some((k, f)) = &slot.input
                && !k.starts_with("asemic/io/")
                && !k.starts_with("asemic/gen/")
                && let Some(v) = self.last.get(k).and_then(|v| match f {
                    Some(f) => v.get(f)?.as_f64(),
                    None => v.as_f64(),
                })
            {
                slot.source.feed(&[v as f32]);
            }
            slot.last = slot.source.step(dt * ts, &slot.params);
            if let Some(call) = slot.source.request() {
                out.push(Out::Call(id.clone(), call.to_string().into_bytes()));
            }
            slot.pts = slot.source.points();
            if let Some(m) = &mut slot.pts {
                // declared dims: appended when absent, offset by param `attr.<name>`
                for (k, v) in &slot.attrs {
                    m.with_attr(k, *v as f32);
                    if let Some(o) = slot.params.get(&format!("attr.{k}")) {
                        m.offset(k, *o as f32);
                    }
                }
                if m.attrs != slot.dims {
                    slot.dims = m.attrs.clone();
                    out.push(Out::Put(
                        keys::attrs(id),
                        json!(asemic_schema::ProcAttrs {
                            dims: slot.dims.clone(),
                            declared: slot.attrs.clone()
                        }),
                    ));
                }
            }
            if let Some(m) = &slot.pts {
                // scalar channels derived from the arrays; the generator's own win
                for (k, v) in m.channels() {
                    slot.last.entry(intern(&k)).or_insert(v);
                }
                slot.frame = slot.frame.wrapping_add(1);
                out.push(Out::Bytes(gen_key(id), m.encode(slot.frame)));
            }
            // one key per channel, same space as component values
            out.extend(slot.last.iter().map(|(k, v)| Out::Put(keys::value(id, k), json!(v))));
        }
        let mut values = Vec::new();
        for c in self.components.values() {
            for key in value_keys(c) {
                let Some((range, anim)) = range_for(c, key) else {
                    continue;
                };
                let k = (c.id.clone(), key.to_string());
                let base = self.base_of(&c.id, key, range);
                let animated = anim
                    .filter(|_| self.effective_timestretch(&c.id) != 0.0)
                    .and_then(|a| self.channel(a, key).map(|ch| (a, ch)));
                let v = match animated {
                    None => {
                        if !self.dirty.contains(&k) {
                            continue;
                        }
                        base
                    }
                    Some((a, ch)) => {
                        // live override: `asemic/state/param/<id>.depth` beats the declared
                        // anim.depth, same route as any other param (§8.1.3.2).
                        let depth = self
                            .base
                            .get(&(c.id.clone(), "depth".to_string()))
                            .copied()
                            .unwrap_or(a.depth);
                        let span = range.max - range.min;
                        match a.mode {
                            AnimMode::Add => {
                                (base + ch * depth * span / 2.0).clamp(range.min, range.max)
                            }
                            AnimMode::Replace => {
                                let mapped = range.min + (ch.clamp(-1.0, 1.0) + 1.0) / 2.0 * span;
                                base + (mapped - base) * depth.clamp(0.0, 1.0)
                            }
                            AnimMode::Drift => {
                                let pos = self.drift.get(&k).copied().unwrap_or(base);
                                wrap(pos + ch * depth * dt * span / 2.0, range.min, range.max)
                            }
                        }
                    }
                };
                values.push((
                    k,
                    v,
                    matches!(animated, Some((a, _)) if a.mode == AnimMode::Drift),
                ));
            }
        }
        for (k, v, drift) in values {
            if drift {
                self.drift.insert(k.clone(), v);
            }
            out.push(Out::Put(keys::value(&k.0, &k.1), json!(v)));
        }
        self.dirty.clear();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn comp(src: &str) -> Component {
        Component::from_json(src.as_bytes()).unwrap()
    }

    fn puts(out: &[Out]) -> BTreeMap<String, Value> {
        out.iter()
            .filter_map(|o| match o {
                Out::Put(k, v) => Some((k.clone(), v.clone())),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn timestretch_freezes_noise_and_anim() {
        let mut e = Engine::default();
        e.set_timestretch("main", 1.0);
        e.put_component(comp(
            r#"{"id":"zp/lfo","type":"proc","proc":"lfo","params":{"freq":2}}"#,
        ));
        e.put_component(comp(r#"{"id":"zp/g","type":"param","min":0,"max":1,"anim":{"source":"zp/lfo","mode":"replace","depth":1}}"#));
        let g = |e: &mut Engine| puts(&e.step(0.05)).get("asemic/value/zp/g.value").cloned();
        assert_ne!(g(&mut e), g(&mut e), "animates while running");
        e.set_timestretch("zp", 0.0);
        g(&mut e);
        assert_eq!(g(&mut e), None, "frozen: no new anim values");
        e.set_timestretch("zp", 1.0);
        assert!(g(&mut e).is_some(), "resumes");
    }

    #[test]
    fn step_block_plays_exactly_one_frame() {
        let mut e = Engine::default();
        e.put_component(comp(
            r#"{"id":"zp/lfo","type":"proc","proc":"lfo","params":{"freq":2}}"#,
        ));
        e.put_component(comp(r#"{"id":"zp/g","type":"param","min":0,"max":1,"anim":{"source":"zp/lfo","mode":"replace","depth":1}}"#));
        let g = |e: &mut Engine| puts(&e.step(0.05)).get("asemic/value/zp/g.value").cloned();
        g(&mut e);
        assert_eq!(g(&mut e), None, "frozen by default");
        e.step_block("zp");
        assert!(g(&mut e).is_some(), "one frame plays");
        assert_eq!(g(&mut e), None, "then frozen again");
        assert_eq!(e.effective_timestretch("zp/g"), 0.0, "timestretch restored");
        assert!((e.block_time_of("zp").unwrap() - 0.05).abs() < 1e-9, "playhead moved one dt");
    }

    #[test]
    fn static_param_publishes_once_then_on_edit() {
        let mut e = Engine::default();
        e.put_component(comp(
            r#"{"id":"gain","type":"param","min":0,"max":2,"default":1}"#,
        ));
        assert_eq!(puts(&e.step(0.016))["asemic/value/gain.value"], json!(1.0));
        assert!(puts(&e.step(0.016)).is_empty());
        e.put_param("gain", "value", 1.5);
        assert_eq!(puts(&e.step(0.016))["asemic/value/gain.value"], json!(1.5));
    }

    #[test]
    fn xy_drifts_with_chaos_and_wraps() {
        let mut e = Engine::default();
        e.set_timestretch("main", 1.0); // blocks start frozen (§2.4.4); this test needs motion
        e.put_component(comp(r#"{"id":"chaos","type":"proc","proc":"chaos"}"#));
        e.put_component(comp(
            r#"{"id":"arena","type":"xy","anim":{"source":"chaos","mode":"drift"}}"#,
        ));
        let mut last = (0.0, 0.0);
        for _ in 0..2000 {
            let p = puts(&e.step(1.0 / 60.0));
            let x = p["asemic/value/arena.x"].as_f64().unwrap();
            let y = p["asemic/value/arena.y"].as_f64().unwrap();
            assert!((-1.0..1.0).contains(&x) && (-1.0..1.0).contains(&y));
            last = (x, y);
        }
        assert_ne!(last, (0.0, 0.0));
        // manual edit resets drift origin
        e.put_param("arena", "x", 0.5);
        let x = puts(&e.step(0.0))["asemic/value/arena.x"].as_f64().unwrap();
        assert!((x - 0.5).abs() < 1e-9);
    }

    #[test]
    fn add_mode_stays_in_range() {
        let mut e = Engine::default();
        e.set_timestretch("main", 1.0); // blocks start frozen (§2.4.4); this test needs motion
        e.put_component(comp(
            r#"{"id":"l","type":"proc","proc":"lfo","params":{"freq":2}}"#,
        ));
        e.put_component(comp(r#"{"id":"p","type":"param","min":0,"max":10,"default":9,"anim":{"source":"l","depth":1}}"#));
        for _ in 0..300 {
            let v = puts(&e.step(0.01))["asemic/value/p.value"]
                .as_f64()
                .unwrap();
            assert!((0.0..=10.0).contains(&v));
        }
    }

    #[test]
    fn anim_depth_live_changeable_via_param_path() {
        // declared depth=0 -> flat; routing a live `depth` param (asemic/state/param/p.depth)
        // through put_param should scale the anim in, same path as any other param (§8.1.3.2).
        let mut e = Engine::default();
        e.set_timestretch("main", 1.0); // blocks start frozen (§2.4.4); this test needs motion
        e.put_component(comp(
            r#"{"id":"l","type":"proc","proc":"lfo","params":{"freq":2}}"#,
        ));
        e.put_component(comp(r#"{"id":"p","type":"param","min":0,"max":10,"default":5,"anim":{"source":"l","depth":0}}"#));
        let flat = puts(&e.step(0.01))["asemic/value/p.value"]
            .as_f64()
            .unwrap();
        for _ in 0..50 {
            e.step(0.01);
        }
        let still_flat = puts(&e.step(0.01))["asemic/value/p.value"]
            .as_f64()
            .unwrap();
        assert_eq!(flat, still_flat, "depth=0 declared -> no motion");
        e.put_param("p", "depth", 1.0);
        let mut moved = false;
        for _ in 0..50 {
            let v = puts(&e.step(0.01))["asemic/value/p.value"]
                .as_f64()
                .unwrap();
            if (v - 5.0).abs() > 1e-6 {
                moved = true;
            }
        }
        assert!(
            moved,
            "live depth override should move p away from its default"
        );
    }

    #[test]
    fn noise_params_follow_param_edits() {
        let mut e = Engine::default();
        e.set_timestretch("main", 1.0); // frozen noise skips publishing; this test needs a frame
        e.put_component(comp(r#"{"id":"c","type":"proc","proc":"chaos"}"#));
        e.put_param("c", "speed", 3.0);
        let p = puts(&e.step(0.01));
        assert_eq!(p["asemic/value/c.speed"], json!(3.0));
    }

    #[test]
    fn glyph_sprouts_lsys_and_channels_derive_from_arrays() {
        let mut e = Engine::default();
        e.set_timestretch("main", 1.0); // frozen procs skip publishing; this test needs frames
        e.put_component(comp(
            r#"{"id":"g","type":"proc","proc":"glyph","text":"I"}"#,
        ));
        e.put_component(comp(r#"{"id":"p","type":"proc","proc":"lsys","axiom":"F","rules":["F -> F[+F]F"],"input":"asemic/gen/g","params":{"stride":4,"n":2}}"#));
        e.step(0.01);
        let out = e.step(0.01); // lsys reads g's previous frame
        let bytes = out
            .iter()
            .find_map(|o| match o {
                Out::Bytes(k, b) if k == "asemic/gen/p" => Some(b),
                _ => None,
            })
            .unwrap();
        let (_, m) = asemic_schema::Multi::decode(bytes).unwrap();
        assert_eq!(m.attrs, ["x", "y", "width", "depth", "root"]);
        assert!(!m.is_empty());
        let p = puts(&out);
        assert!(
            p.contains_key("asemic/value/p.depth") && p.contains_key("asemic/value/g.count")
        );
    }

    #[test]
    fn delete_component_emits_deletes() {
        let mut e = Engine::default();
        e.put_component(comp(r#"{"id":"a","type":"xy"}"#));
        let d: Vec<String> = e
            .delete_component("a")
            .into_iter()
            .filter_map(|o| {
                if let Out::Delete(k) = o {
                    Some(k)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(d, ["asemic/value/a.x", "asemic/value/a.y"]);
        assert!(e.step(0.01).is_empty());
    }

    #[test]
    fn last_tracks_puts_and_deletes() {
        let mut e = Engine::default();
        e.put_component(comp(
            r#"{"id":"g","type":"param","min":0,"max":1,"default":0.25}"#,
        ));
        e.step(0.01);
        assert_eq!(e.last()["asemic/value/g.value"], json!(0.25));
        e.delete_component("g");
        assert!(e.last().is_empty());
    }

    #[test]
    fn wrap_is_toroidal() {
        assert!((wrap(1.2, -1.0, 1.0) - -0.8).abs() < 1e-9);
        assert!((wrap(-1.2, -1.0, 1.0) - 0.8).abs() < 1e-9);
    }

    /// Block playback (J 2026-10-13): playhead advances by `dt * timestretch`, bounded by
    /// `length` (None = infinite) and shaped by the `loop` envelope; published at
    /// `asemic/block/<label>.time`.
    #[test]
    fn block_playhead_advances_loops_and_seeks() {
        let mut e = Engine::default();
        // frozen (ts 0): playhead holds
        e.set_timestretch("a", 0.0);
        e.step_time(1.0);
        assert_eq!(e.block_time_of("a"), Some(0.0));
        // real-time, no length: raw accumulates forever
        e.set_timestretch("a", 1.0);
        e.step_time(0.5);
        e.step_time(0.5);
        assert_eq!(e.block_time_of("a"), Some(1.0));
        // length 2s, loop: wraps mod the length
        e.set_block_length("a", 2.0);
        e.set_block_loop_preset("a", "loop");
        assert_eq!(e.block_time_of("a"), Some(1.0));
        e.step_time(1.5); // raw 2.5 -> phase .25 -> .5s
        assert_eq!(e.block_time_of("a"), Some(0.5));
        // pingpong: triangle envelope mirrors the second half
        e.set_block_loop_preset("a", "pingpong");
        e.seek_block("a", 1.0); // phase .5 -> peak
        assert_eq!(e.block_time_of("a"), Some(2.0));
        // off: clamp at the end (play once, then hold)
        e.set_block_loop_preset("a", "off");
        e.seek_block("a", 5.0);
        assert_eq!(e.block_time_of("a"), Some(2.0));
        // the live playhead rides `asemic/block/<label>.time`
        e.set_timestretch("a", 1.0);
        e.seek_block("a", 0.0);
        let out = e.step_time(0.25);
        assert_eq!(puts(&out)["asemic/block/a.time"], json!(0.25));
    }
}
