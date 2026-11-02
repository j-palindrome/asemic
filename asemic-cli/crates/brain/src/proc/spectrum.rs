//! FFT of the last SN samples of its input (an `asemic/io/*` f32 stream, or a
//! value/noise key sampled each frame). Channels: value (level), low, mid, high, centroid.

use std::sync::Arc;

use asemic_schema::Multi;
use rustfft::{Fft, FftPlanner, num_complex::Complex64};

use crate::node::{Channels, Gen, Params};
use crate::proc::get;

pub const DEFAULTS: &[(&str, f64)] = &[("gain", 1.0)];

const SN: usize = 256;

pub struct Spectrum {
    ring: Vec<f32>,
    pos: usize,
    fft: Arc<dyn Fft<f64>>,
    mags: Vec<f64>,
}

impl Spectrum {
    pub fn new() -> Self {
        Self {
            ring: vec![0.0; SN],
            pos: 0,
            fft: FftPlanner::new().plan_fft_forward(SN),
            mags: vec![0.0; SN / 2],
        }
    }
}

impl Default for Spectrum {
    fn default() -> Self {
        Self::new()
    }
}

impl Gen for Spectrum {
    fn feed(&mut self, samples: &[f32]) {
        for s in samples {
            self.ring[self.pos] = *s;
            self.pos = (self.pos + 1) % SN;
        }
    }

    fn step(&mut self, _dt: f64, p: &Params) -> Channels {
        let mut buf: Vec<Complex64> = (0..SN)
            .map(|i| {
                let w = 0.5 - 0.5 * (std::f64::consts::TAU * i as f64 / SN as f64).cos();
                Complex64::new(self.ring[(self.pos + i) % SN] as f64 * w, 0.0)
            })
            .collect();
        self.fft.process(&mut buf);
        for (m, c) in self.mags.iter_mut().zip(&buf) {
            *m = c.norm() / SN as f64 * 4.0;
        }
        let g = get(p, "gain", 1.0);
        let band = |a: usize, b: usize| {
            ((self.mags[a..b].iter().sum::<f64>() / (b - a) as f64) * g * 8.0).tanh() * 2.0 - 1.0
        };
        let tot: f64 = self.mags[1..].iter().sum();
        let cen = if tot > 1e-9 {
            self.mags
                .iter()
                .enumerate()
                .skip(1)
                .map(|(i, m)| i as f64 * m)
                .sum::<f64>()
                / tot
                / (SN / 2) as f64
        } else {
            0.0
        };
        let mut ch = Channels::new();
        ch.insert("value", band(1, SN / 2));
        ch.insert("low", band(1, 8));
        ch.insert("mid", band(8, 32));
        ch.insert("high", band(32, SN / 2));
        ch.insert("centroid", cen * 2.0 - 1.0);
        ch
    }

    fn points(&self) -> Option<Multi> {
        let n = self.mags.len();
        Some(Multi::from_xy([(0..n).map(|i| {
            [
                i as f32 / (n - 1) as f32,
                0.95 - 0.9 * (self.mags[i] * 8.0).tanh() as f32,
            ]
        })]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spectrum_finds_tone_band() {
        let p: Params = DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        let mut g = Spectrum::new();
        let tone: Vec<f32> = (0..SN)
            .map(|i| (std::f32::consts::TAU * 64.0 * i as f32 / SN as f32).sin())
            .collect();
        g.feed(&tone);
        let ch = g.step(0.0, &p);
        assert!(ch["high"] > ch["low"] && ch["centroid"] > 0.0, "{ch:?}");
    }
}
