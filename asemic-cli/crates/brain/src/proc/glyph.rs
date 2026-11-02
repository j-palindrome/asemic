//! asemic-repl `Font::to_paths` → `Paths::points` (OpenSimplex wobble) → `Paths::scan`.
//! Channels: value = scan mean y, x/y = first scanned point (-1..1). Points = the paths.

use asemic_schema::Multi;

use crate::node::{Channels, Gen, Params};
use crate::proc::get;

pub const DEFAULTS: &[(&str, f64)] = &[
    ("x", 0.5),
    ("y", 0.5),
    ("size", 0.08),
    ("rotate", 0.0),
    ("spacing", 0.15),
    ("wobble", 0.0),
    ("speed", 1.0),
    ("scan", 0.0),
];

pub struct Glyph {
    font: asemic_font::Font,
    text: String,
    paths: asemic_font::Paths,
    noise: noise::OpenSimplex,
    t: f64,
}

impl Glyph {
    pub fn new(text: &str, seed: u32) -> Self {
        Self {
            font: asemic_font::Font::new(),
            text: text.into(),
            paths: asemic_font::Paths::new(),
            noise: noise::OpenSimplex::new(seed),
            t: 0.0,
        }
    }
}

impl Gen for Glyph {
    fn step(&mut self, dt: f64, p: &Params) -> Channels {
        use asemic_font::glam::{Affine2, vec2};
        use noise::NoiseFn;
        self.t += dt * get(p, "speed", 1.0);
        let s = get(p, "size", 0.08) as f32;
        // font units: x 1/char, y up 0..2 → screen 0..1, y down, centred on (x, y)
        let xf = Affine2::from_scale_angle_translation(
            vec2(s, -s),
            get(p, "rotate", 0.0) as f32,
            vec2(get(p, "x", 0.5) as f32, get(p, "y", 0.5) as f32 + s),
        );
        self.paths = self.font.to_paths(
            &self.text,
            asemic_font::TextOptions {
                transform: xf,
                width: 1.0,
                align: Some(asemic_font::Align::Center),
                char_spacing: Some(get(p, "spacing", 0.15) as f32),
            },
        );
        let (amp, t, n) = (get(p, "wobble", 0.0) * s as f64, self.t, &self.noise);
        if amp > 0.0 {
            self.paths.points(|pt, _, _, i| {
                let k = i.line as f64 * 7.1 + i.point as f64 * 1.3;
                pt.x += (n.get([k, t]) * amp) as f32;
                pt.y += (n.get([k + 100.0, t]) * amp) as f32;
            });
        }
        let scan = self.paths.scan(get(p, "scan", 0.0).clamp(0.0, 1.0) as f32);
        let mut ch = Channels::new();
        let first = scan.first().copied().unwrap_or_default();
        ch.insert("x", first.x as f64 * 2.0 - 1.0);
        ch.insert("y", first.y as f64 * 2.0 - 1.0);
        let mean = scan.iter().map(|v| v.y as f64).sum::<f64>() / scan.len().max(1) as f64;
        ch.insert("value", mean * 2.0 - 1.0);
        ch
    }

    fn points(&self) -> Option<Multi> {
        Some(Multi::from_xy(
            self.paths.paths.iter().map(|l| l.iter().map(|v| [v.x, v.y])),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glyph_draws_text_from_asemic_repl_font() {
        let mut p: Params = DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        let mut g = Glyph::new("AB", 1);
        g.step(1.0 / 60.0, &p);
        let lines = g.points().unwrap();
        assert!(
            lines.lines.len() >= 4,
            "A = 3 strokes + B: {}",
            lines.lines.len()
        );
        assert!(lines
            .xy()
            .flatten()
            .all(|[x, y]: [f32; 2]| (0.0..=1.0).contains(&x) && (0.0..=1.0).contains(&y)));
        let still = lines.clone();
        p.insert("wobble".into(), 0.5);
        g.step(0.5, &p);
        assert_ne!(g.points().unwrap(), still, "wobble moves points");
    }
}
