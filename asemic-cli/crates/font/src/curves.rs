use glam::Vec2;
use lyon_path::geom::QuadraticBezierSegment;
use lyon_path::geom::euclid::default::Point2D;

/// Converts a glam Vec2 to a lyon Point2D
pub fn to_point(v: Vec2) -> Point2D<f32> {
    Point2D::new(v.x, v.y)
}

/// Converts a lyon Point2D to a glam Vec2
pub fn from_point(p: Point2D<f32>) -> Vec2 {
    Vec2::new(p.x, p.y)
}

/// Samples a sequence of quadratic bezier segments at a global parameter t (0.0 to 1.0).
/// This implementation treats each segment as having equal weight in the parameter space.
pub fn sample_quadratic_bezier_sequence(segments: &[QuadraticBezierSegment<f32>], t: f32) -> Vec2 {
    if segments.is_empty() {
        return Vec2::ZERO;
    }

    let t = t.clamp(0.0, 1.0);

    // If t is 1.0, return the end point of the last segment
    if t >= 1.0 {
        return from_point(segments.last().unwrap().to);
    }

    let num_segments = segments.len() as f32;
    let scaled_t = t * num_segments;
    let segment_index = (scaled_t.floor() as usize).min(segments.len() - 1);
    let local_t = scaled_t - segment_index as f32;

    from_point(segments[segment_index].sample(local_t))
}

/// Samples a sequence of quadratic bezier segments at a global parameter t (0.0 to 1.0),
/// accounting for the length of each segment to provide more uniform sampling.
pub fn sample_quadratic_bezier_sequence_by_length(
    segments: &[QuadraticBezierSegment<f32>],
    t: f32,
) -> Vec2 {
    if segments.is_empty() {
        return Vec2::ZERO;
    }

    let t = t.clamp(0.0, 1.0);

    if t <= 0.0 {
        return from_point(segments[0].from);
    }

    if t >= 1.0 {
        return from_point(segments.last().unwrap().to);
    }

    // Calculate lengths of each segment and total length
    let lengths: Vec<f32> = segments.iter().map(|s| s.length()).collect();
    let total_length: f32 = lengths.iter().sum();

    if total_length <= 0.0001 {
        return from_point(segments[0].from);
    }

    let target_dist = t * total_length;
    let mut accumulated_dist = 0.0;

    for (i, &segment_len) in lengths.iter().enumerate() {
        if accumulated_dist + segment_len >= target_dist {
            let local_dist = target_dist - accumulated_dist;

            // For a quadratic bezier, we can find the local t corresponding to a distance.
            // Lyon does not provide a direct inverse length function for quadratic segments,
            // so we use an approximation or the provided t_at_distance if we were using
            // lyon_algorithms. Since we only have lyon_geom, we'll use a linear approximation
            // for the local t within the segment.
            let local_t = if segment_len > 0.0 {
                (local_dist / segment_len).clamp(0.0, 1.0)
            } else {
                0.0
            };

            return from_point(segments[i].sample(local_t));
        }
        accumulated_dist += segment_len;
    }

    from_point(segments.last().unwrap().to)
}

/// Converts a list of points into a sequence of quadratic bezier segments.
/// Assumes the points are in the format [Start, Control, End, Control, End, ...]
pub fn points_to_quadratic_segments(points: &[Vec2]) -> Vec<QuadraticBezierSegment<f32>> {
    let mut segments = Vec::new();
    if points.len() < 3 {
        return segments;
    }

    for i in (1..points.len() - 1).step_by(2) {
        segments.push(QuadraticBezierSegment {
            from: to_point(points[i - 1]),
            ctrl: to_point(points[i]),
            to: to_point(points[i + 1]),
        });
    }
    segments
}
