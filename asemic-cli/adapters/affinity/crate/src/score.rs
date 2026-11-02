//! Multiarray -> ops document `scripts/asemic-render.js` draws (page units 0..1, y down; op
//! `page` = overflow page index, absent = 0).
//! Each line = one voice, each point = one event; dims by name: `pitch` (MIDI; absent -> y over
//! [lo, hi]), `dur` (beats; absent -> x gap × beats, last = 1).
//!
//! Grid opts = the `x`/`y` pairs + `notes` + `settings`: x = [barline, light] (quarter-note
//! intervals), y = [subdivisions/octave, accidentals/line-space] (the pitch staff), notes =
//! event layers (heads | stems | lines | accidentals), superimposed per event; settings.spacing
//! = a kerning-style spacing multiplier (1 = default layout, 2 = double spacing, 0.5 = half
//! spacing / twice as dense), settings.quarter_in = the width of a quarter note in INCHES
//! (default 0.25 ~ 1/4 inch). The system length is PHYSICAL: the page width (px) divided by the
//! quarter-note width (inches x the document's dpi) gives how many quarters fit, rounded to the
//! nearest whole bar, then justified to fill the system width — so notes never overlap.

use asemic_schema::Multi;
use serde::Deserialize;
use serde_json::{Value, json};

fn default_spacing() -> f32 { 1.0 }

/// Default width of a quarter note, in INCHES (J: a quarter note ~ 1/4 inch, so notes never
/// overlap). The page's dpi turns it into pixels.
pub const QUARTER_IN: f64 = 0.25;

/// The page the score is drawn on: its width & height in pixels + the document's dpi (px per inch) —
/// the physical base the system length and staff dimensions are derived from.
#[derive(Debug, Clone, Copy)]
pub struct Page {
    pub width_px: f64,
    pub height_px: f64,
    pub dpi: f64,
}

impl Default for Page {
    fn default() -> Self {
        Self { width_px: 1920.0, height_px: 1080.0, dpi: 96.0 }
    }
}

/// Row `settings` (layout knobs, all optional).
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// spacing multiplier over the default quarter-note width (1 = the default layout, 2 =
    /// double spacing / half the bars per system, 0.5 = half spacing / twice the bars per
    /// system). Bars per system are rounded to the nearest whole-bar amount, so every boundary
    /// lands on a barline.
    #[serde(default = "default_spacing")]
    pub spacing: f32,
    /// width of a quarter note, in INCHES (default 0.25): the system length is derived from it
    /// (page width / quarter width, rounded to whole bars), so notes never overlap. Bigger =
    /// fewer bars per system.
    #[serde(default = "default_quarter_in")]
    pub quarter_in: f64,
}

fn default_quarter_in() -> f64 { QUARTER_IN }

/// `Default` must carry the SAME values as the serde field defaults — a bare derive would
/// silently give `spacing = 0` (a 100x too dense layout) whenever `settings` is absent.
impl Default for Settings {
    fn default() -> Self {
        Self { spacing: default_spacing(), quarter_in: default_quarter_in() }
    }
}

/// Row `opts` (all optional).
#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Opts {
    /// [bar, beat] quarter-note intervals: x[0] = the barline interval (heavy rule every x[0]
    /// quarters; 0 = unmeasured: single row over the total span); x[1] = light rule every n
    /// quarters (0 = off; fractions too, e.g. 1/12 = the twelve-time grid). Systems = the
    /// number of whole bars that fit at the chosen `settings.spacing`, rounded to the nearest
    /// barline; the chosen bars are then justified to fill the system width.
    #[serde(deserialize_with = "duo")]
    pub x: [f32; 2],
    /// [subdivisions/octave, accidentals/line-space], the pitch staff: [6,3] = normal staff
    /// (5-line treble; accidental by the FOLLOWING note's motion: down = flat, up = sharp, no
    /// naturals) | [1,1] = one rule per octave C | [12,1] = chromatic (1 line/space per halfstep,
    /// 0 = middle C, no accidentals). The accidental count = the microtone ladder (quarter- and
    /// third-tones) — until glyphs exist, other pairs render nothing.
    #[serde(deserialize_with = "duo")]
    pub y: [f32; 2],
    /// event layers, superimposed: string = preset (`notes` = heads+stems+accidentals) or one
    /// layer name | tuple = the exact set: heads (notehead + ledgers) | stems | lines (headless
    /// dur bar, thickness = dynamics) | accidentals (motion-spelled glyph; the motion ALSO moves
    /// the head position — down = flat. Without this layer there is no spelling concept: heads
    /// just round to the nearest division — black-key ties fall on the lower natural) | names
    /// (pitch label beside notehead)
    #[serde(deserialize_with = "layer_set")]
    pub notes: Vec<Layer>,
    /// format for note names layer: pitchclass (0-9, t, e), midi, hz, notename (A5), note (A)
    #[serde(default)]
    pub names: NamesFormat,
    pub pitch: String,
    pub dur: String,
    /// dynamics dim (0..1, or MIDI velocity 0..127) -> bar thickness in the `lines` layer
    pub vel: String,
    pub lo: f32,
    pub hi: f32,
    /// dur-absent x gap -> beats scale
    pub beats: f32,
    /// layout knobs: {"spacing": kerning multiplier over the default quarter-note width, absent = 1}
    pub settings: Settings,
}

/// `[a, b]` opt (absent = default): x = quarter-note intervals, y = pitch staff pair.
fn duo<'de, D: serde::Deserializer<'de>>(d: D) -> Result<[f32; 2], D::Error> {
    match Value::deserialize(d)? {
        Value::Array(a) => {
            let mut v = [0.0; 2];
            for (o, e) in v.iter_mut().zip(a) {
                *o = e.as_f64().ok_or_else(|| serde::de::Error::custom(format!("number, got {e}")))? as f32;
            }
            Ok(v)
        }
        Value::Null => Ok([0.0; 2]),
        v => Err(<D::Error as serde::de::Error>::custom(format!("[a, b], got {v}"))),
    }
}

/// Event drawing layer; the `notes` opt lists these, superimposed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layer {
    /// notehead + ledger lines
    Heads,
    /// stem (< 4 beats; up on the top half of the staff)
    Stems,
    /// headless dur bar, thickness = dynamics
    Lines,
    /// motion-spelled accidental glyph (down = flat), gated by the y pair
    Accidentals,
    /// phrase slurs between consecutive non-rest notes in a phrase
    Phrases,
    /// musical ties across barlines (splits noteheads crossing barlines into two heads + tie)
    Ties,
    /// rest glyphs (whole, half, quarter, 8th, 16th, etc.)
    Rests,
    /// pitch label beside notehead
    Names,
}

/// Note naming format when `notes` includes `names`
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NamesFormat {
    /// 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, t, e
    #[default]
    Pitchclass,
    /// integer MIDI note number e.g. 60
    Midi,
    /// frequency in Hz e.g. 440
    Hz,
    /// note name with octave e.g. A5, C4
    Notename,
    /// note name without octave e.g. A, C#
    Note,
}

impl<'de> serde::Deserialize<'de> for NamesFormat {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = match Value::deserialize(d)? {
            Value::String(s) => s,
            Value::Null => return Ok(NamesFormat::default()),
            v => return Err(<D::Error as serde::de::Error>::custom(format!("string, got {v}"))),
        };
        match s.to_lowercase().as_str() {
            "pitchclass" | "pc" | "tonerow" => Ok(NamesFormat::Pitchclass),
            "midi" => Ok(NamesFormat::Midi),
            "hz" => Ok(NamesFormat::Hz),
            "notename" => Ok(NamesFormat::Notename),
            "note" => Ok(NamesFormat::Note),
            other => Err(<D::Error as serde::de::Error>::custom(format!(
                "pitchclass|midi|hz|notename|note, got {other}"
            ))),
        }
    }
}

/// `notes` opt: string = preset (`notes` = heads+stems+accidentals) or one layer name | array =
/// the exact set (`notes` may appear inside, expanding to the trio) | null/empty = no drawing.
fn layer_set<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<Layer>, D::Error> {
    let names: Vec<String> = match Value::deserialize(d)? {
        Value::Null => vec![],
        Value::String(s) => vec![s],
        Value::Array(a) => a.iter().filter_map(|v| v.as_str()).map(String::from).collect(),
        v => return Err(<D::Error as serde::de::Error>::custom(format!("string or [layers...], got {v}"))),
    };
    let mut out = Vec::with_capacity(names.len());
    for n in names {
        out.extend(match n.as_str() {
            "notes" => vec![Layer::Heads, Layer::Stems, Layer::Accidentals],
            "heads" => vec![Layer::Heads],
            "stems" => vec![Layer::Stems],
            "lines" => vec![Layer::Lines],
            "accidentals" => vec![Layer::Accidentals],
            "phrases" | "slurs" => vec![Layer::Phrases],
            "ties" => vec![Layer::Ties],
            "rests" => vec![Layer::Rests],
            "names" | "labels" => vec![Layer::Names],
            s => return Err(<D::Error as serde::de::Error>::custom(format!("heads|stems|lines|accidentals|ties|phrases|slurs|rests|names|notes, got {s}"))),
        });
    }
    Ok(out)
}

impl Default for Opts {
    fn default() -> Self {
        Self { x: [16.0, 0.0], y: [6.0, 3.0], notes: vec![Layer::Heads, Layer::Stems, Layer::Accidentals], names: NamesFormat::default(), pitch: "pitch".into(), dur: "dur".into(), vel: "vel".into(), lo: 55.0, hi: 84.0, beats: 16.0, settings: Settings::default() }
    }
}

/// (onset beats, midi, dur beats, dynamics 0..1; absent dim -> 0.5)
pub type Event = (f32, f32, f32, f32);

fn line(x0: f32, y0: f32, x1: f32, y1: f32, w: f32) -> Value {
    json!({"op": "line", "pts": [[x0, y0], [x1, y1]], "w": w})
}

fn ellipse(cx: f32, cy: f32, rx: f32, ry: f32, fill: bool) -> Value {
    json!({"op": "ellipse", "c": [cx, cy], "r": [rx, ry], "fill": fill, "w": 1.0})
}

fn bezier(p0: (f32, f32), p1: (f32, f32), p2: (f32, f32), p3: (f32, f32), w: f32) -> Value {
    json!({"op": "bezier", "pts": [[p0.0, p0.1], [p1.0, p1.1], [p2.0, p2.1], [p3.0, p3.1]], "w": w})
}

fn text_op(x: f32, y: f32, text: &str, size_pt: f32) -> Value {
    json!({"op": "text", "c": [x, y], "text": text, "size": size_pt})
}

/// Rounded MIDI -> diatonic staff step; step 0 = E4 (treble bottom line), one step = half a gap.
/// Black keys sit between two naturals: `flat` = true -> the upper natural's position (Gb on G),
/// false -> the lower's (F# on F). With the accidentals layer the FOLLOWING note's motion picks
/// (down = flat); without it, callers pass false = plain round-to-nearest-division (ties down,
/// no spelling concept).
fn step(midi: f32, flat: bool) -> i32 {
    const SHARP: [i32; 12] = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // pc -> letter index (C# = C)
    const FLAT: [i32; 12] = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6]; // ... (flat names: Db Eb Gb Ab Bb)
    let n = midi.round() as i32;
    let (octave, pc) = (n.div_euclid(12), n.rem_euclid(12) as usize);
    (octave - 5) * 7 + (if flat { FLAT } else { SHARP })[pc] - 2
}

/// Accidental for an isolated drawn note (standard: applies to that notehead only, no bar
/// persistence): black-key class -> Some(sharp or flat), spelled by the FOLLOWING note's motion
/// (down = flat, up/repeat = sharp); diatonic = None. Naturals never drawn.
fn acc(midi: f32, next: Option<f32>) -> Option<bool> {
    let pc = (midi.round() as i32).rem_euclid(12);
    if matches!(pc, 1 | 3 | 6 | 8 | 10) {
        Some(!next.is_some_and(|n| n.round() < midi.round()))
    } else {
        None
    }
}

fn staff(y: f32, x0: f32, x1: f32, gap: f32) -> impl Iterator<Item = Value> {
    (0..5).map(move |i| line(x0, y + i as f32 * gap, x1, y + i as f32 * gap, 1.0))
}

/// Formats a pitch according to the selected `NamesFormat`.
/// Options: tonerow numbers (0..9, t, e), MIDI notes, Hz, or A5, or A (no octave #).
fn format_note_name(midi: f32, fmt: NamesFormat, sharp: Option<bool>) -> String {
    let m = midi.round() as i32;
    let pc = m.rem_euclid(12) as usize;
    match fmt {
        NamesFormat::Pitchclass => {
            const PC_CHARS: [&str; 12] = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "t", "e"];
            PC_CHARS[pc].to_string()
        }
        NamesFormat::Midi => m.to_string(),
        NamesFormat::Hz => {
            // A4 = 69 = 440 Hz
            let freq = 440.0 * 2.0_f64.powf((midi as f64 - 69.0) / 12.0);
            format!("{}Hz", freq.round() as i64)
        }
        NamesFormat::Notename => {
            const SHARP_NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
            const FLAT_NAMES: [&str; 12] = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
            let name = if sharp == Some(false) { FLAT_NAMES[pc] } else { SHARP_NAMES[pc] };
            let octave = m.div_euclid(12) - 1;
            format!("{name}{octave}")
        }
        NamesFormat::Note => {
            const SHARP_NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
            const FLAT_NAMES: [&str; 12] = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
            let name = if sharp == Some(false) { FLAT_NAMES[pc] } else { SHARP_NAMES[pc] };
            name.to_string()
        }
    }
}
fn ledgers(x: f32, bottom: f32, gap: f32, step: i32) -> impl Iterator<Item = Value> {
    let below = (step..=-2).rev().step_by(2);
    let above = (10..=step).step_by(2);
    below.chain(above).map(move |s| {
        let ly = bottom - s as f32 * gap / 2.0;
        line(x - gap, ly, x + gap, ly, 1.0)
    })
}

/// Stem from the head's y (`up_override`: when specified, forces stem direction; default = up);
/// skips events >= 4 beats (no stem on whole+).
fn stem(x: f32, y: f32, gap: f32, _step: Option<i32>, beats: f32, up_override: Option<bool>) -> Option<Value> {
    if beats >= 4.0 {
        return None;
    }
    let up = up_override.unwrap_or(true);
    // Notehead ellipse rx = 0.6 * gap. Place stem flush on the outer contour of the notehead.
    let sx = x + if up { gap * 0.6 } else { -gap * 0.6 };
    Some(line(sx, y, sx, if up { y - 3.5 * gap } else { y + 3.5 * gap }, 1.0))
}

/// Accidental glyph at the head's y: `Some(true)` = sharp (4 lines), `Some(false)` = flat (3).
fn glyph(x: f32, y: f32, gap: f32, sharp: Option<bool>) -> Vec<Value> {
    let Some(sharp) = sharp else { return vec![] };
    let ax = x - gap * 1.6;
    if sharp {
        vec![
            line(ax - gap * 0.3, y - gap * 0.2, ax + gap * 0.3, y - gap * 0.4, 1.5),
            line(ax - gap * 0.3, y + gap * 0.4, ax + gap * 0.3, y + gap * 0.2, 1.5),
            line(ax - gap * 0.12, y - gap * 0.8, ax - gap * 0.12, y + gap * 0.8, 1.0),
            line(ax + gap * 0.12, y - gap * 0.9, ax + gap * 0.12, y + gap * 0.7, 1.0),
        ]
    } else {
        vec![
            line(ax, y - gap * 1.4, ax, y + gap * 0.8, 1.0),
            line(ax, y + gap * 0.15, ax + gap * 0.45, y - gap * 0.1, 1.5),
            line(ax + gap * 0.45, y - gap * 0.1, ax, y + gap * 0.8, 1.5),
        ]
    }
}

/// Rest glyph centered at (x, mid_staff_y) based on duration in beats (quarter = 1.0).
/// Durations: <= 0.0 breath mark (comma above staff), >= 4 whole, >= 2 half, >= 1 quarter, >= 0.5 8th, < 0.5 16th.
fn rest_glyph(x: f32, mid_y: f32, gap: f32, d: f32) -> Vec<Value> {
    if d <= 1e-4 {
        // Breath mark: comma-shaped arc sitting just above the staff (above line 5 = mid_y - 2*gap)
        let by = mid_y - gap * 2.2;
        let c0 = (x, by);
        let c1 = (x + gap * 0.3, by + gap * 0.2);
        let c2 = (x + gap * 0.3, by + gap * 0.5);
        let c3 = (x, by + gap * 0.7);
        vec![bezier(c0, c1, c2, c3, 1.5)]
    } else if d >= 3.5 {
        // Whole rest: rectangle hanging below line 4 (mid_y - 0.5 * gap)
        let ry = mid_y - gap * 0.5;
        let rw = gap * 0.7;
        let rh = gap * 0.5;
        vec![json!({
            "op": "poly",
            "pts": [[x - rw, ry], [x + rw, ry], [x + rw, ry + rh], [x - rw, ry + rh]],
            "closed": true,
            "fill": true,
            "w": 1.0
        })]
    } else if d >= 1.75 {
        // Half rest: rectangle sitting on line 3 (mid_y)
        let ry = mid_y;
        let rw = gap * 0.7;
        let rh = gap * 0.5;
        vec![json!({
            "op": "poly",
            "pts": [[x - rw, ry - rh], [x + rw, ry - rh], [x + rw, ry], [x - rw, ry]],
            "closed": true,
            "fill": true,
            "w": 1.0
        })]
    } else if d >= 0.75 {
        // Quarter rest: classic zigzag (4 connected segments)
        vec![
            line(x - gap * 0.3, mid_y - gap * 1.2, x + gap * 0.3, mid_y - gap * 0.5, 1.5),
            line(x + gap * 0.3, mid_y - gap * 0.5, x - gap * 0.3, mid_y + gap * 0.1, 1.5),
            line(x - gap * 0.3, mid_y + gap * 0.1, x + gap * 0.25, mid_y + gap * 0.7, 1.5),
            line(x + gap * 0.25, mid_y + gap * 0.7, x - gap * 0.2, mid_y + gap * 1.2, 1.5),
        ]
    } else if d >= 0.375 {
        // 8th rest: slash with a hook
        vec![
            line(x + gap * 0.2, mid_y - gap * 0.8, x - gap * 0.2, mid_y + gap * 0.8, 1.5),
            ellipse(x - gap * 0.1, mid_y - gap * 0.5, gap * 0.3, gap * 0.3, true),
        ]
    } else {
        // 16th rest: slash with two hooks
        vec![
            line(x + gap * 0.2, mid_y - gap * 1.0, x - gap * 0.2, mid_y + gap * 1.0, 1.5),
            ellipse(x - gap * 0.1, mid_y - gap * 0.6, gap * 0.25, gap * 0.25, true),
            ellipse(x - gap * 0.2, mid_y - gap * 0.1, gap * 0.25, gap * 0.25, true),
        ]
    }
}

pub fn events(m: &Multi, o: &Opts) -> Vec<Vec<Event>> {
    let (pi, di, vi) = (m.attr(&o.pitch), m.attr(&o.dur), m.attr(&o.vel));
    let (xi, yi) = (m.attr("x").unwrap_or(0), m.attr("y").unwrap_or(1));
    (0..m.lines.len())
        .map(|l| {
            let pts: Vec<&[f32]> = m.points(l).collect();
            let mut t = 0.0;
            pts.iter()
                .enumerate()
                .map(|(i, p)| {
                    let midi = pi.map_or(o.lo + (1.0 - p[yi]) * (o.hi - o.lo), |a| p[a]);
                    let d = match (di, pts.get(i + 1)) {
                        (Some(a), _) => {
                            let val = p[a];
                            // 0-duration rest allows zero-duration breath mark
                            if val <= 0.0 && midi < 0.0 {
                                0.0
                            } else {
                                val.max(1.0 / 16.0)
                            }
                        }
                        (None, Some(n)) => (n[xi] - p[xi]).abs() * o.beats,
                        (None, None) => 1.0,
                    };
                    let v = vi.map_or(0.5, |a| if p[a] > 1.0 { p[a] / 127.0 } else { p[a] }).clamp(0.0, 1.0);
                    let e = (t, midi, d, v);
                    t += d;
                    e
                })
                .collect()
        })
        .collect()
}

/// System `s` of height `sys_h` -> (page, top): systems flow down a page, then onto the next
/// (the renderer makes one artboard per page).
fn place(s: usize, sys_h: f32, margin: f32) -> (usize, f32) {
    let per_page = (((1.0 - 2.0 * margin) / sys_h).floor() as usize).max(1);
    (s / per_page, margin + (s % per_page) as f32 * sys_h)
}

fn on_page(mut ops: Vec<Value>, page: usize) -> Vec<Value> {
    if page > 0 {
        ops.iter_mut().for_each(|o| o["page"] = json!(page));
    }
    ops
}

/// y pair -> staff layout: [6,3] normal staff | [12,1] chromatic | [1,1] octave rules.
#[derive(Clone, Copy, PartialEq)]
pub enum Pitch {
    /// normal 5-line treble staff, one per voice; accidentals by following-note motion
    Staff,
    /// chromatic staff: 1 line/space per halfstep, 0 = middle C, one per voice
    Twelve,
    /// one shared band w/ a rule per octave C
    Rules,
}

fn pitch_of(o: &Opts) -> Option<Pitch> {
    const EPS: f32 = 1e-6;
    // y[1] = the accidental mode: 3 = motion-spelled accidentals, 0/1 = none
    match () { // f32s: no float match patterns
        _ if (o.y[0] - 6.0).abs() < EPS && ((o.y[1] - 1.0).abs() < EPS || (o.y[1] - 3.0).abs() < EPS || (o.y[1] - 0.0).abs() < EPS) => Some(Pitch::Staff),
        _ if (o.y[0] - 12.0).abs() < EPS && ((o.y[1] - 1.0).abs() < EPS || (o.y[1] - 0.0).abs() < EPS) => Some(Pitch::Twelve),
        _ if (o.y[0] - 1.0).abs() < EPS && ((o.y[1] - 1.0).abs() < EPS || (o.y[1] - 0.0).abs() < EPS) => Some(Pitch::Rules),
        _ => None,
    }
}

/// voices -> ops: the `x` pair lays the time axis (x[0] > 0 = a heavy barline every x[0]
/// quarters, else unmeasured single row over the total span; x[1] = light rule every x[1]
/// quarters), the `y` pair picks the staff (see [`Pitch`]), the `notes` layers draw each event.
/// Systems span the PHYSICAL base: the page width (px) divided by the quarter-note width
/// (settings.quarter_in, default 1/4 inch) gives the quarters that fit, rounded to the nearest whole
/// bar (x[0] quarters), then justified to fill the system width — notes never overlap.
pub fn render(voices: &[Vec<Event>], o: &Opts, page: Page) -> Vec<Value> {
    let Some(pitch) = pitch_of(o) else { return vec![] };
    if voices.is_empty() || o.notes.is_empty() {
        return vec![];
    }
    let margin = 0.08f32;
    let (x0, x1) = (margin, 1.0 - margin);
    let total = voices.iter().filter_map(|v| v.last()).map(|e| e.0 + e.2).fold(0.0, f32::max).max(1e-3);
    let metered = o.x[0] > 0.0;
    let per = o.x[0].max(1e-3);
    // systems span the physical base: the usable page width (px) / the quarter-note width (px,
    // spacing = a kerning multiplier over it) = the quarters that fit, ROUNDED TO THE NEAREST
    // WHOLE BAR (a multiple of x[0]) so every system boundary lands on a barline and every
    // system holds the same quarter count
    let kern = o.settings.spacing.max(0.01) as f64;
    let quarter_px = (o.settings.quarter_in.max(0.01) * page.dpi.max(1.0)) * kern;
    let inch_y = (page.dpi / page.height_px.max(1.0)) as f32;
    let gap = match pitch {
        Pitch::Staff => inch_y / 4.0,
        Pitch::Rules | Pitch::Twelve => inch_y / 6.0,
    };
    let usable_px = page.width_px.max(1.0) * (x1 - x0 - 4.0 * gap) as f64;
    let quarters_fit = usable_px / quarter_px;
    let bars = (quarters_fit / per as f64).round().max(1.0) as usize;
    let bps = bars; // bars per system
    let span = bps as f32 * per;
    // (beat window end, x for a system-local beat time)
    let (end, x): (f32, Box<dyn Fn(f32) -> f32>) = if metered {
        (span, Box::new(move |t| x0 + 3.0 * gap + t / span * (x1 - x0 - 4.0 * gap)))
    } else {
        (total, Box::new(move |t| x0 + t / total * (x1 - x0)))
    };
    // octave spans [lo, hi) rel. middle C (empty voice -> (0, 1))
    let spans: Vec<(i32, i32)> = voices
        .iter()
        .map(|v| {
            let st = |f: fn(f32, f32) -> f32, z| v.iter().map(|e| e.1.round() - 60.0).fold(z, f);
            let (lo, hi) = (st(f32::min, f32::MAX), st(f32::max, f32::MIN));
            if lo > hi { (0, 1) } else { ((lo / 12.0).floor() as i32, (hi / 12.0).floor() as i32 + 1) }
        })
        .collect();
    // shared span ([1,1]: all voices laid over one band)
    let (slo, shi) = spans.iter().fold((i32::MAX, i32::MIN), |(a, b), &(lo, hi)| (a.min(lo), b.max(hi)));
    let heights: Vec<f32> = match pitch {
        Pitch::Staff => vec![4.0 * gap + 4.0 * gap; voices.len()],
        // half-step space per line/space + 3-gap padding
        Pitch::Twelve => spans.iter().map(|&(lo, hi)| ((hi - lo) * 12) as f32 * gap / 2.0 + 3.0 * gap).collect(),
        // one shared octave band (height from the shared span; voices 1+ add nothing)
        Pitch::Rules => {
            let band = ((shi - slo) * 12) as f32 * gap / 2.0 + 3.0 * gap;
            let mut h = vec![0.0; voices.len()];
            h[0] = band;
            h
        }
    };
    let sys_h = heights.iter().sum::<f32>() + if pitch == Pitch::Staff { 0.0 } else { 2.0 * gap };
    let n_sys = if metered { ((total / span).ceil() as usize).max(1) } else { 1 };
    let mut ops = vec![];
    for s in 0..n_sys {
        let (page, sys_top) = place(s, sys_h, margin);
        let mut sys = vec![];
        // per voice: bottom line y + pitch -> y
        let mut vtop = sys_top;
        let staves: Vec<(f32, Box<dyn Fn(f32) -> f32>)> = voices
            .iter()
            .enumerate()
            .map(|(vi, _)| {
                let (bottom, base) = match pitch {
                    Pitch::Staff => (vtop + 4.0 * gap, 0.0f32), // treble: 5 lines top..bottom
                    Pitch::Twelve => (vtop + heights[vi] - 3.0 * gap, (spans[vi].0 * 12) as f32),
                    Pitch::Rules => (vtop + heights[vi] - 3.0 * gap, (slo * 12) as f32),
                };
                vtop += heights[vi];
                let y: Box<dyn Fn(f32) -> f32> = match pitch {
                    Pitch::Staff => Box::new(move |m| bottom - step(m, false) as f32 * gap / 2.0),
                    Pitch::Twelve => Box::new(move |m| bottom - (m.round() - 60.0 - base) * gap / 2.0),
                    Pitch::Rules => Box::new(move |m| bottom - (m - 60.0 - base) * gap / 2.0),
                };
                (bottom, y)
            })
            .collect();
        // staff lines
        for (vi, &(bottom, _)) in staves.iter().enumerate() {
            match pitch {
                Pitch::Staff => sys.extend(staff(bottom - 4.0 * gap, x0, x1, gap)),
                Pitch::Twelve => {
                    for h in (spans[vi].0 * 12..=spans[vi].1 * 12).step_by(2) {
                        let y = bottom - (h - spans[vi].0 * 12) as f32 * gap / 2.0;
                        sys.push(line(x0, y, x1, y, if h.rem_euclid(12) == 0 { 1.5 } else { 0.5 }));
                    }
                }
                // octave rules at each C, drawn once (all voices share the band)
                Pitch::Rules => {
                    if vi == 0 {
                        for h in (slo * 12..=shi * 12).step_by(12) {
                            let y = bottom - (h - slo * 12) as f32 * gap / 2.0;
                            sys.push(line(x0, y, x1, y, 1.0));
                        }
                    }
                }
            }
        }
        // notes: in metered mode an event spanning a barline ties into the next system (draws
        // again at the wrap point); unmeasured clips at the row end
        for (vi, voice) in voices.iter().enumerate() {
            let (bottom, y) = &staves[vi];
            for (ei, &(t, m, d, v)) in voice.iter().enumerate() {
                // rests (m < 0)
                if m < 0.0 {
                    if o.notes.contains(&Layer::Rests) {
                        let off = s as f32 * span;
                        if t >= off && t < (if metered { off + span } else { end }) {
                            let lt = t - off;
                            let mid_y = match pitch {
                                Pitch::Staff => *bottom - 2.0 * gap, // middle line (B4)
                                _ => y(60.0),
                            };
                            sys.extend(rest_glyph(x(lt), mid_y, gap, d));
                        }
                    }
                    continue;
                }
                // [fs, fe) = the event's overlap with system s's beat window (0 = row start)
                let off = s as f32 * span;
                let (fs, fe) = (t.max(off), (t + d).min(if metered { off + span } else { end }));
                if fe <= fs {
                    continue;
                }
                let (lt, le) = (fs - off, fe - off);
                let y = y(m);
                // lines layer: headless dur bar over the event span, thickness = dynamics
                if o.notes.contains(&Layer::Lines) {
                    sys.push(line(x(lt), y, x(le), y, 0.5 + v * 6.0));
                }
                // accidentals layer + y[1] (= 3) gate: glyph by the following note's motion
                // (down = flat, up/repeat = sharp); the spelling also moves the staff position
                // (Gb on G, F# on F). Without the layer: no spelling concept — heads just round
                // to the nearest division (step(m, false) = ties to the lower natural)
                let sharp = if pitch == Pitch::Staff && o.y[1] > 2.0 && o.notes.contains(&Layer::Accidentals) {
                    acc(m, voice.get(ei + 1).map(|e| e.1))
                } else {
                    None
                };
                // head + stem sit at the spelled position (staff) or the grid itself (twelve/rules)
                let (st, hy) = match pitch {
                    Pitch::Staff => {
                        let st = step(m, sharp == Some(false));
                        (Some(st), *bottom - st as f32 * gap / 2.0)
                    }
                    _ => (None, y),
                };
                if o.notes.contains(&Layer::Heads) {
                    sys.push(ellipse(x(lt), hy, gap * 0.6, gap * 0.45, d < 2.0));
                    if let Some(st) = st {
                        sys.extend(ledgers(x(lt), *bottom, gap, st));
                    }
                }
                if o.notes.contains(&Layer::Stems) {
                    let up_override = if voices.len() > 1 {
                        if vi == 0 {
                            Some(true)  // top voice: stems UP
                        } else if vi == voices.len() - 1 {
                            Some(false) // bottom voice: stems DOWN
                        } else {
                            Some(true)  // default: UP
                        }
                    } else {
                        Some(true)      // default = UP
                    };
                    if let Some(s) = stem(x(lt), hy, gap, st, d, up_override) {
                        sys.push(s);
                    }
                }
                sys.extend(glyph(x(lt), hy, gap, sharp));

                if o.notes.contains(&Layer::Names) {
                    let text = format_note_name(m, o.names, sharp);
                    // Place label to the right of the notehead/stem: notehead rx is gap * 0.6
                    let tx = x(lt) + gap * 0.8;
                    // Centered vertically with the notehead
                    let ty = hy;
                    let size_pt = (gap * 1000.0).clamp(8.5, 14.0);
                    sys.push(text_op(tx, ty, &text, size_pt));
                }

                // If note crosses a barline into the next system and Ties layer is on, add a tie arc
                if metered && o.notes.contains(&Layer::Ties) && t < off + span && t + d > off + span {
                    // Start of note on current system
                    if t >= off {
                        let lt = t - off;
                        let x1_pt = x(lt);
                        let x2_pt = x1 - gap; // extends to system end
                        let arc_above = if voices.len() == 1 {
                            true
                        } else if vi == 0 {
                            true
                        } else if vi == voices.len() - 1 {
                            false
                        } else {
                            true
                        };
                        let bow = gap * 1.0;
                        let dir = if arc_above { -1.0 } else { 1.0 };
                        let start_y = hy + dir * gap * 0.6;
                        let dx = x2_pt - x1_pt;
                        let c1 = (x1_pt + dx * 0.25, start_y + dir * bow);
                        let c2 = (x2_pt - dx * 0.25, start_y + dir * bow);
                        sys.push(bezier((x1_pt, start_y), c1, c2, (x2_pt, start_y), 1.0));
                    }
                }
                // If note continues from previous system wrap point and Ties layer is on, add incoming tie arc
                if metered && o.notes.contains(&Layer::Ties) && t < off && t + d > off {
                    let x1_pt = x0 + 3.0 * gap; // incoming from system start
                    let x2_pt = x(lt);
                    let arc_above = if voices.len() == 1 {
                        true
                    } else if vi == 0 {
                        true
                    } else if vi == voices.len() - 1 {
                        false
                    } else {
                        true
                    };
                    let bow = gap * 1.0;
                    let dir = if arc_above { -1.0 } else { 1.0 };
                    let start_y = hy + dir * gap * 0.6;
                    let dx = x2_pt - x1_pt;
                    let c1 = (x1_pt + dx * 0.25, start_y + dir * bow);
                    let c2 = (x2_pt - dx * 0.25, start_y + dir * bow);
                    sys.push(bezier((x1_pt, start_y), c1, c2, (x2_pt, start_y), 1.0));
                }
            }

            // phrase marking: ONE continuous curve over each whole phrase
            if o.notes.contains(&Layer::Phrases) {
                let off = s as f32 * span;
                let s_end = if metered { off + span } else { end };

                // Group contiguous non-rest notes into phrases
                let mut phrases: Vec<Vec<(usize, f32, f32, f32, f32)>> = Vec::new(); // (voice_idx, t, m, d, v)
                let mut current_phrase: Vec<(usize, f32, f32, f32, f32)> = Vec::new();
                let mut prev_t = -1.0f32;
                let mut prev_d = 0.0f32;

                for (idx, &(t_e, m_e, d_e, v_e)) in voice.iter().enumerate() {
                    if m_e < 0.0 {
                        // Rest terminates current phrase
                        if !current_phrase.is_empty() {
                            phrases.push(std::mem::take(&mut current_phrase));
                        }
                        prev_t = -1.0;
                        continue;
                    }
                    // Non-contiguous gap in time also terminates phrase
                    if prev_t >= 0.0 && t_e > prev_t + prev_d + 1e-4 {
                        if !current_phrase.is_empty() {
                            phrases.push(std::mem::take(&mut current_phrase));
                        }
                    }
                    current_phrase.push((idx, t_e, m_e, d_e, v_e));
                    prev_t = t_e;
                    prev_d = d_e;
                }
                if !current_phrase.is_empty() {
                    phrases.push(current_phrase);
                }

                for (phrase_idx, phrase) in phrases.iter().enumerate() {
                    // A phrase marking spans at least 2 notes
                    if phrase.len() < 2 {
                        continue;
                    }
                    let &(first_idx, t_first, m_first, _, _) = phrase.first().unwrap();
                    let &(last_idx, t_last, m_last, _, _) = phrase.last().unwrap();

                    // Check if the phrase is at least partially in the current system
                    if t_first >= s_end || t_last < off {
                        continue;
                    }

                    // System-clamped start and end points
                    let (t_start, m_start, is_incoming) = if t_first < off {
                        (off, m_first, true)
                    } else {
                        (t_first, m_first, false)
                    };
                    let (t_end, m_end, is_outgoing) = if t_last >= s_end {
                        (s_end, m_last, true)
                    } else {
                        (t_last, m_last, false)
                    };

                    let lt_start = t_start - off;
                    let lt_end = t_end - off;
                    let x1_pt = if is_incoming { x0 + 3.0 * gap } else { x(lt_start) };
                    let x2_pt = if is_outgoing { x1 - gap } else { x(lt_end) };

                    let y1_pt = match pitch {
                        Pitch::Staff => {
                            let sharp = if o.y[1] > 2.0 && o.notes.contains(&Layer::Accidentals) {
                                acc(m_start, voice.get(first_idx + 1).map(|e| e.1))
                            } else {
                                None
                            };
                            let st = step(m_start, sharp == Some(false));
                            *bottom - st as f32 * gap / 2.0
                        }
                        _ => y(m_start),
                    };
                    let y2_pt = match pitch {
                        Pitch::Staff => {
                            let sharp = if o.y[1] > 2.0 && o.notes.contains(&Layer::Accidentals) {
                                acc(m_end, voice.get(last_idx + 1).map(|e| e.1))
                            } else {
                                None
                            };
                            let st = step(m_end, sharp == Some(false));
                            *bottom - st as f32 * gap / 2.0
                        }
                        _ => y(m_end),
                    };

                    // Direction: top voice (0) = above; bottom voice (last) = below;
                    // middle voices = alternating top/bottom/top/bottom per phrase.
                    let arc_above = if voices.len() == 1 {
                        true
                    } else if vi == 0 {
                        true
                    } else if vi == voices.len() - 1 {
                        false
                    } else {
                        phrase_idx % 2 == 0
                    };

                    // Bow offset: scales with phrase width, min 1.5 gap
                    let dx = x2_pt - x1_pt;
                    let bow = (gap * 1.5 + dx * 0.05).min(gap * 3.5);
                    let dir = if arc_above { -1.0 } else { 1.0 };
                    let start_y = y1_pt + dir * gap * 0.7;
                    let end_y = y2_pt + dir * gap * 0.7;
                    let c1 = (x1_pt + dx * 0.25, start_y + dir * bow);
                    let c2 = (x2_pt - dx * 0.25, end_y + dir * bow);
                    sys.push(bezier((x1_pt, start_y), c1, c2, (x2_pt, end_y), 1.0));
                }
            }
        }
        // rhythm verticals: the heavy barline at x1 (metered), then the light rule every x[1]
        // quarters (x(t - lo); meters skip multiples at the system edge — the barline draws
        // there — and unmeasured includes the end, the piece-final rule)
        let bottom = staves.last().map_or(sys_top, |st| st.0);
        if metered {
            // heavy barline at every x[0]-interval: `bps` per system, the last = the edge —
            // interior bars get their own rules, systems stay evenly spaced regardless
            for b in 1..=bps {
                let bx = x0 + 3.0 * gap + (b as f32 * per / span) * (x1 - x0 - 4.0 * gap);
                sys.push(line(bx, sys_top, bx, bottom, 1.0));
            }
        }
        if o.x[1] > 0.0 {
            let light = o.x[1].max(1e-3);
            let (lo, hi) = if metered { (s as f32 * span, (s + 1) as f32 * span) } else { (0.0, end) };
            for k in (lo / light).floor() as i64..=(hi / light).floor() as i64 {
                let t = k as f32 * light;
                if t <= lo + 1e-4 || (metered && t >= hi - 1e-4) {
                    continue;
                }
                sys.push(line(x(t - lo), sys_top, x(t - lo), bottom, 0.25));
            }
        }
        ops.extend(on_page(sys, page));
    }
    ops
}

pub fn document(m: &Multi, source: &str, frame: u32, o: &Opts, page: Page) -> Value {
    let ops = render(&events(m, o), o, page);
    json!({"version": 1, "source": source, "frame": frame, "ops": ops})
}

#[cfg(test)]
mod tests {
    use super::*;

    const STAFF: [f32; 2] = [6.0, 3.0];
    const TWELVE: [f32; 2] = [12.0, 1.0];

    const NOTES: [Layer; 3] = [Layer::Heads, Layer::Stems, Layer::Accidentals];
    /// test page: 480 px wide @ 96 dpi -> a quarter note = 24 px -> 16 quarters/system at
    /// x[0]=4 (4 bars) and x[0]=16 (1 bar)
    const PAGE: Page = Page { width_px: 480.0, height_px: 1080.0, dpi: 96.0 };
    const HEADS: [Layer; 1] = [Layer::Heads];
    const LINES: [Layer; 1] = [Layer::Lines];

    fn opts(x: [f32; 2], y: [f32; 2], notes: &[Layer]) -> Opts {
        Opts { x, y, notes: notes.to_vec(), ..Opts::default() }
    }

    fn opts_sp(x: [f32; 2], y: [f32; 2], notes: &[Layer], spacing: f32) -> Opts {
        Opts { x, y, notes: notes.to_vec(), settings: Settings { spacing, ..Settings::default() }, ..Opts::default() }
    }

    #[test]
    fn steps_and_acc_by_motion() {
        assert_eq!(step(64.0, false), 0);
        assert_eq!(step(60.0, false), -2);
        assert_eq!(step(66.0, false), 1, "F# on the F position");
        assert_eq!(step(66.0, true), 2, "Gb on the G position");
        assert_eq!(acc(66.0, Some(64.0)), Some(false), "down-motion = flat");
        assert_eq!(acc(66.0, Some(67.0)), Some(true), "up-motion = sharp");
        assert_eq!(acc(66.0, None), Some(true), "no follower = sharp");
        assert_eq!(acc(65.0, Some(63.0)), None, "F = diatonic, never marked");
        assert_eq!(acc(65.0, Some(75.0)), None);
        assert_eq!(step(66.0, true) - step(65.0, false), 1, "Gb reads one step above F");
    }

    #[test]
    fn events_from_dims() {
        let m = Multi { attrs: vec!["x".into(), "y".into(), "pitch".into(), "dur".into()], lines: vec![vec![0.0, 0.5, 60.0, 1.0, 0.5, 0.5, 62.0, 2.0]] };
        assert_eq!(events(&m, &Opts::default()), vec![vec![(0.0, 60.0, 1.0, 0.5), (1.0, 62.0, 2.0, 0.5)]]);
    }

    #[test]
    fn defaults_draw_standard_score() {
        // default opts ([16,0] + [6,3] + notes): E4 & F#4 quarter notes, 1 system
        let voices = vec![vec![(0.0, 64.0, 1.0, 0.5), (1.0, 66.0, 1.0, 0.5)]];
        let ops = render(&voices, &Opts::default(), PAGE);
        // 5 staff lines + E4 (head + stem) + F#4 (head + stem + sharp; up-motion) + barline
        assert_eq!(ops.len(), 5 + 2 + 6 + 1);
        let barline = &ops[13];
        let gap = (PAGE.dpi / PAGE.height_px.max(1.0)) as f32 / 4.0;
        assert!((barline["pts"][0][0].as_f64().unwrap() - (0.92 - gap as f64)).abs() < 1e-4, "closing barline at x1 - gap (4-gap right pad)");
    }

    #[test]
    fn flat_by_down_motion() {
        // C#4 falling to C4: flat spelling takes the D position (Db), 3-line glyph
        let voices = vec![vec![(0.0, 61.0, 1.0, 0.5), (1.0, 60.0, 1.0, 0.5)]];
        let ops = render(&voices, &opts([16.0, 0.0], STAFF, &NOTES), PAGE);
        // 5 lines + [head, stem, flat-stem, bowl x2] + [head, ledger, stem] + barline
        assert_eq!(ops.len(), 5 + 5 + 3 + 1);
        assert!(ops[7..10].iter().all(|op| op["op"] == "line"), "flat = stem + 2-line bowl");
        let bare = render(&voices, &opts([16.0, 0.0], [6.0, 1.0], &NOTES), PAGE);
        assert_eq!(bare.len(), 12, "[6,1] = staff without accidentals: 5 lines + [head, stem, ledger] + [head, ledger, stem] + barline");
    }

    #[test]
    fn twelve_axes_compose() {
        // C4 (0) & C#4 (1): one octave staff = 7 lines (0 2 4 6 8 t 0')
        let v = vec![vec![(0.0, 60.0, 1.0, 0.5), (1.0, 61.0, 1.0, 0.5)]];
        let heads = render(&v, &opts([16.0, 0.0], TWELVE, &HEADS), PAGE);
        assert_eq!(heads.len(), 7 + 2 + 1, "7 chromatic lines + 2 heads + barline");
        let (c_line, c_head, cs_head) = (&heads[0], &heads[7], &heads[8]);
        assert_eq!(c_line["w"].as_f64(), Some(1.5), "0 (C) = heavy line");
        assert_eq!(c_head["c"][1], c_line["pts"][0][1], "0 = middle C sits on the heavy line");
        assert!(cs_head["c"][1].as_f64() < c_head["c"][1].as_f64(), "1 = next space up");
        assert_eq!(render(&v, &opts([16.0, 0.0], TWELVE, &NOTES), PAGE).len(), 7 + 4 + 1, "notes adds a stem per head");
        let bars = render(&v, &opts([16.0, 0.0], TWELVE, &LINES), PAGE);
        assert_eq!(bars.len(), 7 + 2 + 1, "lines draws dur bars instead of heads");
        assert_eq!(bars[7]["w"].as_f64(), Some(3.5), "bar thickness = dynamics (0.5 + v*6)");
    }

    #[test]
    fn octave_rules_band_with_light_beats() {
        // [1,1] + x=[0,1]: C4..B4 -> C4/C5 octave rules in one shared band, dur bars,
        // light rule every quarter (mid + piece-final edge)
        let v = vec![vec![(0.0, 60.0, 1.0, 0.0), (1.0, 71.0, 1.0, 1.0)]];
        let ops = render(&v, &opts([0.0, 1.0], [1.0, 1.0], &LINES), PAGE);
        assert_eq!(ops.len(), 2 + 2 + 2, "2 octave rules, 2 bars, 2 light rules");
        assert!(ops[..2].iter().all(|op| op["w"].as_f64() == Some(1.0)), "octave rules");
        assert_eq!((ops[2]["w"].as_f64(), ops[3]["w"].as_f64()), (Some(0.5), Some(6.5)), "thickness = dynamics");
        assert!(ops[4..].iter().all(|op| op["w"].as_f64() == Some(0.25)), "light rules");
        assert!((ops[4]["pts"][0][0].as_f64().unwrap() - 0.5).abs() < 1e-4, "light rule at beat 1");
        assert!((ops[5]["pts"][0][0].as_f64().unwrap() - 0.92).abs() < 1e-4, "final rule at x1");
    }

    #[test]
    fn lightbars_fractional_grid() {
        // x = [0, 1/4]: unmeasured band + a light rule every quarter-quarter (the piece-final
        // edge included): rules at 1/4 and 2/4 of the 0.5-beat span
        let v = vec![vec![(0.0, 64.0, 0.5, 0.5)]];
        let ops = render(&v, &opts([0.0, 0.25], STAFF, &HEADS), PAGE);
        assert_eq!(ops.len(), 5 + 1 + 2, "5 staff lines + head + rules at 1/4, 2/4 of the span");
        assert!(ops[6..].iter().all(|op| op["w"].as_f64() == Some(0.25)));
        assert!((ops[6]["pts"][0][0].as_f64().unwrap() - 0.5).abs() < 1e-4, "rule at t = 1/4, mid-band");
        assert!((ops[7]["pts"][0][0].as_f64().unwrap() - 0.92).abs() < 1e-4, "piece-final rule at x1");
    }

    #[test]
    fn overhang_ties_into_next_system() {
        // t=15, d=2 crosses the barline: head at 15 + tied head at 0 in system 2 (no phantom empty)
        let v = vec![vec![(0.0, 64.0, 1.0, 0.5), (15.0, 62.0, 2.0, 0.5)]];
        let heads = render(&v, &opts([16.0, 0.0], STAFF, &HEADS), PAGE);
        assert_eq!(heads.len(), (5 + 2 + 1) + (5 + 1 + 1), "s1: + head at 15; s2: tied head");
        let x_of = |o: &Value, k: &str| o[k].as_array().unwrap()[0].as_f64().unwrap();
        let gap = (PAGE.dpi / PAGE.height_px.max(1.0)) as f32 / 4.0;
        let expected_x0 = (0.08 + 3.0 * gap) as f64;
        assert!((x_of(&heads[13], "c") - expected_x0).abs() < 1e-4, "tied head wraps to s2 x0");
        let bars = render(&v, &opts([16.0, 0.0], STAFF, &LINES), PAGE);
        assert_eq!(bars.len(), heads.len(), "lines ties a bar fragment instead of a head");
        let tail = &bars[13];
        assert!((tail["pts"][0][0].as_f64().unwrap() - expected_x0).abs() < 1e-4, "bar continues at s2 x0");
        assert!(tail["pts"][1][0].as_f64().unwrap() > tail["pts"][0][0].as_f64().unwrap(), "1-beat fragment");
    }

    #[test]
    fn metered_wraps_systems() {
        let v = vec![vec![(0.0, 64.0, 16.0, 0.5), (16.0, 64.0, 1.0, 0.5)]];
        let ops = render(&v, &opts([16.0, 0.0], STAFF, &HEADS), PAGE);
        // 2 systems of 16 beats, one page: 2 x (5 staff lines + head + barline)
        assert_eq!(ops.len(), 2 * (5 + 1 + 1));
        assert_eq!(ops[0]["pts"][0][0], ops[8]["pts"][0][0], "both systems start at x0");
    }

    #[test]
    fn unmeasured_single_row() {
        let v = vec![vec![(0.0, 60.0, 1.0, 0.5), (10.0, 62.0, 2.0, 0.5)]];
        let ops = render(&v, &opts([0.0, 0.0], STAFF, &HEADS), PAGE);
        assert_eq!(ops.len(), 5 + 2 + 1, "5 staff lines + [C4 head + ledger] + D4 head, no barline");
        let first = ops[5]["c"][0].as_f64().unwrap();
        assert!((first - 0.08).abs() < 1e-4, "first onset at x0");
        let second = ops[7]["c"][0].as_f64().unwrap();
        assert!((second - (0.08 + 10.0 / 12.0 * 0.84)).abs() < 1e-4, "x = t / total");
    }

    #[test]
    fn unknown_pairs_render_nothing() {
        let v = vec![vec![(0.0, 64.0, 1.0, 0.5)]];
        assert!(render(&v, &opts([16.0, 0.0], [9.0, 9.0], &HEADS), PAGE).is_empty(), "unknown y pair");
        assert!(render(&v, &opts([16.0, 0.0], [12.0, 3.0], &HEADS), PAGE).is_empty(), "twelve + accidentals = future");
        assert!(render(&v, &opts([16.0, 0.0], STAFF, &[]), PAGE).is_empty(), "empty layer set = no drawing");
    }

    #[test]
    fn notes_opt_deser() {
        use serde::de::IntoDeserializer;
        use serde_json::value::Value;
        let l = |v: Value| layer_set(v.into_deserializer()).unwrap();
        assert_eq!(l(Value::Null), Vec::<Layer>::new(), "null = empty set");
        assert_eq!(l(Value::from("notes")), NOTES.to_vec(), "preset = heads+stems+accidentals");
        assert_eq!(l(Value::from("accidentals")), vec![Layer::Accidentals], "string = one layer");
        assert_eq!(
            l(Value::from(vec!["notes", "lines"])),
            [NOTES.as_slice(), LINES.as_slice()].concat(),
            "notes expands inside a tuple"
        );
        assert!(layer_set(Value::from("raw").into_deserializer()).is_err(), "unknown layer");
        assert!(layer_set(Value::from(vec!["heads", "raw"])).is_err(), "unknown layer in tuple");
    }

    #[test]
    fn layers_superimpose() {
        // heads + lines @ staff: head + dur bar per note, no stems, no accidental glyph
        let v = vec![vec![(0.0, 64.0, 1.0, 0.5), (1.0, 66.0, 1.0, 0.5)]];
        let ops = render(&v, &opts([16.0, 0.0], STAFF, &[Layer::Heads, Layer::Lines]), PAGE);
        assert_eq!(ops.len(), 5 + 2 * 2 + 1, "5 staff lines + bar + head per note + barline");
        assert!(ops[5]["op"] == "line" && ops[6]["op"] == "ellipse", "bar then head (head on top)");
        let stems = render(&v, &opts([16.0, 0.0], STAFF, &[Layer::Stems]), PAGE);
        assert_eq!(stems.len(), 5 + 2 + 1, "stems layer alone: one stem per note");
    }

    #[test]
    fn spacing_scales_the_auto_span() {
        // settings.spacing = a kerning/letterspacing-style multiplier over the auto base
        // (~16 quarters/system): 1 = the default, 0.5 = half-spacing (twice the quarters),
        // 2 = half the span — every system keeps the same quarter count, boundaries on barlines
        let v = vec![vec![(0.0, 64.0, 1.0, 0.5), (12.0, 64.0, 1.0, 0.5), (16.0, 64.0, 1.0, 0.5)]]; // 17 beats
        let auto = render(&v, &opts([4.0, 0.0], STAFF, &HEADS), PAGE);
        assert_eq!(auto.len(), (5 + 2 + 4) + (5 + 1 + 4), "auto: 4 bars = 16 qn/system, 2 systems");
        assert_eq!(render(&v, &opts_sp([4.0, 0.0], STAFF, &HEADS, 1.0), PAGE).len(), auto.len(), "spacing 1 = the auto base");
        let half = render(&v, &opts_sp([4.0, 0.0], STAFF, &HEADS, 0.5), PAGE);
        assert_eq!(half.len(), 5 + 3 + 8, "half-spacing: 32 qn = 8 bars, the piece on one system");
        let loose = render(&v, &opts_sp([4.0, 0.0], STAFF, &HEADS, 2.0), PAGE);
        assert_eq!(loose.len(), 3 * (5 + 1 + 2), "2: 8 qn = 2 bars/system -> 3 systems");
        let frac = render(&v, &opts_sp([4.0, 0.0], STAFF, &HEADS, 1.4), PAGE);
        assert_eq!(frac.len(), (5 + 1 + 3) + (5 + 2 + 3), "1.4: ~11.4-qn base rounds to 3 bars, boundary off 16");
        assert_eq!(render(&v, &opts([16.0, 0.0], STAFF, &HEADS), PAGE).len(), (5 + 2 + 1) + (5 + 1 + 1), "auto @x[0]=16: 1 bar/system");
        assert_eq!(render(&v, &opts_sp([0.0, 0.0], STAFF, &HEADS, 3.0), PAGE).len(), 5 + 3, "unmeasured ignores spacing");
    }

    #[test]
    fn settings_default_is_the_default_spacing() {
        // regression: a derived `Default` gave spacing = 0 -> a 100x too dense layout (every
        // note crammed at the system edge, a light rule every pixel)
        let o: Opts = serde_json::from_value(json!({"x": [4.0, 0.0], "y": [6.0, 3.0]})).unwrap();
        assert_eq!(o.settings.spacing, 1.0, "absent settings = the default spacing");
        assert_eq!(o.settings.quarter_in, QUARTER_IN);
        let v = vec![vec![(0.0, 64.0, 1.0, 0.5), (1.0, 64.0, 1.0, 0.5)]];
        let ops = render(&v, &opts([4.0, 0.0], STAFF, &HEADS), PAGE);
        assert_eq!(ops.len(), 5 + 2 + 4, "16 quarters/system at x[0]=4 (4 bars)");
    }

    #[test]
    fn physical_base_scales_with_the_page() {
        // the system length comes from the page width: a quarter note is at least
        // settings.quarter_in wide, and the length rounds to whole bars
        let v = vec![vec![(0.0, 64.0, 1.0, 0.5), (1.0, 64.0, 1.0, 0.5)]];
        let wide = render(&v, &opts([4.0, 0.0], STAFF, &HEADS), Page { width_px: 960.0, height_px: 1080.0, dpi: 96.0 });
        assert_eq!(wide.len(), 5 + 2 + 8, "960 px: ~32 quarters fit -> 8 bars/system");
        let heads: Vec<&Value> = wide.iter().filter(|o| o["op"] == "ellipse").collect();
        let x = |o: &Value| o["c"][0].as_f64().unwrap();
        let d = (x(heads[1]) - x(heads[0])) * 960.0;
        assert!(d >= 22.0, "a quarter note scales with usable width: {d}");
        let tight = render(&v, &opts([4.0, 0.0], STAFF, &HEADS), Page { width_px: 240.0, height_px: 1080.0, dpi: 96.0 });
        assert_eq!(tight.len(), 5 + 2 + 2, "240 px: ~8 quarters fit -> 2 bars/system");
    }

    #[test]
    fn rules_staff_accept_zero_accidentals() {
        // y[1] = 0 = the same grid without accidentals (J's [1,0] row)
        let v = vec![vec![(0.0, 60.0, 1.0, 0.5), (1.0, 71.0, 1.0, 0.5)]];
        let rules = render(&v, &opts([4.0, 0.0], [1.0, 0.0], &HEADS), PAGE);
        assert!(!rules.is_empty(), "[1,0] = octave rules without accidentals");
        assert_eq!(rules.len(), render(&v, &opts([4.0, 0.0], [1.0, 1.0], &HEADS), PAGE).len());
    }

    #[test]
    fn ledger_c4() {
        // C4 = step -2: one ledger at the head's y; stems need < 4 beats
        let ledger = ledgers(0.5, 0.5, 0.01, -2).collect::<Vec<_>>();
        assert_eq!(ledger.len(), 1);
        assert!(stem(0.5, 0.5, 0.01, Some(-2), 1.0, None).is_some());
        assert!(stem(0.5, 0.5, 0.01, Some(-2), 4.0, None).is_none(), "no stem on whole+");
        assert_eq!(glyph(0.5, 0.5, 0.01, None).len(), 0, "diatonic = no glyph");
    }

    #[test]
    fn ties_and_rests_render_slurs() {
        // Voice with 3 notes and a rest: notes at t=0, t=1; rest at t=2; note at t=3
        let v = vec![vec![
            (0.0, 64.0, 1.0, 0.5),
            (1.0, 66.0, 1.0, 0.5),
            (2.0, -1.0, 1.0, 0.5), // rest (-1.0)
            (3.0, 67.0, 1.0, 0.5),
        ]];
        let ops = render(&v, &opts([16.0, 0.0], STAFF, &[Layer::Heads, Layer::Phrases]), PAGE);
        // 5 staff lines + 3 heads (rest omitted) + 1 slur (between t=0 and t=1, t=2 is rest -> no slur to t=3) + 1 barline
        assert_eq!(ops.len(), 5 + 3 + 1 + 1);
        let beziers: Vec<&Value> = ops.iter().filter(|o| o["op"] == "bezier").collect();
        assert_eq!(beziers.len(), 1, "exactly one slur arc");
        // Single voice = top voice -> arc above (control point y < start_y)
        let b = beziers[0];
        let p0_y = b["pts"][0][1].as_f64().unwrap();
        let p1_y = b["pts"][1][1].as_f64().unwrap();
        assert!(p1_y < p0_y, "top voice arcs above (lower y in screen coords)");

        // 3 voices: top arcs above, bottom arcs below, middle alternates per phrase
        let v3 = vec![
            vec![(0.0, 72.0, 1.0, 0.5), (1.0, 72.0, 1.0, 0.5)], // voice 0: top (1 phrase)
            vec![
                (0.0, 64.0, 1.0, 0.5), (1.0, 64.0, 1.0, 0.5), // phrase 0
                (2.0, -1.0, 1.0, 0.5), // rest
                (3.0, 64.0, 1.0, 0.5), (4.0, 64.0, 1.0, 0.5), // phrase 1
            ], // voice 1: middle (2 phrases)
            vec![(0.0, 48.0, 1.0, 0.5), (1.0, 48.0, 1.0, 0.5)], // voice 2: bottom (1 phrase)
        ];
        let ops3 = render(&v3, &opts([16.0, 0.0], STAFF, &[Layer::Phrases]), PAGE);
        let b3: Vec<&Value> = ops3.iter().filter(|o| o["op"] == "bezier").collect();
        assert_eq!(b3.len(), 4, "1 top + 2 middle + 1 bottom = 4 phrase markings");
        // Top voice (voice 0): above
        assert!(b3[0]["pts"][1][1].as_f64().unwrap() < b3[0]["pts"][0][1].as_f64().unwrap());
        // Middle voice (voice 1): phrase 0 above, phrase 1 below (alternating)
        assert!(b3[1]["pts"][1][1].as_f64().unwrap() < b3[1]["pts"][0][1].as_f64().unwrap(), "mid phrase 0 above");
        assert!(b3[2]["pts"][1][1].as_f64().unwrap() > b3[2]["pts"][0][1].as_f64().unwrap(), "mid phrase 1 below");
        // Bottom voice (voice 2): below
        assert!(b3[3]["pts"][1][1].as_f64().unwrap() > b3[3]["pts"][0][1].as_f64().unwrap(), "bottom voice below");

        // Rests layer test: quarter rest glyph at t=2
        let ops_rest = render(&v, &opts([16.0, 0.0], STAFF, &[Layer::Rests]), PAGE);
        // 5 staff lines + 1 rest glyph (4 lines for quarter rest) + 1 barline = 10 ops
        assert_eq!(ops_rest.len(), 5 + 4 + 1);

        // Breath mark test: 0-duration rest at t=1 between two notes
        let v_breath = vec![vec![
            (0.0, 64.0, 1.0, 0.5),
            (1.0, -1.0, 0.0, 0.5), // 0-duration rest = breath mark
            (1.0, 66.0, 1.0, 0.5),
        ]];
        let ops_bm = render(&v_breath, &opts([16.0, 0.0], STAFF, &[Layer::Rests]), PAGE);
        // 5 staff lines + 1 breath mark (bezier) + 1 barline = 7 ops
        assert_eq!(ops_bm.len(), 5 + 1 + 1);
        assert_eq!(ops_bm[5]["op"], "bezier", "breath mark is a bezier curve");
        // Also ensure phrases layer does not slur across the breath mark
        let ops_no_slur = render(&v_breath, &opts([16.0, 0.0], STAFF, &[Layer::Phrases]), PAGE);
        let slurs: Vec<&Value> = ops_no_slur.iter().filter(|o| o["op"] == "bezier").collect();
        assert_eq!(slurs.len(), 0, "breath mark separates phrases, no slur across it");
    }

    #[test]
    fn names_layer_and_formats() {
        // C4 = 60 (pc 0), C#4/Db4 = 61 (pc 1), A5 = 81 (pc 9, 880Hz), Bb5 = 82 (pc t, 932Hz)
        let v = vec![vec![
            (0.0, 60.0, 1.0, 0.5),
            (1.0, 61.0, 1.0, 0.5),
            (2.0, 81.0, 1.0, 0.5),
            (3.0, 82.0, 1.0, 0.5),
        ]];

        // 1. Pitchclass: 0, 1, 9, t
        let mut o_pc = opts([16.0, 0.0], STAFF, &[Layer::Names]);
        o_pc.names = NamesFormat::Pitchclass;
        let ops_pc = render(&v, &o_pc, PAGE);
        let texts_pc: Vec<&str> = ops_pc.iter().filter(|o| o["op"] == "text").map(|o| o["text"].as_str().unwrap()).collect();
        assert_eq!(texts_pc, vec!["0", "1", "9", "t"]);

        // 2. Midi: "60", "61", "81", "82"
        let mut o_midi = opts([16.0, 0.0], STAFF, &[Layer::Names]);
        o_midi.names = NamesFormat::Midi;
        let ops_midi = render(&v, &o_midi, PAGE);
        let texts_midi: Vec<&str> = ops_midi.iter().filter(|o| o["op"] == "text").map(|o| o["text"].as_str().unwrap()).collect();
        assert_eq!(texts_midi, vec!["60", "61", "81", "82"]);

        // 3. Hz: 60->262Hz, 61->277Hz, 81->880Hz, 82->932Hz
        let mut o_hz = opts([16.0, 0.0], STAFF, &[Layer::Names]);
        o_hz.names = NamesFormat::Hz;
        let ops_hz = render(&v, &o_hz, PAGE);
        let texts_hz: Vec<&str> = ops_hz.iter().filter(|o| o["op"] == "text").map(|o| o["text"].as_str().unwrap()).collect();
        assert_eq!(texts_hz, vec!["262Hz", "277Hz", "880Hz", "932Hz"]);

        // 4. Notename: "C4", "C#4", "A5", "A#5"
        let mut o_nn = opts([16.0, 0.0], STAFF, &[Layer::Names]);
        o_nn.names = NamesFormat::Notename;
        let ops_nn = render(&v, &o_nn, PAGE);
        let texts_nn: Vec<&str> = ops_nn.iter().filter(|o| o["op"] == "text").map(|o| o["text"].as_str().unwrap()).collect();
        assert_eq!(texts_nn, vec!["C4", "C#4", "A5", "A#5"]);

        // 5. Note (no octave): "C", "C#", "A", "A#"
        let mut o_note = opts([16.0, 0.0], STAFF, &[Layer::Names]);
        o_note.names = NamesFormat::Note;
        let ops_note = render(&v, &o_note, PAGE);
        let texts_note: Vec<&str> = ops_note.iter().filter(|o| o["op"] == "text").map(|o| o["text"].as_str().unwrap()).collect();
        assert_eq!(texts_note, vec!["C", "C#", "A", "A#"]);

        // Deserialization with notes="names", names="midi"
        let deserialized: Opts = serde_json::from_value(json!({
            "notes": "names",
            "names": "midi"
        })).unwrap();
        assert_eq!(deserialized.notes, vec![Layer::Names]);
        assert_eq!(deserialized.names, NamesFormat::Midi);

        let tuple_deser: Opts = serde_json::from_value(json!({
            "notes": ["heads", "names"],
            "names": "pitchclass"
        })).unwrap();
        assert_eq!(tuple_deser.notes, vec![Layer::Heads, Layer::Names]);
        assert_eq!(tuple_deser.names, NamesFormat::Pitchclass);
    }
}