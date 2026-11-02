use crate::font::Curves;
use glam::{Vec2, vec2};
use noise::{NoiseFn, OpenSimplex};
use rand::{Rng, RngExt};
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone)]
pub struct Paths {
    pub paths: Vec<Vec<Vec2>>,
}

#[derive(Debug, Clone)]
pub struct Intersection {
    /// All points that intersect at the same location
    pub points: Vec<Indexes>,
    pub inertia: f32,
}

#[derive(Debug, Clone)]
pub struct Intersections {
    pub intersections: Vec<Intersection>,
}

#[derive(Debug, Clone, Copy)]
pub struct Indexes {
    pub line: usize,
    pub point: usize,
}

macro_rules! path {
    [ $coords:literal ] => {{
        $coords
            .split_whitespace()
            .map(|pair| {
                let (x, y) = pair
                    .split_once(',')
                    .expect("path!: each point must be in `x,y` format");
                vec2(
                    x.parse::<f32>().expect("path!: invalid x value"),
                    y.parse::<f32>().expect("path!: invalid y value"),
                )
            })
            .collect::<Vec<Vec2>>()
    }};
}

pub struct CurvesCallback {
    pub progress: f32,
    pub curve_index: f32,
}

impl Paths {
    pub fn new() -> Self {
        Self { paths: Vec::new() }
    }

    pub fn at_index(&mut self, index: Indexes) -> Option<&mut Vec2> {
        self.paths
            .get_mut(index.line)
            .and_then(|path| path.get_mut(index.point))
    }

    pub fn rand_curve<F>(&mut self, mut callback: F) -> &mut Self
    where
        F: FnMut(&mut Vec<Vec2>),
    {
        if !self.paths.is_empty() {
            let mut rng = rand::rng();
            let rand_index = rng.random_range(0..self.paths.len());
            if let Some(curve) = self.paths.get_mut(rand_index) {
                callback(curve);
            }
        }
        self
    }

    pub fn rpt<F>(&mut self, num_instances: u32, mut callback: F) -> &mut Self
    where
        F: FnMut(f32) -> Vec<Vec2>,
    {
        for i in 0..num_instances {
            let t = if num_instances > 1 {
                i as f32 / (num_instances - 1) as f32
            } else {
                0.0
            };
            let curve = callback(t);
            self.paths.push(curve);
        }

        self
    }

    pub fn points<F>(&mut self, mut callback: F) -> &mut Self
    where
        F: FnMut(&mut Vec2, f32, f32, Indexes),
    {
        let total_points: usize = self.paths.iter().map(|path| path.len()).sum();

        for (line_idx, path) in self.paths.iter_mut().enumerate() {
            let path_len = path.len();

            for (point_idx, point) in path.iter_mut().enumerate() {
                let progress = if total_points > 1 {
                    line_idx as f32 / (total_points - 1) as f32
                } else {
                    0.0
                };

                let curve_progress = if path_len > 1 {
                    point_idx as f32 / (path_len - 1) as f32
                } else {
                    0.0
                };

                callback(
                    point,
                    progress,
                    curve_progress,
                    Indexes {
                        point: point_idx,
                        line: line_idx,
                    },
                );
            }
        }

        self
    }

    pub fn curves<F>(&mut self, mut callback: F) -> &mut Self
    where
        F: FnMut(&mut Vec<Vec2>, CurvesCallback),
    {
        let total_curves = self.paths.len();

        for (curve_index, curve) in self.paths.iter_mut().enumerate() {
            let progress = if total_curves > 1 {
                curve_index as f32 / (total_curves - 1) as f32
            } else {
                0.0
            };

            callback(
                curve,
                CurvesCallback {
                    progress,
                    curve_index: curve_index as f32,
                },
            );
        }

        self
    }

    fn calculate_path_length(path: &[Vec2]) -> f32 {
        path.windows(2).map(|w| (w[1] - w[0]).length()).sum()
    }

    pub fn aspect(&mut self, aspect_ratio: f32) -> &mut Self {
        self.paths = self
            .paths
            .iter()
            .map(|path| {
                path.iter()
                    .map(|&point| vec2(point.x, point.y * aspect_ratio))
                    .collect()
            })
            .collect();
        self
    }

    pub fn to_curves(&self, width: f32) -> Curves {
        self.to_curves_scaled(width, None)
    }

    /// `to_curves` with a per-vertex width multiplier (`scale[path][point]`, e.g. a
    /// multiarray `width` attr); missing entries = 1. Instance count stays length / `width`.
    pub fn to_curves_scaled(&self, width: f32, scale: Option<&[Vec<f32>]>) -> Curves {
        let mut vertices = Vec::new();
        let mut widths = Vec::new();
        let mut curve_starts = vec![0u32];
        let mut instance_total = 0;
        let mut index_total = 0;
        let mut curve_lengths = vec![0u32];

        for (i, path) in self.paths.iter().enumerate() {
            let len = path.len() as usize;
            let path_length = Self::calculate_path_length(&path);
            index_total += len as u32;
            instance_total += (path_length / width) as u32;
            curve_lengths.push(instance_total);
            curve_starts.push(index_total);
            vertices.extend(path);
            let k = scale.and_then(|s| s.get(i));
            widths.extend((0..len).map(|j| width * k.and_then(|k| k.get(j)).copied().unwrap_or(1.0)));
        }

        Curves {
            vertices,
            curve_starts,
            widths,
            curve_lengths,
            total_instances: instance_total,
        }
    }

    pub fn sample(&self, t: f32) -> Vec<Vec2> {
        self.paths
            .iter()
            .map(|path| {
                let segments = crate::font::curves::points_to_quadratic_segments(path);
                if segments.is_empty() {
                    if path.is_empty() {
                        return Vec2::ZERO;
                    }
                    let idx =
                        ((t * (path.len() as f32 - 1.0)).floor() as usize).min(path.len() - 1);
                    path[idx]
                } else {
                    crate::font::curves::sample_quadratic_bezier_sequence_by_length(&segments, t)
                }
            })
            .collect()
    }

    pub fn scan(&self, t: f32) -> Vec<Vec2> {
        let mut points = Vec::new();

        for path in self.paths.iter() {
            let segments = crate::font::curves::points_to_quadratic_segments(path);
            if segments.is_empty() {
                if !path.is_empty() {
                    let idx =
                        ((t * (path.len() as f32 - 1.0)).floor() as usize).min(path.len() - 1);
                    points.push(path[idx]);
                }
            } else {
                points.push(
                    crate::font::curves::sample_quadratic_bezier_sequence_by_length(&segments, t),
                );
            }
        }

        points
    }
}

impl Intersections {
    pub fn new() -> Self {
        Self {
            intersections: Vec::new(),
        }
    }

    /// Add an intersection with multiple coincident points
    pub fn add(&mut self, points: Vec<Indexes>, inertia: f32) {
        self.intersections.push(Intersection { points, inertia });
    }

    /// Get all intersections that involve a given curve
    pub fn get_for_path(&self, curve_idx: usize) -> Vec<&Intersection> {
        self.intersections
            .iter()
            .filter(|i| i.points.iter().any(|idx| idx.line == curve_idx))
            .collect()
    }
}
