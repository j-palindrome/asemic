//! Font file outlines (shared by the brain `text` proc and the draw `ascii` text atlas):
//! harfrust shapes, skrifa draws glyph outlines at a variable-font axis location, lyon_path
//! flattens them into polylines (one per contour, closed contours repeat their start).
//! [`FontFile`] watches its path (notify) so a `vfont` rebuild reloads live.

use std::path::{Path, PathBuf};
use std::sync::mpsc;

use anyhow::{Context, Result};
use harfrust::{Buffer, ShapeOptions, ShaperFont};
use lyon_path::{Path as LPath, PathEvent, iterator::PathIterator, math::point};
use skrifa::{FontRef, MetadataProvider, OutlineGlyphCollection, instance::Size, outline::DrawSettings, raw::TableProvider, raw::model};

/// Font bytes + change watcher on its path.
pub struct FontFile {
    pub path: PathBuf,
    pub data: Vec<u8>,
    changed: mpsc::Receiver<()>,
    _watch: notify::RecommendedWatcher,
}

impl FontFile {
    pub fn open(path: &str) -> Result<Self> {
        use notify::{RecursiveMode, Watcher};
        let path = PathBuf::from(path);
        let data = load(&path)?;
        let (tx, changed) = mpsc::channel();
        let name = path.file_name().map(ToOwned::to_owned);
        let mut w = notify::recommended_watcher(move |ev: notify::Result<notify::Event>| {
            // dir watch survives atomic-replace saves; filter to our file
            if ev.is_ok_and(|e| e.paths.iter().any(|p| p.file_name() == name.as_deref())) {
                let _ = tx.send(());
            }
        })?;
        let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
        w.watch(dir, RecursiveMode::NonRecursive)?;
        Ok(Self { path, data, changed, _watch: w })
    }

    /// Reload if the file changed since last call; true = reloaded.
    pub fn reload(&mut self) -> bool {
        if self.changed.try_iter().count() == 0 {
            return false;
        }
        match load(&self.path) {
            Ok(d) => {
                self.data = d;
                true
            }
            Err(e) => {
                tracing::warn!("font: reload {}: {e:#}", self.path.display());
                false
            }
        }
    }
}

fn load(path: &Path) -> Result<Vec<u8>> {
    let d = std::fs::read(path).with_context(|| format!("font {}", path.display()))?;
    FontRef::new(&d).with_context(|| format!("{} is not a font", path.display()))?;
    Ok(d)
}

/// Axis location: every axis of the font at `get(tag)` (None = default), clamped to its range.
pub fn location(data: &[u8], get: impl Fn(&str) -> Option<f32>) -> Vec<(String, f32)> {
    let Ok(font) = FontRef::new(data) else { return vec![] };
    font.axes().iter().map(|a| {
        let tag = a.tag().to_string();
        let v = get(&tag).unwrap_or(a.default_value());
        (tag, v.clamp(a.min_value(), a.max_value()))
    }).collect()
}

/// Shaped run: polylines (flat x, y), glyph count, advance (font units), units per em,
/// ascent / descent (font units, descent < 0) at the location.
pub struct Shaped {
    pub lines: Vec<Vec<f32>>,
    pub glyphs: usize,
    pub advance: f32,
    pub upem: f32,
    pub ascent: f32,
    pub descent: f32,
}

/// Shape `text` at axis location `vars`; font units -> canvas: baseline start `at`, `scale`
/// per font unit, y down. `tol` = flatten tolerance (canvas units).
pub fn shape(data: &[u8], text: &str, vars: &[(String, f32)], at: [f32; 2], scale: f32, tol: f32) -> Result<Shaped> {
    let font = FontRef::new(data)?;
    let loc = font.axes().location(vars.iter().map(|(t, v)| (t.as_str(), *v)));
    // shaping instance at the same location (gvar/HVAR advances, feature variations)
    let m = model::Font::new(data.to_vec(), 0).context("font model")?;
    let inst = m.instance_builder().variations(vars.iter().map(|(t, v)| (t.as_str(), *v))).build();
    let shaper = ShaperFont::new(&inst);
    let mut buf = Buffer::new();
    buf.push_str(text);
    buf.guess_segment_properties();
    harfrust::shape(&shaper, &mut buf, ShapeOptions::new()).map_err(|e| anyhow::anyhow!("shape: {e}"))?;
    let glyphs: OutlineGlyphCollection = font.outline_glyphs();
    let mut pen = Pen { b: LPath::svg_builder(), at, s: scale };
    let mut pen_x = 0i32;
    for (info, pos) in buf.glyph_infos().iter().zip(buf.glyph_positions()) {
        if let Some(g) = glyphs.get(info.glyph_id.into()) {
            pen.at = [at[0] + (pen_x + pos.x_offset) as f32 * scale, at[1] - pos.y_offset as f32 * scale];
            let _ = g.draw(DrawSettings::unhinted(Size::unscaled(), &loc), &mut pen);
        }
        pen_x += pos.x_advance;
    }
    let met = font.metrics(Size::unscaled(), &loc);
    Ok(Shaped {
        lines: flatten(&pen.b.build(), tol.max(1e-5)),
        glyphs: buf.len(),
        advance: pen_x as f32,
        upem: font.head().map_or(1000, |h| h.units_per_em()) as f32,
        ascent: met.ascent,
        descent: met.descent,
    })
}

/// skrifa pen -> lyon svg builder, font units -> canvas (y down).
struct Pen {
    b: lyon_path::builder::WithSvg<lyon_path::path::BuilderImpl>,
    at: [f32; 2],
    s: f32,
}

impl Pen {
    fn p(&self, x: f32, y: f32) -> lyon_path::math::Point {
        point(self.at[0] + x * self.s, self.at[1] - y * self.s)
    }
}

impl skrifa::outline::OutlinePen for Pen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.b.move_to(self.p(x, y));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.b.line_to(self.p(x, y));
    }
    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        self.b.quadratic_bezier_to(self.p(cx, cy), self.p(x, y));
    }
    fn curve_to(&mut self, c0x: f32, c0y: f32, c1x: f32, c1y: f32, x: f32, y: f32) {
        self.b.cubic_bezier_to(self.p(c0x, c0y), self.p(c1x, c1y), self.p(x, y));
    }
    fn close(&mut self) {
        self.b.close();
    }
}

/// lyon path -> polylines (closed contours repeat their start point).
fn flatten(path: &LPath, tol: f32) -> Vec<Vec<f32>> {
    let mut lines: Vec<Vec<f32>> = vec![];
    for ev in path.iter().flattened(tol) {
        match ev {
            PathEvent::Begin { at } => lines.push(vec![at.x, at.y]),
            PathEvent::Line { to, .. } => lines.last_mut().into_iter().for_each(|l| l.extend([to.x, to.y])),
            PathEvent::End { first, close: true, .. } => lines.last_mut().into_iter().for_each(|l| l.extend([first.x, first.y])),
            _ => {}
        }
    }
    lines.retain(|l| l.len() >= 4);
    lines
}
