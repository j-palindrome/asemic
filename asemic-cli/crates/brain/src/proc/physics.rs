//! Rapier2d rigid body balls in a unit box (physics y up; output y down).

use asemic_schema::Multi;
use rapier2d::prelude::*;

use crate::node::{Channels, Gen, Params};
use crate::proc::get;

pub const DEFAULTS: &[(&str, f64)] = &[
    ("n", 8.0),
    ("gravity", 1.0),
    ("restitution", 0.9),
    ("radius", 0.04),
    ("kick", 0.0),
    ("damping", 0.0),
    ("angular_damping", 0.0),
];

fn circle(cx: f32, cy: f32, r: f32) -> Vec<[f32; 2]> {
    (0..=12)
        .map(|i| {
            let a = i as f32 / 12.0 * std::f32::consts::TAU;
            [cx + r * a.cos(), cy + r * a.sin()]
        })
        .collect()
}

/// Balls in a unit box (physics y up; output y down).
pub struct Physics {
    w: PhysicsWorld,
    pub(crate) balls: Vec<RigidBodyHandle>,
    built: (usize, f64, f64),
    rng: u64,
    r: f32,
}

impl Physics {
    pub fn new(seed: u32) -> Self {
        Self {
            w: PhysicsWorld::new(),
            balls: vec![],
            built: (usize::MAX, 0.0, 0.0),
            rng: seed as u64 * 2654435761 + 1,
            r: 0.04,
        }
    }

    fn rand(&mut self) -> f64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        (self.rng >> 11) as f64 / (1u64 << 53) as f64
    }

    fn build(&mut self, n: usize, r: f64, e: f64) {
        self.w = PhysicsWorld::new();
        self.balls.clear();
        let t = 0.1;
        for (x, y, hx, hy) in [
            (0.5, -t, 0.5 + t, t),
            (0.5, 1.0 + t, 0.5 + t, t),
            (-t, 0.5, t, 0.5 + t),
            (1.0 + t, 0.5, t, 0.5 + t),
        ] {
            self.w.colliders.insert(
                ColliderBuilder::cuboid(hx as f32, hy as f32)
                    .translation(Vector::new(x as f32, y as f32))
                    .build(),
            );
        }
        for i in 0..n {
            let (x, y) = (0.15 + 0.7 * self.rand(), 0.5 + 0.4 * self.rand());
            let vx = (self.rand() - 0.5) as f32;
            let h = self.w.bodies.insert(
                RigidBodyBuilder::dynamic()
                    .translation(Vector::new(x as f32, y as f32))
                    .linvel(Vector::new(vx, 0.0))
                    .build(),
            );
            let c = ColliderBuilder::ball(r as f32).restitution(e as f32).friction(0.1).build();
            self.w.colliders.insert_with_parent(c, h, &mut self.w.bodies);
            self.balls.push(h);
            let _ = i;
        }
        self.r = r as f32;
        self.built = (n, r, e);
    }
}

impl Gen for Physics {
    fn step(&mut self, dt: f64, p: &Params) -> Channels {
        let n = get(p, "n", 8.0).clamp(1.0, 256.0) as usize;
        let r = get(p, "radius", 0.04).clamp(0.005, 0.2);
        let e = get(p, "restitution", 0.9).clamp(0.0, 1.0);
        if self.built != (n, r, e) {
            self.build(n, r, e);
        }
        self.w.gravity = Vector::new(0.0, -9.81 * get(p, "gravity", 1.0) as f32);
        self.w.integration_parameters.dt = dt.clamp(1e-4, 0.05) as f32;
        let kick = get(p, "kick", 0.0) * dt;
        let (lin_d, ang_d) = (
            get(p, "damping", 0.0).clamp(0.0, 20.0) as f32,
            get(p, "angular_damping", 0.0).clamp(0.0, 20.0) as f32,
        );
        for i in 0..self.balls.len() {
            if let Some(rb) = self.w.bodies.get_mut(self.balls[i]) {
                rb.set_linear_damping(lin_d);
                rb.set_angular_damping(ang_d);
            }
            if kick > 0.0 {
                let (a, b) = (self.rand() - 0.5, self.rand() - 0.5);
                if let Some(rb) = self.w.bodies.get_mut(self.balls[i]) {
                    let m = rb.mass();
                    rb.apply_impulse(
                        Vector::new((a * kick) as f32 * m * 4.0, (b * kick) as f32 * m * 4.0),
                        true,
                    );
                }
            }
        }
        self.w.step();
        let mut ch = Channels::new();
        let mut energy = 0.0;
        for (i, h) in self.balls.iter().enumerate() {
            let rb = &self.w.bodies[*h];
            let (pos, v) = (rb.translation(), rb.linvel());
            energy += 0.5 * (v.x * v.x + v.y * v.y) as f64;
            if i == 0 {
                ch.insert("x", pos.x as f64 * 2.0 - 1.0);
                ch.insert("y", 1.0 - pos.y as f64 * 2.0);
                ch.insert("vx", v.x as f64);
                ch.insert("vy", -v.y as f64);
            }
        }
        let e = (energy / self.balls.len().max(1) as f64).tanh() * 2.0 - 1.0;
        ch.insert("energy", e);
        ch.insert("value", e);
        ch
    }

    /// Per ball: 13-point circle outline, every point carrying that ball's velocity
    /// (`vx`,`vy`, screen convention: y down) as extra attrs.
    fn points(&self) -> Option<Multi> {
        let mut m = Multi::new(&["vx", "vy"]);
        m.lines = self
            .balls
            .iter()
            .map(|h| {
                let rb = &self.w.bodies[*h];
                let t = rb.translation();
                let v = rb.linvel();
                circle(t.x, 1.0 - t.y, self.r)
                    .into_iter()
                    .flat_map(|[x, y]| [x, y, v.x, -v.y])
                    .collect()
            })
            .collect();
        Some(m)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(g: &mut dyn Gen, p: &Params, frames: usize) -> Channels {
        let mut ch = Channels::new();
        for _ in 0..frames {
            ch = g.step(1.0 / 60.0, p);
        }
        ch
    }

    #[test]
    fn physics_falls_and_stays_in_box() {
        let p: Params = DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        let mut g = Physics::new(1);
        let y0 = g.step(1.0 / 60.0, &p)["y"];
        let ch = run(&mut g, &p, 30);
        assert!(ch["y"] > y0, "y down = falling: {y0} -> {}", ch["y"]);
        let ch = run(&mut g, &p, 600);
        assert!((-1.0..=1.0).contains(&ch["x"]) && (-1.0..=1.0).contains(&ch["y"]));
        assert_eq!(g.points().unwrap().lines.len(), 8);
    }

    #[test]
    fn physics_damping_slows_balls() {
        let mut p: Params = DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        p.insert("gravity".into(), 0.0); // isolate damping from gravity accel
        p.insert("n".into(), 1.0);
        let speed = |damping: f64| {
            let mut p = p.clone();
            p.insert("damping".into(), damping);
            let mut g = Physics::new(1);
            let ch0 = g.step(1.0 / 60.0, &p);
            let v0 = (ch0["vx"].powi(2) + ch0["vy"].powi(2)).sqrt();
            let ch = run(&mut g, &p, 120);
            ((ch["vx"].powi(2) + ch["vy"].powi(2)).sqrt(), v0)
        };
        let ((undamped, _), (damped, _)) = (speed(0.0), speed(5.0));
        assert!(
            damped < undamped,
            "damping=5 should slow more than damping=0: {damped} vs {undamped}"
        );
    }

    #[test]
    fn physics_points_carry_per_ball_velocity() {
        let mut p: Params = DEFAULTS.iter().map(|(k, v)| (k.to_string(), *v)).collect();
        p.insert("n".into(), 3.0);
        p.insert("gravity".into(), 1.0);
        let mut g = Physics::new(1);
        run(&mut g, &p, 10);
        let m = g.points().unwrap();
        assert_eq!(m.attrs, ["x", "y", "vx", "vy"]);
        assert_eq!(m.lines.len(), 3);
        let (vx, vy) = (m.attr("vx").unwrap(), m.attr("vy").unwrap());
        // every point on a ball's circle carries the same velocity, and it's finite
        for (i, h) in g.balls.iter().enumerate() {
            let want = g.w.bodies[*h].linvel();
            for pt in m.points(i) {
                assert!((pt[vx] - want.x).abs() < 1e-6 && (pt[vy] - -want.y).abs() < 1e-6);
            }
        }
    }
}
