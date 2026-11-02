//! Stationary 1D Schrödinger, integrated with `schroidnger_equation` (Numerov shooting,
//! QHO potential ½kx²) across x ∈ [-span, span]. Sweeping `energy` through eigenvalues
//! flips the tail sign. Channels: value = tail (tanh), x = ψ(0) normalized.

use asemic_schema::Multi;

use crate::node::{Channels, Gen, Params};
use crate::proc::get;

pub const DEFAULTS: &[(&str, f64)] = &[
    ("energy", 0.5),
    ("k", 1.0),
    ("mass", 1.0),
    ("span", 5.0),
];

const WN: usize = 256;

pub struct Wave {
    psi: Vec<f64>,
}

impl Wave {
    pub fn new() -> Self {
        Self { psi: vec![0.0; WN] }
    }
}

impl Default for Wave {
    fn default() -> Self {
        Self::new()
    }
}

impl Gen for Wave {
    fn step(&mut self, _dt: f64, p: &Params) -> Channels {
        let span = get(p, "span", 5.0).max(0.5);
        let dx = 2.0 * span / WN as f64;
        let mut wf = schroidnger_equation::WaveFunction::new(
            0.0,
            1e-3,
            get(p, "energy", 0.5),
            0.0,
            -span,
            dx,
            get(p, "mass", 1.0),
            get(p, "k", 1.0),
        );
        for v in self.psi.iter_mut() {
            wf.potential = wf.potential_energy();
            wf.update();
            *v = wf.psi;
        }
        let peak = self.psi.iter().fold(1e-12f64, |m, v| m.max(v.abs()));
        let mut ch = Channels::new();
        ch.insert("value", (self.psi[WN - 1] / peak).tanh());
        ch.insert("x", self.psi[WN / 2] / peak);
        ch.insert("y", (self.psi[WN - 1] / peak).clamp(-1.0, 1.0));
        ch
    }

    fn points(&self) -> Option<Multi> {
        let peak = self.psi.iter().fold(1e-12f64, |m, v| m.max(v.abs()));
        Some(Multi::from_xy([(0..WN).map(|i| {
            [
                i as f32 / (WN - 1) as f32,
                0.5 - 0.45 * (self.psi[i] / peak) as f32,
            ]
        })]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wave_uses_crate_and_tail_flips_across_eigenvalue() {
        let mut p: Params = DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        let mut g = Wave::new();
        p.insert("energy".into(), 0.3);
        let below = g.step(0.0, &p)["value"];
        p.insert("energy".into(), 0.7);
        let above = g.step(0.0, &p)["value"];
        assert!(below.signum() != above.signum(), "{below} {above}");
    }
}
