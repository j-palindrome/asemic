//! `variations` proc: 12-tone variations (transpositions, inversions, retrogrades)
//! of an input motif (points/multiarray or seeded default) modulated by smooth noise.
//! Produces multiarray lines x points x dims (x, y, pitch, dur, vel).

use asemic_schema::Multi;

use crate::node::{Channels, Gen, Params};
use crate::proc::get;

pub const DEFAULTS: &[(&str, f64)] = &[
    ("voices", 4.0),
    ("base", 72.0),
    ("spread", 12.0),
    ("noise_speed", 0.35),
    ("rest_min", 0.2),
    ("rest_max", 1.8),
    ("duration", 32.0),
];

pub struct Variations {
    seed: u32,
    input: Option<Multi>,
    key: Vec<f64>,
    noise_table: [f64; 256],
    out: Multi,
}

impl Variations {
    pub fn new(seed: u32) -> Self {
        let mut rng = seed as u64 * 2654435761 + 1;
        let mut rand = move || -> f64 {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            (rng as f64) / (u64::MAX as f64) * 2.0 - 1.0
        };
        let mut noise_table = [0.0; 256];
        for val in &mut noise_table {
            *val = rand();
        }
        Self {
            seed,
            input: None,
            key: vec![],
            noise_table,
            out: Multi::new(&["pitch", "dur", "vel"]),
        }
    }

    fn smooth_noise(&self, x: f64) -> f64 {
        let xi = x.floor() as i64;
        let xf = x - x.floor();
        let u = xf * xf * xf * (xf * (xf * 6.0 - 15.0) + 10.0);
        let g0 = self.noise_table[(xi.rem_euclid(256)) as usize];
        let g1 = self.noise_table[((xi + 1).rem_euclid(256)) as usize];
        g0 + u * (g1 - g0)
    }

    fn extract_motif(&self) -> Vec<(f64, f64)> {
        // Extract (pitch_offset, dur) from input multiarray if available
        if let Some(ref m) = self.input {
            let p_idx = m.attrs.iter().position(|a| a == "pitch");
            let d_idx = m.attrs.iter().position(|a| a == "dur");
            let stride = m.stride().max(1);
            let mut motif = Vec::new();
            if let Some(first_line) = m.lines.first() {
                for chunk in first_line.chunks(stride) {
                    let pitch = p_idx.and_then(|i| chunk.get(i).copied()).unwrap_or(60.0) as f64;
                    let dur = d_idx.and_then(|i| chunk.get(i).copied()).unwrap_or(0.25) as f64;
                    if dur > 0.0 && pitch >= 0.0 {
                        motif.push((pitch, dur));
                    }
                }
            }
            if !motif.is_empty() {
                return motif;
            }
        }
        // Default birdcall motif
        vec![
            (0.0, 0.08), (7.0, 0.06), (12.0, 0.05), (11.0, 0.07),
            (14.0, 0.04), (8.0, 0.09), (3.0, 0.12), (1.0, 0.15),
        ]
    }

    fn build(&mut self, voices: usize, base: f64, spread: f64, noise_speed: f64, rest_min: f64, rest_max: f64, duration: f64) {
        let motif = self.extract_motif();
        let m_first_pitch = motif[0].0;
        let m_intervals: Vec<f64> = motif.iter().map(|&(p, _)| p - m_first_pitch).collect();
        let m_durs: Vec<f64> = motif.iter().map(|&(_, d)| d).collect();

        let mut rng = self.seed as u64 * 1000000007 + 13;
        let mut rand_unit = move || -> f64 {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            (rng as f64) / (u64::MAX as f64)
        };

        let mut lines = Vec::with_capacity(voices);
        for v in 0..voices {
            let v_center = base + (v as f64 - (voices as f64 - 1.0) / 2.0) * spread;
            let mut t = if voices > 1 {
                rand_unit() * rest_max * 0.75 * (v as f64 / (voices as f64 - 1.0))
            } else {
                0.0
            };
            let mut line = Vec::new();

            while t < duration {
                let nv = self.smooth_noise((t + v as f64 * 17.3) * noise_speed);
                let transposition = (nv * 12.0).round();
                let invert = self.smooth_noise((t + v as f64 * 31.7 + 100.0) * noise_speed) > 0.0;
                let retrograde = self.smooth_noise((t * 0.5 + v as f64 * 53.1) * noise_speed) > 0.4;

                let mut curr_intervals = m_intervals.clone();
                let mut curr_durs = m_durs.clone();

                if invert {
                    for iv in &mut curr_intervals {
                        *iv = -*iv;
                    }
                }
                if retrograde {
                    curr_intervals.reverse();
                    curr_durs.reverse();
                }

                let dur_scale = (self.smooth_noise(t * noise_speed * 1.5) * 0.35).exp();

                for (&iv, &dur) in curr_intervals.iter().zip(curr_durs.iter()) {
                    let note_dur = (dur * dur_scale).max(0.02);
                    if t + note_dur > duration {
                        break;
                    }
                    let pitch = v_center + transposition + iv;
                    let y_val = 1.0 - (pitch - 36.0) / 72.0;
                    line.extend([t as f32, y_val as f32, pitch as f32, note_dur as f32, 0.7f32]);
                    t += note_dur;
                }

                if t >= duration {
                    break;
                }

                let rest_noise_factor = 0.5 * (1.0 + self.smooth_noise((t + v as f64 * 7.7) * noise_speed * 0.5));
                let rest_dur = rest_min + (rest_max - rest_min) * rest_noise_factor * (0.7 + 0.6 * rand_unit());
                t += rest_dur;
            }

            lines.push(line);
        }

        self.out = Multi::new(&["pitch", "dur", "vel"]);
        self.out.lines = lines;
    }
}

impl Gen for Variations {
    fn step(&mut self, _dt: f64, p: &Params) -> Channels {
        let key: Vec<f64> = DEFAULTS.iter().map(|(k, d)| get(p, k, *d)).collect();
        if key != self.key {
            let voices = key[0].clamp(1.0, 32.0) as usize;
            let base = key[1];
            let spread = key[2];
            let noise_speed = key[3].max(0.001);
            let rest_min = key[4].max(0.0);
            let rest_max = key[5].max(rest_min);
            let duration = key[6].clamp(1.0, 1024.0);
            self.build(voices, base, spread, noise_speed, rest_min, rest_max, duration);
            self.key = key;
        }
        let mut ch = Channels::new();
        ch.insert("notes", self.out.lines.iter().map(|l| l.len() / 5).sum::<usize>() as f64);
        ch
    }

    fn feed_points(&mut self, m: &Multi) {
        self.input = Some(m.clone());
        self.key.clear(); // trigger rebuild on next step
    }

    fn points(&self) -> Option<Multi> {
        Some(self.out.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variations_generates_voices_with_points() {
        let mut v = Variations::new(42);
        v.step(0.0, &Params::new());
        let pts = v.points().unwrap();
        assert_eq!(pts.lines.len(), 4);
        assert_eq!(pts.attrs, ["x", "y", "pitch", "dur", "vel"]);
    }
}
