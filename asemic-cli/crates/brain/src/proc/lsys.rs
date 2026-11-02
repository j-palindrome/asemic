//! General L-system processor: `symbios` (ABOP grammar: stochastic `0.5: F -> F[+F]`,
//! branching `[]`, seeded Pcg64) derives the string; `symbios-turtle-3d` interprets it into a
//! skeleton of strands (one per branch) whose XY plane maps to the screen.
//!
//! Without `input`: one tree rooted at (x, y), heading up. With `input` (a gen multiarray):
//! every `stride`-th point roots its own tree, heading along its line tangent, seed = seed +
//! point index, size × the point's `scale_by` attr (`text`). Output attrs: width (turtle
//! radius), depth (branch nesting), root (rooting point / tree index), so branches stay
//! attributes of their source line.

use std::collections::HashMap;

use anyhow::{Context, Result, anyhow};
use asemic_font::glam::{Affine2, Vec2, vec2};
use asemic_schema::Multi;
use symbios::System;
use symbios_turtle_3d::{Skeleton, TurtleConfig, TurtleInterpreter};

use crate::node::{Channels, Gen, Params};
use crate::proc::get;

pub const DEFAULTS: &[(&str, f64)] = &[
    ("n", 4.0), ("angle", 25.0), ("step", 0.02), ("growth", 1.0), ("width", 1.0),
    ("x", 0.5), ("y", 0.95), ("turn", 0.0), ("stride", 1.0), ("scale", 1.0),
];
/// Derivations cached per (seed, n, angle); bounded so swept params can't grow it forever.
const CACHE: usize = 512;
const MAX_N: f64 = 8.0;

type Key = (u32, u32, u32);

pub struct Lsys {
    axiom: String,
    rules: Vec<String>,
    seed: u32,
    scale_by: Option<String>,
    input: Option<Multi>,
    cache: HashMap<Key, Skeleton>,
    out: Multi,
}

impl Lsys {
    pub fn new(axiom: &str, rules: &[String], seed: u32, scale_by: Option<&str>) -> Result<Self> {
        let mut me = Self {
            axiom: axiom.into(), rules: rules.to_vec(), seed, scale_by: scale_by.filter(|s| !s.is_empty()).map(String::from),
            input: None, cache: HashMap::new(), out: Multi::new(&["width", "depth", "root"]),
        };
        me.skeleton(seed, 1, 25.0)?; // validate grammar up front
        Ok(me)
    }

    fn skeleton(&mut self, seed: u32, n: u32, angle: f32) -> Result<&Skeleton> {
        let key = (seed, n, angle.to_bits());
        if !self.cache.contains_key(&key) {
            if self.cache.len() >= CACHE {
                self.cache.clear();
            }
            let mut sys = System::new();
            for r in &self.rules {
                sys.add_rule(r).map_err(|e| anyhow!("lsys rule {r:?}: {e:?}"))?;
            }
            sys.set_axiom(&self.axiom).map_err(|e| anyhow!("lsys axiom {:?}: {e:?}", self.axiom))?;
            sys.set_seed(seed as u64);
            sys.derive(n as usize).map_err(|e| anyhow!("lsys derive: {e:?}"))?;
            let turtle = TurtleInterpreter::new(TurtleConfig { default_step: 1.0, default_angle: angle.to_radians(), initial_width: 1.0, ..Default::default() })
                .with_standard_symbols(&mut sys.interner);
            self.cache.insert(key, turtle.build_skeleton(&sys.state));
        }
        self.cache.get(&key).context("lsys cache")
    }

    /// Output layout: input dims (inherited, never reinterpreted) + width/depth/root appended.
    fn layout(&self) -> Multi {
        let mut m = Multi { attrs: self.input.as_ref().map_or_else(|| Multi::new(&[]).attrs, |i| i.attrs.clone()), lines: vec![] };
        for a in ["x", "y", "width", "depth", "root"] {
            m.with_attr(a, 0.0);
        }
        m
    }

    /// Roots: (position, heading, size, root index, root point dims) in screen space.
    fn roots(&self, p: &Params) -> Vec<(Vec2, Vec2, f32, usize, Vec<f32>)> {
        let step = get(p, "step", 0.02) as f32;
        let turn = (get(p, "turn", 0.0) as f32).to_radians();
        let Some(m) = &self.input else {
            return vec![(vec2(get(p, "x", 0.5) as f32, get(p, "y", 0.95) as f32), Vec2::from_angle(turn).rotate(vec2(0.0, -1.0)), step, 0, vec![])];
        };
        let stride = get(p, "stride", 1.0).max(1.0) as usize;
        let scale = get(p, "scale", 1.0) as f32;
        let by = self.scale_by.as_deref().and_then(|a| m.attr(a));
        let (Some(kx), Some(ky)) = (m.attr("x"), m.attr("y")) else { return vec![] };
        let mut out = vec![];
        let mut idx = 0;
        for i in 0..m.lines.len() {
            let pts: Vec<&[f32]> = m.points(i).collect();
            for (j, q) in pts.iter().enumerate() {
                if idx % stride == 0 {
                    let at = |k: usize| vec2(pts[k][kx], pts[k][ky]);
                    let (a, b) = (at(j.saturating_sub(1)), at((j + 1).min(pts.len() - 1)));
                    let tangent = (b - a).try_normalize().unwrap_or(vec2(0.0, -1.0));
                    let s = step * scale * by.map_or(1.0, |a| q[a]);
                    out.push((at(j), Vec2::from_angle(turn).rotate(tangent), s, idx, q.to_vec()));
                }
                idx += 1;
            }
        }
        out
    }
}

impl Gen for Lsys {
    fn step(&mut self, _dt: f64, p: &Params) -> Channels {
        let n = get(p, "n", 4.0).clamp(0.0, MAX_N).round() as u32;
        let angle = get(p, "angle", 25.0) as f32;
        let growth = get(p, "growth", 1.0).clamp(0.0, 1.0);
        let width = get(p, "width", 1.0) as f32;
        let mut out = self.layout();
        let d = out.stride();
        let [kx, ky, kw, kd, kr] = ["x", "y", "width", "depth", "root"].map(|a| out.attr(a).unwrap());
        let mut ch = Channels::new();
        for (root, heading, size, idx, dims) in self.roots(p) {
            let Ok(sk) = self.skeleton(self.seed.wrapping_add(idx as u32), n, angle) else { continue };
            // turtle local: +Y forward, +X right → screen via heading/perp scaled by size
            let xf = Affine2::from_cols(heading.perp() * -size, heading * size, root);
            let total: usize = sk.strands.iter().map(Vec::len).sum();
            let mut budget = (total as f64 * growth).round() as usize;
            for (s, strand) in sk.strands.iter().enumerate() {
                if budget < 2 {
                    break;
                }
                let depth = std::iter::successors(sk.strand_parents[s], |&q| sk.strand_parents[q]).count() as f32;
                let take = strand.len().min(budget);
                budget -= take;
                let mut base = vec![0.0; d];
                base[..dims.len()].copy_from_slice(&dims);
                out.lines.push(strand[..take].iter().flat_map(|pt| {
                    let v = xf.transform_point2(pt.position.truncate());
                    let mut q = base.clone();
                    // width: inherited width scales the turtle radius
                    let w = if kw < dims.len() { dims[kw] } else { 1.0 };
                    (q[kx], q[ky], q[kw], q[kd], q[kr]) = (v.x, v.y, pt.radius * width * w, depth, idx as f32);
                    q
                }).collect());
            }
        }
        ch.insert("trees", (out.column("root").map_or(0, |c| c.into_iter().flatten().map(|r| r as i64).collect::<std::collections::BTreeSet<_>>().len()) as f64 / 64.0).tanh());
        self.out = out;
        ch
    }

    fn feed_points(&mut self, m: &Multi) {
        self.input = Some(m.clone());
    }

    fn points(&self) -> Option<Multi> {
        Some(self.out.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plant(seed: u32) -> Lsys {
        let rules = ["0.5: F -> F[+F]F[-F]F".to_string(), "0.5: F -> F[+F]F".to_string()];
        Lsys::new("F", &rules, seed, None).unwrap()
    }

    fn run(l: &mut Lsys) -> Multi {
        let p: Params = DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        l.step(0.0, &p);
        l.points().unwrap()
    }

    #[test]
    fn fixed_seed_is_stable_and_branches() {
        let a = run(&mut plant(7));
        assert_eq!(a, run(&mut plant(7)));
        assert!(a.lines.len() > 1, "branching [] gives several strands");
        assert!(a.column("depth").unwrap().iter().flatten().any(|d| *d > 0.0));
        // stochastic rules: some seed differs
        assert!((0..8).any(|s| run(&mut plant(s)) != a));
    }

    #[test]
    fn two_input_points_root_two_trees() {
        let tree = |seed| {
            let mut l = plant(seed);
            l.feed_points(&Multi::from_xy([[[0.2f32, 0.5], [0.8, 0.5]]]));
            run(&mut l)
        };
        let a = tree(3);
        let roots: std::collections::BTreeSet<i64> = a.column("root").unwrap().into_iter().flatten().map(|r| r as i64).collect();
        assert_eq!(roots, [0, 1].into());
        assert_eq!(a, tree(3));
        // each tree starts at its rooting point
        let starts: Vec<[f32; 2]> = a.xy().filter_map(|mut l| l.next()).collect();
        assert!(starts.iter().any(|s| (s[0] - 0.2).abs() < 1e-4) && starts.iter().any(|s| (s[0] - 0.8).abs() < 1e-4));
    }

    #[test]
    fn inherits_root_dims_and_appends() {
        let mut m = Multi::from_xy([[[0.2f32, 0.5], [0.8, 0.5]]]);
        m.with_attr("hue", 0.25);
        let mut l = plant(3);
        l.feed_points(&m);
        let a = run(&mut l);
        assert_eq!(a.attrs, ["x", "y", "hue", "width", "depth", "root"]);
        assert!(a.column("hue").unwrap().iter().flatten().all(|h| *h == 0.25));
    }
}
