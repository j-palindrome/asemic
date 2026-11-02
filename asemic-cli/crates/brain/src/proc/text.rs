//! `text` proc: `text` shaped in font `path` at the location given by axis-tag params (`wght`,
//! `wdth`, ... — routable like any param) via `asemic_font::outline` (harfrust + skrifa +
//! lyon_path) into the point multiarray (one line per contour). `path` is watched and reloaded
//! on change, so a `vfont` rebuild shows up live.

use asemic_font::outline::{FontFile, location, shape};
use asemic_schema::Multi;

use crate::node::{Channels, Gen, Params};
use crate::proc::get;

/// x, y = baseline start (0..1, y down); size = em height in canvas units; tol = flatten tolerance.
pub const DEFAULTS: &[(&str, f64)] = &[("x", 0.1), ("y", 0.6), ("size", 0.2), ("tol", 0.001)];

pub struct Text {
    font: FontFile,
    text: String,
    out: Multi,
}

impl Text {
    pub fn new(path: &str, text: &str) -> anyhow::Result<Self> {
        Ok(Self { font: FontFile::open(path).map_err(|e| e.context("text"))?, text: text.into(), out: Multi::default() })
    }
}

impl Gen for Text {
    fn step(&mut self, _dt: f64, p: &Params) -> Channels {
        self.font.reload();
        let mut ch = Channels::new();
        let vars = location(&self.font.data, |tag| p.get(tag).map(|v| *v as f32));
        let probe = match shape(&self.font.data, "", &vars, [0.0; 2], 1.0, 1.0) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!("text: {e:#}");
                return ch;
            }
        };
        let s = get(p, "size", 0.2) as f32 / probe.upem;
        let at = [get(p, "x", 0.1) as f32, get(p, "y", 0.6) as f32];
        match shape(&self.font.data, &self.text, &vars, at, s, get(p, "tol", 0.001) as f32) {
            Ok(r) => {
                self.out = Multi { attrs: vec!["x".into(), "y".into()], lines: r.lines };
                ch.insert("glyphs", (r.glyphs as f64 / 64.0).tanh());
                ch.insert("advance", (r.advance * s) as f64);
            }
            Err(e) => tracing::warn!("text: {e:#}"),
        }
        ch
    }

    fn points(&self) -> Option<Multi> {
        Some(self.out.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn sys_font() -> Option<&'static str> {
        ["/System/Library/Fonts/SFNS.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].into_iter().find(|p| std::path::Path::new(p).exists())
    }

    #[test]
    fn shapes_flattens_and_wght_axis_moves_outline() {
        let Some(f) = sys_font() else { return };
        let mut t = Text::new(f, "Ho").unwrap();
        let p: Params = DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        let ch = t.step(0.0, &p);
        let m = t.points().unwrap();
        assert!(m.lines.len() >= 2, "H + o contours");
        assert!(ch["advance"] > 0.05);
        let has_wght = location(&t.font.data, |_| None).iter().any(|(t, _)| t == "wght");
        if has_wght {
            let mut heavy = p.clone();
            heavy.insert("wght".into(), 900.0);
            t.step(0.0, &heavy);
            assert_ne!(t.points().unwrap(), m, "axis param changes outline");
        }
    }
}
