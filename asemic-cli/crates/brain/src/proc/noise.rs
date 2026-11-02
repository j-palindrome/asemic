//! Noisegens. Each step emits named channels; conventions every gen follows:
//!   `value` (-1..1)  primary 1-D signal
//!   `x`,`y` (-1..1)  2-D position-like signal
//!   `vx`,`vy`        velocity field for `drift` animation (arena units/s)
//! Gens may add raw channels (chaos: `lx`,`ly`,`lz`,`angle`).
//! Each noise proc also emits a point Multiarray containing its named channels at [0, 0].

use std::f64::consts::TAU;

use noise::{NoiseFn, OpenSimplex, Perlin};

use asemic_schema::{Multi, ProcKind};
use crate::node::{Channels, Gen, Params};

fn get(p: &Params, k: &str, d: f64) -> f64 {
    p.get(k).copied().filter(|v| v.is_finite()).unwrap_or(d)
}

pub fn make(kind: ProcKind, seed: u32) -> Box<dyn Gen> {
    match kind {
        ProcKind::Chaos => Box::new(Chaos::default()),
        ProcKind::Perlin => Box::new(Field { f: Box::new(Perlin::new(seed)), t: 0.0, last: Channels::new() }),
        ProcKind::Simplex => Box::new(Field { f: Box::new(OpenSimplex::new(seed)), t: 0.0, last: Channels::new() }),
        ProcKind::Lfo => Box::new(Lfo::default()),
        ProcKind::RandomWalk => Box::new(RandomWalk::new(seed)),
        _ => panic!("not a noise proc kind: {kind:?}"),
    }
}

/// Defaults per gen, so the REPL can draw sliders for gen params.
pub fn defaults(kind: ProcKind) -> Params {
    let kv: &[(&str, f64)] = match kind {
        ProcKind::Chaos => &[("sigma", 10.0), ("rho", 28.0), ("beta", 8.0 / 3.0), ("speed", 1.2)],
        ProcKind::Perlin | ProcKind::Simplex => &[("freq", 0.5), ("speed", 1.0)],
        ProcKind::Lfo => &[("freq", 0.25), ("shape", 0.0), ("phase", 0.0)],
        ProcKind::RandomWalk => &[("step", 0.3), ("speed", 1.0)],
        _ => &[],
    };
    kv.iter().map(|(k, v)| (k.to_string(), *v)).collect()
}

fn channels_to_multi(ch: &Channels) -> Option<Multi> {
    let attrs: Vec<&str> = ch.keys().copied().collect();
    let vals: Vec<f32> = ch.values().map(|v| *v as f32).collect();
    Some(Multi::from_point(attrs, &vals))
}

// ---------------------------------------------------------------- chaos

/// Lorenz attractor + vortex angle; port of hue-inferno `update_lorenz_ml` and drift.
pub struct Chaos {
    pub l: [f64; 3],
    pub angle: f64,
    last: Channels,
}

impl Default for Chaos {
    fn default() -> Self {
        Self { l: [0.1, 0.0, 0.0], angle: 0.0, last: Channels::new() }
    }
}

impl Chaos {
    fn lorenz(&mut self, dt: f64, sigma: f64, rho: f64, beta: f64) {
        let dt = dt.clamp(0.001, 0.05);
        let [x, y, z] = self.l;
        let dx = sigma * (y - x) * dt;
        let dy = (x * (rho - z) - y) * dt;
        let dz = (x * y - beta * z) * dt;
        self.l = [(x + dx).clamp(-50.0, 50.0), (y + dy).clamp(-50.0, 50.0), (z + dz).clamp(0.0, 60.0)];
    }
}

impl Gen for Chaos {
    fn step(&mut self, dt: f64, p: &Params) -> Channels {
        let speed = get(p, "speed", 1.2);
        self.angle += speed * dt * 1.5;
        self.lorenz(dt * speed, get(p, "sigma", 10.0), get(p, "rho", 28.0), get(p, "beta", 8.0 / 3.0));
        let [lx, ly, lz] = self.l;
        let a = self.angle;
        let ch = Channels::from([
            ("value", (lx / 20.0).clamp(-1.0, 1.0)),
            ("x", (lx / 20.0).clamp(-1.0, 1.0)),
            ("y", (ly / 25.0).clamp(-1.0, 1.0)),
            ("vx", ((a * 0.8).sin() * 0.6 + lx * 0.018) * speed),
            ("vy", ((a * 0.6).cos() * 0.6 + ly * 0.018) * speed),
            ("lx", lx),
            ("ly", ly),
            ("lz", lz),
            ("angle", a),
            ("speed", speed),
        ]);
        self.last = ch.clone();
        ch
    }

    fn points(&self) -> Option<Multi> {
        channels_to_multi(&self.last)
    }
}

// ---------------------------------------------------------------- perlin / simplex

struct Field {
    f: Box<dyn NoiseFn<f64, 2> + Send>,
    t: f64,
    last: Channels,
}

impl Gen for Field {
    fn step(&mut self, dt: f64, p: &Params) -> Channels {
        self.t += dt * get(p, "freq", 0.5);
        let x = self.f.get([self.t, 0.0]).clamp(-1.0, 1.0);
        let y = self.f.get([self.t, 31.7]).clamp(-1.0, 1.0);
        let speed = get(p, "speed", 1.0);
        let ch = Channels::from([("value", x), ("x", x), ("y", y), ("vx", x * speed), ("vy", y * speed)]);
        self.last = ch.clone();
        ch
    }

    fn points(&self) -> Option<Multi> {
        channels_to_multi(&self.last)
    }
}

// ---------------------------------------------------------------- lfo

#[derive(Default)]
struct Lfo {
    phase: f64,
    last: Channels,
}

/// shape: 0 sine, 1 triangle, 2 saw, 3 square.
pub fn wave(shape: f64, ph: f64) -> f64 {
    let ph = ph.rem_euclid(1.0);
    match shape.round() as i64 {
        1 => 1.0 - 4.0 * (ph - 0.5).abs(),
        2 => 2.0 * ph - 1.0,
        3 => {
            if ph < 0.5 { 1.0 } else { -1.0 }
        }
        _ => (ph * TAU).sin(),
    }
}

impl Gen for Lfo {
    fn step(&mut self, dt: f64, p: &Params) -> Channels {
        let freq = get(p, "freq", 0.25);
        self.phase = (self.phase + dt * freq).rem_euclid(1.0);
        let ph = self.phase + get(p, "phase", 0.0);
        let v = wave(get(p, "shape", 0.0), ph);
        let (s, c) = (ph * TAU).sin_cos();
        let w = freq * TAU;
        let ch = Channels::from([("value", v), ("x", c), ("y", s), ("vx", -s * w), ("vy", c * w)]);
        self.last = ch.clone();
        ch
    }

    fn points(&self) -> Option<Multi> {
        channels_to_multi(&self.last)
    }
}

// ---------------------------------------------------------------- random walk

struct RandomWalk {
    rng: u64,
    pos: [f64; 2],
    last: Channels,
}

impl RandomWalk {
    fn new(seed: u32) -> Self {
        Self { rng: 0x9E37_79B9_7F4A_7C15 ^ seed as u64, pos: [0.0, 0.0], last: Channels::new() }
    }

    /// xorshift64* → uniform -1..1 (deterministic per seed).
    fn uniform(&mut self) -> f64 {
        self.rng ^= self.rng >> 12;
        self.rng ^= self.rng << 25;
        self.rng ^= self.rng >> 27;
        let r = self.rng.wrapping_mul(0x2545_F491_4F6C_DD1D);
        (r >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
    }
}

fn reflect(v: f64) -> f64 {
    if v > 1.0 {
        2.0 - v
    } else if v < -1.0 {
        -2.0 - v
    } else {
        v
    }
}

impl Gen for RandomWalk {
    fn step(&mut self, dt: f64, p: &Params) -> Channels {
        let k = get(p, "step", 0.3) * get(p, "speed", 1.0) * dt.sqrt();
        let d = [self.uniform() * k, self.uniform() * k];
        self.pos = [reflect(self.pos[0] + d[0]), reflect(self.pos[1] + d[1])];
        let inv = if dt > 0.0 { 1.0 / dt } else { 0.0 };
        let ch = Channels::from([
            ("value", self.pos[0]),
            ("x", self.pos[0]),
            ("y", self.pos[1]),
            ("vx", d[0] * inv),
            ("vy", d[1] * inv),
        ]);
        self.last = ch.clone();
        ch
    }

    fn points(&self) -> Option<Multi> {
        channels_to_multi(&self.last)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(kind: ProcKind, seed: u32, n: usize) -> Vec<Channels> {
        let mut g = make(kind, seed);
        let p = defaults(kind);
        (0..n).map(|_| g.step(1.0 / 60.0, &p)).collect()
    }

    #[test]
    fn deterministic_per_seed() {
        for k in [ProcKind::Chaos, ProcKind::Perlin, ProcKind::Simplex, ProcKind::Lfo, ProcKind::RandomWalk] {
            assert_eq!(run(k, 7, 200), run(k, 7, 200), "{k:?}");
        }
        assert_ne!(run(ProcKind::RandomWalk, 1, 50), run(ProcKind::RandomWalk, 2, 50));
    }

    #[test]
    fn conventional_channels_bounded() {
        for k in [ProcKind::Chaos, ProcKind::Perlin, ProcKind::Simplex, ProcKind::Lfo, ProcKind::RandomWalk] {
            for c in run(k, 3, 2000) {
                for ch in ["value", "x", "y"] {
                    let v = c[ch];
                    assert!((-1.0..=1.0).contains(&v), "{k:?}.{ch} = {v}");
                }
                assert!(c["vx"].is_finite() && c["vy"].is_finite());
            }
        }
    }

    #[test]
    fn chaos_matches_hue_inferno_step() {
        // one step from hue-inferno initial state [0.1,0,0], dt=1/60, speed 1.2
        let mut c = Chaos::default();
        let out = c.step(1.0 / 60.0, &defaults(ProcKind::Chaos));
        let dt = 1.2 / 60.0;
        assert!((out["lx"] - (0.1 + 10.0 * (0.0 - 0.1) * dt)).abs() < 1e-12);
        assert!((out["ly"] - (0.1 * 28.0 * dt)).abs() < 1e-12);
        assert!((out["angle"] - 1.2 / 60.0 * 1.5).abs() < 1e-12);
        assert!(c.l[2] >= 0.0);
    }

    #[test]
    fn lfo_shapes() {
        assert!((wave(0.0, 0.25) - 1.0).abs() < 1e-9);
        assert!((wave(1.0, 0.5) - 1.0).abs() < 1e-9);
        assert_eq!(wave(3.0, 0.75), -1.0);
    }
}
