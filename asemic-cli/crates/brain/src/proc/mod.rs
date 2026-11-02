//! Intra-brain processors (plan §8.1.2, §8.1.5, 11.7): physics (rapier2d), quantum (1D
//! Schrödinger via `schroidnger_equation`), harmonics (FFT spectrum of an input stream),
//! glyph (asemic-repl font/paths via `asemic-font`), lsys, text, melody, variations, py.
//! Each is a `Gen`, so anim/routes follow its channels like any noisegen; each also
//! draws a point buffer → `asemic/gen/<id>` (terminal view / draw).

pub mod glyph;
pub mod lsys;
pub mod melody;
pub mod noise;
pub mod physics;
pub mod py;
pub mod randomizer;
pub mod spectrum;
pub mod text;
pub mod variations;
pub mod wave;

pub use glyph::Glyph;
pub use lsys::Lsys;
pub use melody::Melody;
pub use physics::Physics;
pub use py::Py;
pub use spectrum::Spectrum;
pub use text::Text;
pub use variations::Variations;
pub use wave::Wave;

use anyhow::Context;
use asemic_schema::ProcKind;

use crate::node::{Gen, Params};

pub(crate) fn get(p: &Params, k: &str, d: f64) -> f64 {
    p.get(k).copied().filter(|v| v.is_finite()).unwrap_or(d)
}

/// Proc component fields a processor is built from.
#[derive(Default, Clone, Copy)]
pub struct Spec<'a> {
    pub seed: u32,
    pub text: Option<&'a str>,
    pub axiom: Option<&'a str>,
    pub rules: &'a [String],
    pub path: Option<&'a str>,
}

pub fn make(kind: ProcKind, spec: Spec) -> anyhow::Result<Box<dyn Gen>> {
    let Spec { seed, text, .. } = spec;
    Ok(match kind {
        ProcKind::Physics => Box::new(Physics::new(seed)),
        ProcKind::Wave => Box::new(Wave::new()),
        ProcKind::Spectrum => Box::new(Spectrum::new()),
        ProcKind::Glyph => Box::new(Glyph::new(text.unwrap_or(""), seed)),
        ProcKind::Lsys => Box::new(Lsys::new(spec.axiom.unwrap_or("F"), spec.rules, seed, text)?),
        ProcKind::Text => Box::new(Text::new(spec.path.context("text: path= font file required")?, text.unwrap_or(""))?),
        ProcKind::Melody => Box::new(Melody::new(seed)),
        ProcKind::Variations => Box::new(Variations::new(seed)),
        ProcKind::Py => Box::new(Py::new(seed)),
        ProcKind::Chaos | ProcKind::Perlin | ProcKind::Simplex | ProcKind::Lfo | ProcKind::RandomWalk => {
            noise::make(kind, seed)
        }
        ProcKind::White | ProcKind::Gauss => {
            randomizer::make(kind, seed)
        }
    })
}

pub fn defaults(kind: ProcKind) -> Params {
    match kind {
        ProcKind::Physics => physics::DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        ProcKind::Wave => wave::DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        ProcKind::Spectrum => spectrum::DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        ProcKind::Glyph => glyph::DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        ProcKind::Lsys => lsys::DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        ProcKind::Text => text::DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        ProcKind::Melody => melody::DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        ProcKind::Variations => variations::DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        ProcKind::Py => Params::new(),
        ProcKind::Chaos | ProcKind::Perlin | ProcKind::Simplex | ProcKind::Lfo | ProcKind::RandomWalk => {
            noise::defaults(kind)
        }
        ProcKind::White | ProcKind::Gauss => {
            randomizer::defaults(kind)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Custom attr declared on a glyph survives glyph -> lsys -> GPU compute -> draw; a brush
    /// modifier reading it (`attr(info, DIM_hue)`) changes pixels.
    #[test]
    fn custom_attr_flows_glyph_lsys_compute_draw() {
        use asemic_draw::graph::{Graph, NodeSpec};
        use asemic_draw::host::Look;
        use std::collections::BTreeMap;
        let (device, queue) = asemic_draw::device().unwrap();
        let lit = |hue: f32| {
            let mut glyph = make(ProcKind::Glyph, Spec { text: Some("AB"), seed: 1, ..Default::default() }).unwrap();
            glyph.step(0.0, &defaults(ProcKind::Glyph));
            let mut m = glyph.points().unwrap();
            m.with_attr("hue", 0.0); // what the engine does for attrs={"hue": 0.0} + route attr.hue
            m.offset("hue", hue);
            let rules = ["F -> F[+F]F".to_string()];
            let mut l = make(ProcKind::Lsys, Spec { axiom: Some("F"), rules: &rules, seed: 1, ..Default::default() }).unwrap();
            l.feed_points(&m);
            let mut p = defaults(ProcKind::Lsys);
            p.insert("n".into(), 2.0);
            p.insert("stride".into(), 8.0);
            l.step(0.0, &p);
            let tree = l.points().unwrap();
            assert!(tree.attr("hue").is_some() && tree.attr("depth").is_some(), "{:?}", tree.attrs);
            let gens = BTreeMap::from([("plant".to_string(), tree)]);
            let mut g = Graph::default();
            g.timestretch("main", 1.0); // nodes freeze at ts 0.0; this test needs frames to render
            let pass = "fn point(i: u32) -> Point { return src_point(min(i, src_count() - 1u)); }";
            let n = 4096;
            g.open_with(&device, &queue, "pts", NodeSpec { kind: "compute".into(), w: 64, h: 64, src: vec!["plant".into()], wesl: pass.into(), count: n, ..Default::default() }, &gens).unwrap();
            let look = Look { brush: "dot".into(), brightness: Some("return attr(info, DIM_hue);".into()), ..Default::default() };
            g.open_with(&device, &queue, "draw", NodeSpec { kind: "draw".into(), w: 64, h: 64, points: Some("pts".into()), count: n, look, ..Default::default() }, &gens).unwrap();
            assert!(g.info("pts").unwrap().dims.contains(&"hue".to_string()));
            g.render(&device, &queue, &gens, 0.0);
            g.render(&device, &queue, &gens, 0.0);
            asemic_draw::host::readback(&device, &queue, g.tex("draw").unwrap()).as_chunks::<4>().0.iter().filter(|p| p[0] > 32 || p[1] > 32 || p[2] > 32).count()
        };
        let (off, on) = (lit(0.0), lit(1.0));
        assert!(off == 0 && on > 32, "hue 0 -> dark, routed hue 1 -> lit: {off} vs {on}");
    }
}
