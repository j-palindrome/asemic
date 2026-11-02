//! `melody` proc: seeded scale-degree random walk, one line per voice, one point per note, dims
//! x y pitch dur (pitch = MIDI, dur = beats; x = onset / beats, y = pitch height) -- the note
//! multiarray the `affinity` view lays out as a score. Rebuilt only when a param changes.

use asemic_schema::Multi;

use crate::node::{Channels, Gen, Params};
use crate::proc::get;

/// voices from `base` (MIDI) down an octave each; `beats` long; `degree` = major pentatonic
/// steps per move (max); lower voices use `slow`x longer notes.
pub const DEFAULTS: &[(&str, f64)] =
    &[("voices", 2.0), ("base", 72.0), ("beats", 32.0), ("step", 2.0), ("slow", 2.0)];

const SCALE: [f64; 5] = [0.0, 2.0, 4.0, 7.0, 9.0];

pub struct Melody {
    seed: u32,
    key: Vec<f64>,
    out: Multi,
}

impl Melody {
    pub fn new(seed: u32) -> Self {
        Self { seed, key: vec![], out: Multi::new(&["pitch", "dur"]) }
    }

    fn build(&mut self, voices: usize, base: f64, beats: f64, step: i64, slow: f64) {
        let mut rng = self.seed as u64 * 2654435761 + 1;
        let mut rand = move |n: u64| {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            rng % n
        };
        let n = SCALE.len() as i64;
        self.out.lines = (0..voices)
            .map(|v| {
                let (mut t, mut deg, mut line) = (0.0, n, vec![]);
                while t < beats {
                    deg = (deg + rand(2 * step as u64 + 1) as i64 - step).clamp(0, 3 * n - 1);
                    let pitch = base - 12.0 * v as f64 + 12.0 * (deg / n) as f64 + SCALE[(deg % n) as usize];
                    let dur = [0.5, 1.0, 1.0, 2.0][rand(4) as usize] * if v > 0 { slow } else { 1.0 };
                    line.extend([(t / beats) as f32, (1.0 - (pitch - 36.0) / 72.0) as f32, pitch as f32, dur as f32]);
                    t += dur;
                }
                line
            })
            .collect();
    }
}

impl Gen for Melody {
    fn step(&mut self, _dt: f64, p: &Params) -> Channels {
        let key: Vec<f64> = DEFAULTS.iter().map(|(k, d)| get(p, k, *d)).collect();
        if key != self.key {
            let voices = key[0].clamp(1.0, 8.0) as usize;
            let step = key[3].clamp(1.0, 4.0) as i64;
            self.build(voices, key[1], key[2].clamp(1.0, 1024.0), step, key[4].max(0.25));
            self.key = key;
        }
        let mut ch = Channels::new();
        ch.insert("notes", self.out.lines.iter().map(|l| l.len() / 4).sum::<usize>() as f64);
        ch
    }

    fn points(&self) -> Option<Multi> {
        Some(self.out.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voices_with_pitch_dur_dims_fill_beats() {
        let mut m = Melody::new(7);
        m.step(0.0, &Params::new());
        let out = m.points().unwrap();
        assert_eq!(out.attrs, ["x", "y", "pitch", "dur"]);
        assert_eq!(out.lines.len(), 2);
        for l in &out.lines {
            let total: f32 = l.chunks(4).map(|p| p[3]).sum();
            assert!(total >= 32.0);
            assert!(l.chunks(4).all(|p| (24.0..=120.0).contains(&p[2])));
        }
        let again = { let mut n = Melody::new(7); n.step(0.0, &Params::new()); n.points().unwrap() };
        assert_eq!(out.lines, again.lines, "seeded = deterministic");
    }
}
