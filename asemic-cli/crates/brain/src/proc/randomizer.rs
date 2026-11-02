//! Randomizer nodes: fresh iid jitter per cook (not an integrating walk like `noise::RandomWalk`).
//! Raw `value` output only -- additive/multiplicative combine lives on `Route.combine`, not here.

use asemic_schema::{Multi, ProcKind};
use crate::node::{Channels, Gen, Params};

fn get(p: &Params, k: &str, d: f64) -> f64 {
    p.get(k).copied().filter(|v| v.is_finite()).unwrap_or(d)
}

pub fn make(kind: ProcKind, seed: u32) -> Box<dyn Gen> {
    Box::new(Jitter { kind, rng: 0x9E37_79B9_7F4A_7C15 ^ seed as u64, last: 0.0 })
}

/// Defaults per gen, so the REPL can draw sliders for gen params.
pub fn defaults(kind: ProcKind) -> Params {
    let kv: &[(&str, f64)] = match kind {
        ProcKind::White => &[("scale", 1.0)],
        ProcKind::Gauss => &[("sigma", 0.3)],
        _ => &[],
    };
    kv.iter().map(|(k, v)| (k.to_string(), *v)).collect()
}

struct Jitter {
    kind: ProcKind,
    rng: u64,
    last: f64,
}

impl Jitter {
    /// xorshift64* → uniform -1..1 (deterministic per seed).
    fn uniform(&mut self) -> f64 {
        self.rng ^= self.rng >> 12;
        self.rng ^= self.rng << 25;
        self.rng ^= self.rng >> 27;
        let r = self.rng.wrapping_mul(0x2545_F491_4F6C_DD1D);
        (r >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
    }

    /// Box-Muller: 2 uniforms -> 1 standard-normal sample.
    fn gauss(&mut self) -> f64 {
        let u1 = (self.uniform() + 1.0) / 2.0;
        let u2 = (self.uniform() + 1.0) / 2.0;
        let u1 = u1.max(f64::MIN_POSITIVE);
        (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
    }
}

impl Gen for Jitter {
    fn step(&mut self, _dt: f64, p: &Params) -> Channels {
        let v = match self.kind {
            ProcKind::White => self.uniform() * get(p, "scale", 1.0),
            ProcKind::Gauss => self.gauss() * get(p, "sigma", 0.3),
            _ => 0.0,
        };
        self.last = v;
        Channels::from([("value", v)])
    }

    fn points(&self) -> Option<Multi> {
        Some(Multi::from_scalar("value", self.last as f32))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_per_seed() {
        for k in [ProcKind::White, ProcKind::Gauss] {
            let run = |seed| {
                let mut g = make(k, seed);
                let p = defaults(k);
                (0..200).map(|_| g.step(1.0 / 60.0, &p)["value"]).collect::<Vec<_>>()
            };
            assert_eq!(run(7), run(7), "{k:?}");
            assert_ne!(run(1), run(2), "{k:?}");
        }
    }

    #[test]
    fn iid_not_integrating() {
        // a walk accumulates (later samples drift from the first); jitter should not.
        let mut g = make(ProcKind::White, 3);
        let p = defaults(ProcKind::White);
        let samples: Vec<f64> = (0..500).map(|_| g.step(1.0 / 60.0, &p)["value"]).collect();
        let mean = samples.iter().sum::<f64>() / samples.len() as f64;
        assert!(mean.abs() < 0.2, "mean {mean} should hover near 0, not drift");
    }
}
