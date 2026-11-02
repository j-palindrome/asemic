//! Oscilloscope converter: gen points -> audio (out_1 = x, out_2 = y, rest silent), drawing
//! traced `hz` times/s; engine coords 0..1 y down -> -1..1 y up. Feeds any io `AudioSink`.
//! Points stay a multiarray: tracing interpolates every dim alike, then reads dims x, y.

use std::sync::Arc;

use arc_swap::ArcSwap;

use asemic_schema::Multi;

/// Latest multiarray, swapped in by the render loop, read lock-free by the audio callback.
pub type Points = Arc<ArcSwap<Multi>>;

pub struct Scope {
    pts: Points,
    hz: f32,
    phase: f32,
}

impl Scope {
    pub fn new(hz: f32) -> (Self, Points) {
        let pts = Points::default();
        (Self { pts: pts.clone(), hz, phase: 0.0 }, pts)
    }
}

impl crate::io::AudioSource for Scope {
    fn fill(&mut self, ch: usize, rate: f32, buf: &mut [f32]) {
        if ch > 1 {
            buf.fill(0.0);
            return;
        }
        let (pts, step) = (self.pts.load(), self.hz / rate);
        let mut ph = self.phase;
        for v in buf {
            *v = trace(&pts, ph)[ch];
            ph = (ph + step).fract();
        }
    }
    fn advance(&mut self, rate: f32, frames: usize) {
        self.phase = (self.phase + self.hz / rate * frames as f32).fract();
    }
}

/// Point at phase 0..1 along all points in sequence (every dim interpolated alike, then
/// dims x, y -> -1..1 y up); silence if empty.
pub fn trace(m: &Multi, phase: f32) -> [f32; 2] {
    if m.is_empty() {
        return [0.0, 0.0];
    }
    let at = |n| m.attr(n).and_then(|k| m.sample_dim(phase, k)).unwrap_or(0.0);
    [at("x") * 2.0 - 1.0, 1.0 - at("y") * 2.0]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trace_walks_points_as_xy_audio() {
        assert_eq!(trace(&Multi::default(), 0.3), [0.0, 0.0]);
        let pts = Multi::from_xy([[[0.0f32, 0.0], [1.0, 1.0]]]);
        assert_eq!(trace(&pts, 0.0), [-1.0, 1.0]);
        assert_eq!(trace(&pts, 0.5), [0.0, 0.0]);
        assert!((trace(&pts, 0.999)[0] - 1.0).abs() < 0.01);
    }
}
