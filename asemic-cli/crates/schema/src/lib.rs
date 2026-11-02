//! Shared schema for asemic-cli: adapter manifests (`adapters/<n>/adapter.toml`)
//! and live components (`asemic/state/component/<id>`). JSON Schema exported via schemars
//! so Python extensions validate against the same types.

use std::collections::BTreeMap;

use anyhow::{Result, bail};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub mod ids;
pub mod multi;
pub mod wire;
pub use multi::Multi;

/// Frontend preview renderer (`textual_image` widget classes).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImageKind {
    Halfcell,
    /// kitty TGP on Ghostty/kitty, sixel elsewhere, else quarter-blocks (textual_image detection)
    #[default]
    Auto,
    Tgp,
    Sixel,
    Unicode,
    /// 2x2 quarter-blocks via libchafa (`asemic_py/quad.py`)
    Quad,
}

/// UI/perf settings (`ui(...)` verb -> `keys::UI_STATE`); frontends render from this.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct UiSettings {
    /// frame preview renderer
    pub image: ImageKind,
    /// max UI redraws/s
    pub hz: f64,
    /// redraw on every `asemic/clock` tick (false = tempo ticks don't wake the UI)
    pub clock: bool,
}

/// Texture node kind (`tex(..., kind=...)`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum TexKind {
    In,
    Draw,
    Shader,
    Compute,
    Feedback,
    Ascii,
}

/// Output node kind (`output(..., kind=...)`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum OutputKind {
    Syphon,
    Jack,
}

/// Brush look for draw nodes (`tex(..., brush=...)` or `output(..., brush=...)`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum BrushKind {
    Line,
    Curve,
    Dot,
    Mesh,
}

/// Post-processing look for outputs (`output(..., post=...)`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum PostKind {
    None,
    Feedback,
}

/// Block looping behavior (`block(..., loop=...)`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum LoopMode {
    Loop,
    Off,
    Pingpong,
}

/// Preview renderer kind (`embed(..., preview=...)` or `affinity(..., preview=...)`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum PreviewKind {
    Dots,
    Image,
    Ascii,
}

/// Score event drawing layers (for renderer rows e.g. `affinity`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ScoreLayer {
    /// Notehead + ledger lines
    Heads,
    /// Stem (< 4 beats; up on top half of staff)
    Stems,
    /// Headless duration bar, thickness = dynamics
    Lines,
    /// Motion-spelled accidental glyph (down = flat)
    Accidentals,
    /// Pitch label beside notehead
    Names,
}

/// Score note naming formats (`names` parameter for renderer rows e.g. `affinity`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum ScoreNames {
    /// 12-tone row pitch class numbers: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, t, e
    #[default]
    Pitchclass,
    /// Raw integer MIDI note number (e.g. 60)
    Midi,
    /// Pitch frequency in Hertz rounded (e.g. 440Hz)
    Hz,
    /// Note name with octave number (e.g. A5, C4)
    Notename,
    /// Note name without octave number (e.g. A, C# / Db)
    Note,
}

/// Score layout knobs (`settings` dict for renderer rows e.g. `affinity`).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(default)]
pub struct ScoreSettings {
    /// Kerning-style spacing multiplier over default quarter-note width (1 = default, 2 = double spacing, 0.5 = half spacing)
    pub spacing: f32,
    /// Physical width of a quarter note in inches (default 0.25 = 1/4 inch so notes never overlap)
    pub quarter_in: f64,
}

impl Default for ScoreSettings {
    fn default() -> Self {
        Self {
            spacing: 1.0,
            quarter_in: 0.25,
        }
    }
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            image: ImageKind::Auto,
            hz: 20.0,
            clock: true,
        }
    }
}

/// Viewer's preview box in terminal cells (`keys::preview_size(id)`); ascii nodes
/// render their text preview at exactly this grid.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct PreviewSize {
    pub cols: u32,
    pub rows: u32,
}

/// Zenoh key space (plan §3).
pub mod keys {
    pub const CLOCK: &str = "asemic/clock";
    pub const CLOCK_STATE: &str = "asemic/state/clock";
    pub const UI_STATE: &str = "asemic/state/ui";
    /// \+ `<id>`: preview raster of an output / tex node / adapter row (`ASF1`, or `AST1` text;
    /// dispatch on wire magic). Demand-gated: produced only while subscribed.
    pub const PREVIEW_PREFIX: &str = "asemic/preview/";
    /// Field of [`preview_size`] keys (`asemic/preview/<id>.size`); preview subscribers skip it.
    pub const PREVIEW_SIZE_SUFFIX: &str = ".size";
    /// Preview renderer a stream's producer declares (stored state, so late viewers get it):
    /// `asemic/state/preview/<id>.kind` = `"dots" | "image" | "ascii"`; a row's `preview=` kw
    /// writes the same key (override). Absent -> viewer default (points = dots, raster = image).
    pub const PREVIEW_KIND_PREFIX: &str = "asemic/state/preview/";
    pub const PREVIEW_KIND_SUFFIX: &str = ".kind";
    pub const PREVIEW_KIND: &str = "asemic/state/preview/**/$*.kind";
    pub const STATE: &str = "asemic/state";
    pub const COMPONENTS: &str = "asemic/state/component/**";
    pub const PARAMS: &str = "asemic/state/param/**";
    pub const ROUTES: &str = "asemic/state/route/**";
    pub const COMPONENT_PREFIX: &str = "asemic/state/component/";
    pub const PARAM_PREFIX: &str = "asemic/state/param/";
    pub const ROUTE_PREFIX: &str = "asemic/state/route/";
    pub const TEX_PREFIX: &str = "asemic/state/tex/";
    /// \+ `<scope>` (a component/tex id or a block label; "main" = everything): `true` = paused
    /// (freeze time: noise/procs stop stepping, anim holds, tex nodes hold their last frame).
    /// A scope pauses itself and every id under it (`a` covers `a/b/c`).
    pub const PAUSE_PREFIX: &str = "asemic/state/pause/";
    pub const PAUSES: &str = "asemic/state/pause/**";
    /// Per-block timestretch clock: `asemic/state/block/<label>.timestretch` = f64 (0.0 = frozen,
    /// 1.0 = real-time, >1 = faster-than-realtime, <0 = backwards). Supersedes global clock
    /// and `pause` scopes. Brain evaluates blocks independently; each block has its own
    /// `timestretch` that controls time progression for all components/routings inside it.
    pub const BLOCK_PREFIX: &str = "asemic/state/block/";
    /// `.timestretch` field shared by [`block_timestretch`] and the [`BLOCK_TIMESTRETCH`] selector.
    /// Per-block keys carry their kind as the id's field (`<label>.timestretch`), never a `/x`
    /// chunk: labels are multi-chunk paths, so a `/x` tail would be indistinguishable from a child.
    pub const TIMESTRETCH_SUFFIX: &str = ".timestretch";
    pub const BLOCK_TIMESTRETCH: &str = "asemic/state/block/**/$*.timestretch";
    /// Per-block playback, alongside `timestretch`: `.../length` = f64 seconds (absent/0 =
    /// infinite playback), `.../loop` = the loop envelope as a point multiarray (dims
    /// `phase` 0..1 -> `time` 0..1, the same curve data procs emit) and `.../time` = live
    /// playhead seconds the brain publishes (J 2026-10-13). `time` rides its own root
    /// (`BLOCK_TIME_PREFIX`, outside `asemic/state/**`) so the brain's own state subscriber
    /// can't feed a seek back to itself.
    pub const BLOCK_LENGTH_SUFFIX: &str = ".length";
    pub const BLOCK_LOOP_SUFFIX: &str = ".loop";
    pub const BLOCK_TIME_SUFFIX: &str = ".time";
    pub const BLOCK_LENGTH: &str = "asemic/state/block/**/$*.length";
    pub const BLOCK_LOOP: &str = "asemic/state/block/**/$*.loop";
    pub const BLOCK_TIME_PREFIX: &str = "asemic/block/";
    pub const BLOCK_TIME: &str = "asemic/block/**/$*.time";
    /// COOK events (!state): `asemic/block/<label>.step` (frontend -> brain) and
    /// `asemic/block/<label>.cook` (brain -> engine/adapters, after adapters drew).
    pub const BLOCK_STEP_SUFFIX: &str = ".step";
    pub const BLOCK_COOK_SUFFIX: &str = ".cook";
    pub const BLOCK_STEP: &str = "asemic/block/**/$*.step";
    pub const BLOCK_COOK: &str = "asemic/block/**/$*.cook";
    /// `py` proc replies: `asemic/py/<id>.out`.
    pub const PY_OUT_SUFFIX: &str = ".out";
    pub const PY_OUT: &str = "asemic/py/**/$*.out";
    pub const ADAPTER_VERBS: &str = "asemic/adapter/*/*";
    pub const BRAIN_STATUS: &str = "asemic/brain/status";
    /// liveliness token: declared once the verbs queryables are up (= brain ready)
    pub const BRAIN_READY: &str = "asemic/brain/ready";

    /// Every brain-state keyspace a frontend mirrors: `(name, subscribe pattern, prefix, suffix)`;
    /// id = key minus prefix/suffix ("" prefix = singleton). Codegen'd to `asemic_py/_keys.py`
    /// (`tests/gen_python_wire.rs`) so `asemic_py/state.py`'s mirror can't drift from the brain.
    pub const SPACES: &[(&str, &str, &str, &str)] = &[
        ("component", COMPONENTS, COMPONENT_PREFIX, ""),
        ("tex", "asemic/state/tex/**", TEX_PREFIX, ""),
        ("route", ROUTES, ROUTE_PREFIX, ""),
        ("pause", PAUSES, PAUSE_PREFIX, ""),
        (
            "block_timestretch",
            BLOCK_TIMESTRETCH,
            BLOCK_PREFIX,
            TIMESTRETCH_SUFFIX,
        ),
        ("block_length", BLOCK_LENGTH, BLOCK_PREFIX, BLOCK_LENGTH_SUFFIX),
        ("block_loop", BLOCK_LOOP, BLOCK_PREFIX, BLOCK_LOOP_SUFFIX),
        ("block_time", BLOCK_TIME, BLOCK_TIME_PREFIX, BLOCK_TIME_SUFFIX),
        ("param", PARAMS, PARAM_PREFIX, ""),
        ("value", "asemic/value/**", "asemic/value/", ""),
        ("attrs", "asemic/meta/**/$*.attrs", "asemic/meta/", ".attrs"),
        ("props", "asemic/meta/**/$*.props", "asemic/meta/", ".props"),
        ("clock", CLOCK, "", ""),
        ("ui", UI_STATE, "", ""),
        ("preview_kind", PREVIEW_KIND, PREVIEW_KIND_PREFIX, PREVIEW_KIND_SUFFIX),
    ];

    pub fn pause(scope: &str) -> String {
        format!("{PAUSE_PREFIX}{scope}")
    }
    /// `id` sits under paused `scope` (itself, a descendant, or everything for "main").
    pub fn paused_by(scope: &str, id: &str) -> bool {
        crate::ids::under(scope, id)
    }
    /// Subscribe selector for a keyspace shaped `prefix<id>suffix` with a single `<id>` chunk:
    /// `prefix*suffix` (zenoh `*` = exactly one chunk, `**` = any number). Build every selector
    /// from the same `(prefix, suffix)` its key is written with so the two can't drift -- the bug
    /// that left `asemic/state/block/*` (one chunk) matching nothing under the real
    /// `asemic/state/block/<label>.timestretch` key, so per-block timestretch never reached the
    /// engine/draw host and every block stayed frozen (blank GPU nodes).
    pub fn wildcard(prefix: &str, suffix: &str) -> String {
        match suffix {
            "" => format!("{prefix}**"),
            s => format!("{prefix}**/$*{s}"),
        }
    }
    /// `asemic/state/block/<label>.timestretch` = f64.
    pub fn block_timestretch(label: &str) -> String {
        format!("{BLOCK_PREFIX}{label}{TIMESTRETCH_SUFFIX}")
    }
    /// `asemic/state/block/<label>.length` = f64 seconds.
    pub fn block_length(label: &str) -> String {
        format!("{BLOCK_PREFIX}{label}{BLOCK_LENGTH_SUFFIX}")
    }
    /// `asemic/state/block/<label>.loop` = loop envelope (point multiarray).
    pub fn block_loop(label: &str) -> String {
        format!("{BLOCK_PREFIX}{label}{BLOCK_LOOP_SUFFIX}")
    }
    /// `asemic/block/<label>.time` = live playhead seconds (brain-published).
    pub fn block_time(label: &str) -> String {
        format!("{BLOCK_TIME_PREFIX}{label}{BLOCK_TIME_SUFFIX}")
    }
    pub fn block_step(label: &str) -> String {
        format!("{BLOCK_TIME_PREFIX}{label}{BLOCK_STEP_SUFFIX}")
    }
    pub fn block_cook(label: &str) -> String {
        format!("{BLOCK_TIME_PREFIX}{label}{BLOCK_COOK_SUFFIX}")
    }
    pub fn py(id: &str) -> String {
        format!("asemic/py/{id}")
    }
    pub fn py_out(id: &str) -> String {
        format!("asemic/py/{id}{PY_OUT_SUFFIX}")
    }
    /// Id of `key` in the keyspace `prefix<id>suffix` (None if `key` isn't in it).
    pub fn id_of<'a>(key: &'a str, prefix: &str, suffix: &str) -> Option<&'a str> {
        key.strip_prefix(prefix)?.strip_suffix(suffix)
    }
    /// `asemic/gen/<label>.loop` = the resolved loop envelope, published as curve data for procs.
    pub fn block_loop_gen(label: &str) -> String {
        format!("asemic/gen/{label}{BLOCK_LOOP_SUFFIX}")
    }
    /// Gen point buffers: `asemic/gen/<id>` (any depth).
    pub const GENS: &str = "asemic/gen/**";
    pub const GEN_PREFIX: &str = "asemic/gen/";
    /// Texture node uniform: `asemic/tex/<id>.param.<i|tag>` = JSON number.
    pub fn tex_param(id: &str, i: &str) -> String {
        format!("asemic/tex/{id}.param.{i}")
    }
    pub const TEX_PARAMS: &str = "asemic/tex/**/$*.param.$*";
    /// `asemic/tex/<id>.param.<i>` -> (`<id>`, `<i>`).
    pub fn tex_param_of(key: &str) -> Option<(&str, &str)> {
        let (id, f) = crate::ids::field(key.strip_prefix("asemic/tex/")?, "");
        Some((id, f.strip_prefix("param.")?))
    }
    pub fn component(id: &str) -> String {
        format!("asemic/state/component/{id}")
    }
    pub fn param(comp: &str, key: &str) -> String {
        format!("asemic/state/param/{comp}.{key}")
    }
    pub fn value(comp: &str, key: &str) -> String {
        format!("asemic/value/{comp}.{key}")
    }
    /// Preview frames of `id` (output name, tex node id or adapter row id).
    pub fn preview(id: &str) -> String {
        format!("{PREVIEW_PREFIX}{id}")
    }
    /// Viewer's box for `id`'s preview, [`crate::PreviewSize`] `{cols, rows}`.
    pub fn preview_kind(id: &str) -> String {
        format!("{PREVIEW_KIND_PREFIX}{id}{PREVIEW_KIND_SUFFIX}")
    }
    pub fn preview_size(id: &str) -> String {
        format!("{PREVIEW_PREFIX}{id}{PREVIEW_SIZE_SUFFIX}")
    }
    /// A noise/randomizer/proc's plugin-declared params (kind defaults + its own kw),
    /// `{name: value}`: what a frontend offers sliders for (routable as `<id>.<name>`).
    pub fn props(id: &str) -> String {
        format!("asemic/meta/{id}.props")
    }
    /// A proc's live point dims + declared `attrs` defaults (`ProcAttrs`).
    pub fn attrs(id: &str) -> String {
        format!("asemic/meta/{id}.attrs")
    }
    pub fn adapter(name: &str, verb: &str) -> String {
        format!("asemic/adapter/{name}/{verb}")
    }
}

// ---------------------------------------------------------------- adapters

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct AdapterManifest {
    pub adapter: AdapterInfo,
    #[serde(default)]
    pub lifecycle: Lifecycle,
    #[serde(default)]
    pub param: Vec<ParamSpec>,
    #[serde(default)]
    pub io: Vec<IoSpec>,
    #[serde(default)]
    pub zenoh: ZenohKeys,
    /// Brain-owned OSC bridge (rosc): in -> `asemic/io/<adapter>/<path>`, `asemic/out/<adapter>/<path>` -> out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub osc: Option<OscSpec>,
    /// Brain-owned virtual MIDI port pair (midir): cc/note <-> `asemic/{io,out}/<adapter>/<prefix>{cc,note}/<ch 1-16>/<n>` (0..1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub midi: Option<MidiSpec>,
    /// Inline viewer facts (e.g. the Python orca row view): how to attach to the ONE process
    /// `[lifecycle] start` already launched (feedback-adapter-viewers — viewers attach, never
    /// spawn). Served over Zenoh with the rest of the manifest (`schema`/`adapters` verb), so a
    /// viewer reads it from the brain instead of hard-coding adapter-specific constants.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<ViewSpec>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct ViewSpec {
    /// Shell argv/command string to attach a viewer to the running process, e.g.
    /// `"tmux attach -t asemic-orca"`.
    pub attach: String,
    /// tmux session name the process runs in (viewer samples it with `capture-pane`).
    pub session: String,
    /// Seed file for the process' content, relative to the adapter's own directory.
    pub seed: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct OscSpec {
    /// UDP port the brain listens on for the adapter's OSC.
    pub listen: Option<u16>,
    /// `host:port` the brain sends OSC to.
    pub send: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct MidiSpec {
    /// Virtual port name (default `asemic-<adapter>`).
    pub port: Option<String>,
    /// Extra key segment between `<adapter>` and `{cc,note}` (e.g. `"midi/"`), for adapters that
    /// also bridge another transport (OSC) under the same name and would otherwise collide.
    pub prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct AdapterInfo {
    pub name: String,
    pub kind: AdapterKind,
    #[serde(default)]
    pub description: String,
    /// Declares liveliness token `asemic/adapter/<name>/ready` once subscribed; `start` awaits it,
    /// so a COOK that starts the adapter is rendered by it.
    #[serde(default)]
    pub ready: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AdapterKind {
    /// Long-running child process owned by the brain.
    Process,
    /// External GUI app launched/quit by commands (TouchDesigner, Max, Affinity).
    App,
    /// Python extension using `asemic_py` (runs as a process). `lifecycle.start`/`build`/`stop`
    /// are the bare script (e.g. `"adapter.py"`), never an interpreter: the brain's adapter host
    /// resolves one itself (`ASEMIC_PYTHON` env, else `<repo root>/.venv/bin/python`) and
    /// prepends it, so every python adapter shares the one repo venv without repeating its path.
    Python,
    /// No process: brain-owned transports only (`[osc]` / `[midi]`).
    Bridge,
    /// No long-lived process: `lifecycle.run` is a one-shot argv template the brain execs per
    /// request (never a long-running child). A `put` on an "in" `[[io]]` plug's
    /// `asemic/io/<adapter>/<name>` key runs it; stdout lines stream to
    /// `asemic/out/<adapter>/<name>` (the first "out" plug) as they arrive, then a final
    /// `asemic/out/<adapter>/<name>/done` carries `{code}`. A new request while one is still
    /// running cancels (kills) it first; adapter `stop` kills any in-flight run too.
    Cli,
}

/// Shell commands run with `sh -c` in the adapter directory (except `run`, see below).
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Lifecycle {
    pub build: Option<String>,
    pub start: Option<String>,
    /// Absent (the common case) = the brain signals the whole process group it started `start`
    /// in (SIGTERM then SIGKILL), taking down any children the adapter forked too. Only needed
    /// for a process the brain doesn't itself own (an already-running app, a wrapper that
    /// detaches, ...).
    pub stop: Option<String>,
    /// `kind = "cli"` only: one-shot argv template, e.g. `"uv run --directory {dir} python -m
    /// pkg.cli research {query}"`. Whitespace-split (double-quoted segments kept as one token);
    /// a token containing `{name}` has that placeholder replaced by the string value of the
    /// request payload's `name` field (or, for a scalar/non-object payload, by the payload
    /// itself when the plug has exactly one placeholder) and is then passed as a single argv
    /// element — exec'd directly (`tokio::process::Command`, never `sh -c`), so a value can
    /// never inject a second shell command.
    pub run: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct ParamSpec {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// min/max/default/step/curve — same fields as a component `Range`, flattened onto the
    /// wire (TOML/JSON keys unchanged) so the two never drift apart.
    #[serde(flatten)]
    pub range: Range,
    /// Native address inside the target (OSC path, MIDI CC, TD par name).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
}

fn one() -> f64 {
    1.0
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Curve {
    #[default]
    Linear,
    Exp,
    Log,
    Quad,
}

impl Curve {
    /// Map normalized 0..1 through the curve.
    pub fn apply(self, t: f64) -> f64 {
        let t = t.clamp(0.0, 1.0);
        match self {
            Curve::Linear => t,
            Curve::Quad => t * t,
            Curve::Exp => (t.exp() - 1.0) / (std::f64::consts::E - 1.0),
            Curve::Log => (1.0 + t * (std::f64::consts::E - 1.0)).ln(),
        }
    }
}

/// A plug: named in/out socket. Brain owns transport per type, adapters never pick it:
/// video = Syphon server `asemic:<adapter>/<name>`, audio = Loopback device,
/// points/control = Zenoh `asemic/io/<adapter>/<name>`, midi = virtual port.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct IoSpec {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: IoType,
    pub dir: IoDir,
    /// Audio channel count / video size hint; informational.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channels: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IoType {
    Points,
    Video,
    Audio,
    Midi,
    Control,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum IoDir {
    In,
    Out,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct ZenohKeys {
    #[serde(default)]
    pub subscribes: Vec<String>,
    #[serde(default)]
    pub publishes: Vec<String>,
}

impl AdapterManifest {
    pub fn from_toml(src: &str) -> Result<Self> {
        let m: Self = toml::from_str(src)?;
        m.validate()?;
        Ok(m)
    }

    /// Structural checks; transport invariants (§1.5) are enforced by the brain, !manifests.
    pub fn validate(&self) -> Result<()> {
        let name = &self.adapter.name;
        if name.is_empty() || name.contains(['/', '*', '$', '?', '#']) {
            bail!("adapter name {name:?} must be a single key chunk");
        }
        if self.adapter.kind == AdapterKind::Bridge && self.osc.is_none() && self.midi.is_none() {
            bail!("adapter {name}: kind bridge needs [osc] or [midi]");
        }
        if self.adapter.kind == AdapterKind::Cli && self.lifecycle.run.is_none() {
            bail!("adapter {name}: kind cli needs lifecycle.run");
        }
        if !matches!(
            self.adapter.kind,
            AdapterKind::App | AdapterKind::Bridge | AdapterKind::Cli
        ) && self.lifecycle.start.is_none()
        {
            bail!(
                "adapter {name}: kind {:?} needs lifecycle.start",
                self.adapter.kind
            );
        }
        let mut seen = std::collections::BTreeSet::new();
        for io in &self.io {
            if !seen.insert((&io.name, io.dir as u8)) {
                bail!(
                    "adapter {name}: duplicate plug {:?} ({:?})",
                    io.name,
                    io.dir
                );
            }
        }
        for p in &self.param {
            check_range(&p.key, p.range.min, p.range.max)?;
        }
        Ok(())
    }
}

fn check_range(key: &str, min: f64, max: f64) -> Result<()> {
    if min.partial_cmp(&max) != Some(std::cmp::Ordering::Less) {  // NaN rejected too
        bail!("param {key}: min {min} must be < max {max}");
    }
    Ok(())
}

// ---------------------------------------------------------------- components

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Component {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    pub speed: f64,
    #[serde(flatten)]
    pub kind: ComponentKind,
}

/// Upper bound on a multislider's `n` (value keys are the static `MULTI_KEYS` slice).
pub const MULTI_MAX: usize = 64;
/// `"0".."63"`: a multislider's value/param keys, `&'static` so they slot into per-kind key tables.
pub const MULTI_KEYS: [&str; MULTI_MAX] = [
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16",
    "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31", "32",
    "33", "34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48",
    "49", "50", "51", "52", "53", "54", "55", "56", "57", "58", "59", "60", "61", "62", "63",
];

fn multi_n() -> usize {
    8
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ComponentKind {
    #[schemars(title = "ParamComponent")]
    /// Single slider → `asemic/value/<id>.value`.
    Param {
        #[serde(flatten)]
        range: Range,
        #[serde(default)]
        anim: Option<Anim>,
    },
    #[schemars(title = "MultiComponent")]
    /// Multislider: `n` sliders sharing one range → `asemic/value/<id>.<i>` (i = 0..n);
    /// each index is its own param (`<id>.<i>` routable, `set('<id>', '<i>', v)`).
    Multi {
        #[serde(flatten)]
        range: Range,
        #[serde(default = "multi_n")]
        n: usize,
    },
    #[schemars(title = "XyComponent")]
    /// XY pad → `asemic/value/<id>.{x,y}`.
    Xy {
        #[serde(default = "unit")]
        x: Range,
        #[serde(default = "unit")]
        y: Range,
        #[serde(default)]
        anim: Option<Anim>,
    },
    #[schemars(title = "ProcComponent")]
    /// Intra-brain processor (physics / quantum / harmonics / noise / randomizer) → `asemic/value/<id>.<ch>` channels
    /// and `asemic/gen/<id>` points (multiarray). `input` = key it reads (`asemic/io/..` f32 stream, or a
    /// value/proc key sampled per frame; `key#field` picks a JSON field).
    Proc {
        #[serde(rename = "proc")]
        processor: ProcKind,
        #[serde(default)]
        params: BTreeMap<String, f64>,
        #[serde(default)]
        seed: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input: Option<String>,
        /// glyph: string drawn with the asemic-repl font.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        /// lsys: axiom + ABOP rules (symbios syntax; `0.5: F -> F[+F]` = stochastic).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        axiom: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        rules: Vec<String>,
        /// text: font file (.ttf/.otf, variable ok); hot-reloaded on change.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        /// Declared point dims {name: default}: appended to the output multiarray when absent;
        /// param `attr.<name>` (route dst `<id>.attr.<name>`) offsets the dim.
        #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
        attrs: BTreeMap<String, f64>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProcKind {
    /// rapier2d balls in a unit box.
    Physics,
    /// 1D stationary Schrödinger (schroidnger_equation, Numerov).
    Wave,
    /// FFT bands of `input`.
    Spectrum,
    /// `text` as asemic-repl font paths (asemic-font), scanned/wobbled by params.
    Glyph,
    /// L-system (symbios derivation + symbios-turtle-3d), optionally rooted on `input` gen points.
    Lsys,
    /// `text` shaped (harfrust) in font `path`, outlines (skrifa) at axis params, flattened (lyon).
    Text,
    /// Seeded pentatonic walk: 1 line per voice, 1 point per note, dims pitch (MIDI) + dur (beats).
    Melody,
    /// 12-tone variations (transpositions, inversions, retrogrades) of input motif points/multiarray modulated by smooth noise.
    Variations,
    /// Python fn in the REPL frontend: the brain queries `asemic/py/<id>` {params, seed, input}
    /// when those change (or on COOK); the frontend's queryable replies ASP1, cached and
    /// published every frame: no per-frame round trip.
    Py,
    // --- Unified noisegens & randomizers ---
    /// Lorenz attractor (hue-inferno `update_lorenz_ml`).
    Chaos,
    Perlin,
    Simplex,
    Lfo,
    RandomWalk,
    /// Uniform iid jitter per cook.
    White,
    /// Gaussian iid jitter per cook (Box-Muller).
    Gauss,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Range {
    pub min: f64,
    pub max: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(default)]
    pub curve: Curve,
}

fn unit() -> Range {
    Range {
        min: -1.0,
        max: 1.0,
        default: Some(0.0),
        step: None,
        curve: Curve::Linear,
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum NoiseKind {
    /// Lorenz attractor (hue-inferno `update_lorenz_ml`).
    Chaos,
    Perlin,
    Simplex,
    Lfo,
    RandomWalk,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RandomizerKind {
    /// Uniform iid jitter per cook.
    White,
    /// Gaussian iid jitter per cook (Box-Muller).
    Gauss,
}

/// Declares a component animated by a noisegen.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Anim {
    /// Noise component id.
    pub source: String,
    /// Noise channel; default `value` for param, `x`/`y` (Add/Replace) or `vx`/`vy` (Drift) for xy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(default)]
    pub mode: AnimMode,
    #[serde(default = "one")]
    pub depth: f64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AnimMode {
    /// value = base + noise * depth * span.
    #[default]
    Add,
    /// Integrate noise as velocity; wrap toroidally (hue-inferno arena).
    Drift,
    /// value = noise mapped into range.
    Replace,
}

impl Component {
    pub fn from_json(src: &[u8]) -> Result<Self> {
        let c: Self = serde_json::from_slice(src)?;
        c.validate()?;
        Ok(c)
    }

    pub fn validate(&self) -> Result<()> {
        // ids = `/`-joined block paths (ids.rs); `.`/`:` start a field, so !! in an id
        if self.id.split('/').any(|seg| seg.is_empty() || seg.contains(['.', ':', '*', '$', '?', '#'])) {
            bail!("component id {:?} must be a `/` path of non-empty segments w/o . : * $ ? #", self.id);
        }
        match &self.kind {
            ComponentKind::Param { range, .. } => check_range(&self.id, range.min, range.max),
            ComponentKind::Multi { range, n } => {
                if !(1..=MULTI_MAX).contains(n) {
                    bail!("{}: multi n={n} must be 1..={MULTI_MAX}", self.id);
                }
                check_range(&self.id, range.min, range.max)
            }
            ComponentKind::Xy { x, y, .. } => {
                check_range(&format!("{}.x", self.id), x.min, x.max)?;
                check_range(&format!("{}.y", self.id), y.min, y.max)
            }
            ComponentKind::Proc { input, attrs, .. } => {
                if let Some(k) = attrs.keys().find(|k| !Multi::valid_name(k)) {
                    bail!("{}: attr {k:?} is not an identifier", self.id);
                }
                match input {
                    Some(k) if k.contains(['*', '$', '?']) => {
                        bail!("{}: input {k:?} must be concrete", self.id)
                    }
                    _ => Ok(()),
                }
            }
        }
    }
}

// ---------------------------------------------------------------- routes

/// Mixer route: brain subscribes `src`, maps the number, puts to `dst` (plan §8.1.1).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct Route {
    pub id: String,
    /// Concrete key, e.g. `asemic/value/arena.x` or `asemic/value/chaos.vx`.
    pub src: String,
    /// Field to read when `src` carries a JSON object (noise channels).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    /// Concrete destination key, e.g. `asemic/out/hue/intensity`.
    pub dst: String,
    #[serde(default = "unit_span")]
    pub from: [f64; 2],
    #[serde(default = "unit_span")]
    pub to: [f64; 2],
    #[serde(default)]
    pub curve: Curve,
    /// How the mapped value is applied to `dst`'s current value (plugtype).
    #[serde(default)]
    pub combine: Combine,
}

fn unit_span() -> [f64; 2] {
    [0.0, 1.0]
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Combine {
    /// Overwrite dst (today's behavior).
    #[default]
    Replace,
    /// dst = current(dst) + mapped.
    Add,
    /// dst = current(dst) * mapped.
    Multiply,
}

impl Route {
    pub fn from_json(src: &[u8]) -> Result<Self> {
        let r: Self = serde_json::from_slice(src)?;
        r.validate()?;
        Ok(r)
    }

    pub fn validate(&self) -> Result<()> {
        for k in [&self.src, &self.dst] {
            if k.is_empty() || k.contains(['*', '$', '?', '#']) {
                bail!("route {}: key {k:?} must be concrete", self.id);
            }
        }
        // state/param/<comp>.<k> = a gen/proc param (leaf number, like `set`); other state = structural
        if (self.dst.starts_with("asemic/state/") && !self.dst.starts_with(keys::PARAM_PREFIX))
            || self.dst == self.src
        {
            bail!(
                "route {}: dst {:?} would feed back into state/src",
                self.id,
                self.dst
            );
        }
        if self.from[0] == self.from[1] {
            bail!("route {}: empty from-span", self.id);
        }
        Ok(())
    }

    /// from-span → normalized (clamped) → curve → to-span.
    pub fn map(&self, v: f64) -> f64 {
        let t = (v - self.from[0]) / (self.from[1] - self.from[0]);
        self.to[0] + self.curve.apply(t) * (self.to[1] - self.to[0])
    }
}

// ---------------------------------------------------------------- live streams

/// Latest channel values of a noise/proc slot (published per channel as `asemic/value/<id>.<ch>`) (`value`, `x`, `vx`, ...).
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(transparent)]
pub struct NoiseFrame(pub BTreeMap<String, f64>);

/// `asemic/meta/<id>.attrs`: a proc's live point dims + its declared `attrs` defaults.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct ProcAttrs {
    pub dims: Vec<String>,
    pub declared: BTreeMap<String, f64>,
}

/// JSON Schemas for Python extensions (`asemic-brain --schema`).
pub fn json_schemas() -> serde_json::Value {
    serde_json::json!({
        "adapter": schemars::schema_for!(AdapterManifest),
        "component": schemars::schema_for!(Component),
        "route": schemars::schema_for!(Route),
        "ui": schemars::schema_for!(UiSettings),
        "tex_kind": schemars::schema_for!(TexKind),
        "output_kind": schemars::schema_for!(OutputKind),
        "brush_kind": schemars::schema_for!(BrushKind),
        "post_kind": schemars::schema_for!(PostKind),
        "loop_mode": schemars::schema_for!(LoopMode),
        "preview_kind": schemars::schema_for!(PreviewKind),
        "score_layer": schemars::schema_for!(ScoreLayer),
        "score_names": schemars::schema_for!(ScoreNames),
        "score_settings": schemars::schema_for!(ScoreSettings),
        "noise": schemars::schema_for!(NoiseFrame),
        "attrs": schemars::schema_for!(ProcAttrs),
    })
}

/// [`json_schemas`] as ONE JSON Schema doc (shared `$defs`, root props = each schema) -- the
/// input `scripts/gen_types.sh` turns into `asemic_py/_types.py` TypedDicts.
/// `extra` = schemas of types living in downstream crates (draw's tex `NodeInfo`, brain's clock
/// `Tick`), which this crate can't name without a dependency cycle.
pub fn json_schema_bundle(extra: &[(&str, serde_json::Value)]) -> serde_json::Value {
    let mut defs = serde_json::Map::new();
    let mut props = serde_json::Map::new();
    let mut all = json_schemas().as_object().cloned().unwrap_or_default();
    all.extend(extra.iter().map(|(n, s)| (n.to_string(), s.clone())));
    for (name, mut s) in all {
        let o = s.as_object_mut().expect("schema object");
        if let Some(serde_json::Value::Object(d)) = o.remove("$defs") {
            defs.extend(d);
        }
        o.remove("$schema");
        let title = o
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or(&name)
            .to_string();
        props.insert(
            name,
            serde_json::json!({"$ref": format!("#/$defs/{title}")}),
        );
        defs.insert(title, s);
    }
    serde_json::json!({"title": "Schemas", "type": "object", "properties": props, "$defs": defs})
}

#[cfg(test)]
mod tests {
    use super::*;

    const HUE: &str = r#"
        [adapter]
        name = "hue"
        kind = "python"
        [lifecycle]
        start = "python adapter.py"
        [[param]]
        key = "intensity"
        min = 0.1
        max = 2.5
        [[io]]
        name = "lamps"
        type = "control"
        dir = "out"
    "#;

    #[test]
    fn parses_manifest() {
        let m = AdapterManifest::from_toml(HUE).unwrap();
        assert_eq!(m.adapter.kind, AdapterKind::Python);
        assert_eq!(m.param[0].range.max, 2.5);
    }

    #[test]
    fn plugs_parse_and_reject_duplicates() {
        let ok = format!("{HUE}\n[[io]]\nname = \"main\"\ntype = \"video\"\ndir = \"out\"\n");
        let m = AdapterManifest::from_toml(&ok).unwrap();
        assert_eq!(m.io[1].ty, IoType::Video);
        let dup = format!("{ok}\n[[io]]\nname = \"main\"\ntype = \"audio\"\ndir = \"out\"\n");
        assert!(AdapterManifest::from_toml(&dup).is_err());
    }

    #[test]
    fn component_roundtrip() {
        let src = br#"{"id":"arena","type":"xy","anim":{"source":"chaos","mode":"drift"}}"#;
        let c = Component::from_json(src).unwrap();
        match &c.kind {
            ComponentKind::Xy { x, anim, .. } => {
                assert_eq!(x.min, -1.0);
                assert_eq!(anim.as_ref().unwrap().mode, AnimMode::Drift);
            }
            _ => panic!("expected xy"),
        }
        let back = serde_json::to_vec(&c).unwrap();
        assert_eq!(Component::from_json(&back).unwrap(), c);
    }

    #[test]
    fn rejects_bad_ids_and_ranges() {
        assert!(Component::from_json(br#"{"id":"a/b.c","type":"param","min":0,"max":1}"#).is_err());
        assert!(Component::from_json(br#"{"id":"a","type":"param","min":1,"max":1}"#).is_err());
    }

    /// Zenoh key-expression match: `*` = exactly one chunk, `**` = any number (incl. zero).
    fn matches(pattern: &str, key: &str) -> bool {
        let (p, k) = (pattern.split('/').collect::<Vec<_>>(), key.split('/').collect::<Vec<_>>());
        fn go(p: &[&str], k: &[&str]) -> bool {
            match (p.first(), k.first()) {
                (None, None) => true,
                (Some(&"**"), _) => go(&p[1..], k) || (!k.is_empty() && go(p, &k[1..])),
                (Some(&"*"), Some(_)) => go(&p[1..], &k[1..]),
                (Some(x), Some(y)) if x == y => go(&p[1..], &k[1..]),
                // `$*` = any run within one chunk (zenoh chunk wildcard)
                (Some(x), Some(y)) if x.contains("$*") => {
                    let (pre, suf) = x.split_once("$*").unwrap();
                    y.len() >= pre.len() + suf.len() && y.starts_with(pre) && y.ends_with(suf) && go(&p[1..], &k[1..])
                }
                _ => false,
            }
        }
        go(&p, &k)
    }

    /// A representative id per keyspace (its own chunk shape; `param`/`value` carry two chunks).
    fn sample_id(name: &str) -> &'static str {
        match name {
            "param" | "value" => "demo/comp.value",
            _ => "demo/comp",
        }
    }

    /// Guard the drift that made every block freeze: a subscribe selector must actually match the
    /// key its own `(prefix, suffix)` builds -- `asemic/state/block/*` (one chunk) never matched
    /// `asemic/state/block/<label>.timestretch`, so per-block timestretch never reached the brain.
    #[test]
    fn space_selectors_match_their_own_keys() {
        for &(name, pattern, prefix, suffix) in keys::SPACES {
            // singleton spaces (no prefix) key on the pattern itself
            let key = if prefix.is_empty() {
                pattern.to_string()
            } else {
                format!("{prefix}{}{suffix}", sample_id(name))
            };
            assert!(matches(pattern, &key), "{name}: selector {pattern:?} misses its key {key:?}");
        }
        // the canonical timestretch selector and the key builder agree, both derived from the
        // shared prefix/suffix (can't drift independently).
        assert_eq!(keys::wildcard(keys::BLOCK_PREFIX, keys::TIMESTRETCH_SUFFIX), keys::BLOCK_TIMESTRETCH);
        assert!(matches(keys::BLOCK_TIMESTRETCH, &keys::block_timestretch("reaction/sim")));
        // and the historical one-chunk selector the bug used does NOT match:
        assert!(!matches("asemic/state/block/*", &keys::block_timestretch("reaction/sim")));
    }

    #[test]
    fn route_maps_and_validates() {
        let r = Route::from_json(br#"{"id":"r","src":"asemic/value/a.value","dst":"asemic/out/hue/i","from":[-1,1],"to":[0,254]}"#).unwrap();
        assert_eq!(r.map(-1.0), 0.0);
        assert_eq!(r.map(1.0), 254.0);
        assert_eq!(r.map(5.0), 254.0);
        assert!(Route::from_json(br#"{"id":"r","src":"asemic/value/*","dst":"x/y"}"#).is_err());
        assert!(
            Route::from_json(br#"{"id":"r","src":"a/b","dst":"asemic/state/component/a"}"#)
                .is_err()
        );
        assert!(
            Route::from_json(br#"{"id":"r","src":"a/b","dst":"asemic/state/param/a.b"}"#).is_ok(),
            "proc params routable"
        );
    }

    #[test]
    fn curves_hit_endpoints() {
        for c in [Curve::Linear, Curve::Exp, Curve::Log, Curve::Quad] {
            assert!(c.apply(0.0).abs() < 1e-9);
            assert!((c.apply(1.0) - 1.0).abs() < 1e-9);
        }
    }

    #[test]
    fn orca_manifest_has_view() {
        let src = include_str!("../../../adapters/orca/adapter.toml");
        let m = AdapterManifest::from_toml(src).unwrap();
        let view = m.view.expect("orca manifest declares [view]");
        assert_eq!(view.session, "asemic-orca");
        assert!(view.attach.contains("asemic-orca"));
        assert_eq!(view.seed, "asemic.orca");
    }

    #[test]
    fn schema_exports() {
        let s = json_schemas();
        assert!(s["adapter"].is_object() && s["component"].is_object());
    }
}
