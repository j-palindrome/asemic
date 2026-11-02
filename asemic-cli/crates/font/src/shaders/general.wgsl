const TAU = 6.28318530718;

@group(0) @binding(0)
var<storage, read> vertices: array<vec2<f32>>;
@group(0) @binding(1)
var<storage, read> widths: array<f32>;
@group(0) @binding(2)
var<storage, read> curve_starts: array<u32>;
@group(0) @binding(3)
var<storage, read> curve_lengths: array<u32>;

@group(0) @binding(4)
var<uniform> uniforms: Uniforms;

/// Particle positions buffer (computed by compute shader each frame)
/// Add these offsets to base vertex positions for particle effects
@group(0) @binding(5)
var<storage, read> particle_positions: array<vec2<f32>>;

fn normalCoords(position: vec2<f32>) -> vec2<f32> {
  // Convert coordinates from [0, 1] to [-1, 1] on x
  let x = position.x * 2.0 - 1.0;
  let aspect_ratio = uniforms.aspect_ratio;
  // TODO: pass this as a uniform
  // Convert coordinates from [0, 0.5] to [1, -1] on y
  let y = position.y * (2. / aspect_ratio) - 1.0;
  return vec2<f32>(x, y);
}

fn bezierTangent(t: f32, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>) -> vec2<f32> {
  let u = 1.0 - t;
  let dx = 2.0 * (u * (p1.x - p0.x) + t * (p2.x - p1.x));
  let dy = 2.0 * (u * (p1.y - p0.y) + t * (p2.y - p1.y));
  return vec2<f32>(dx, dy);
}

fn bezierCurve(t: f32, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>) -> vec2<f32> {
  let u = 1.0 - t;
  let tt = t * t;
  let uu = u * u;

  // Position on the curve
  var p = (uu * p0) + (2.0 * u * t * p1) + (tt * p2);

  // Derivative (tangent) vector
  let dx = 2.0 * (u * (p1.x - p0.x) + t * (p2.x - p1.x));
  let dy = 2.0 * (u * (p1.y - p0.y) + t * (p2.y - p1.y));

  // Tangent vector
  let tangent = vec2<f32>(dx, dy);

  // Normal vector (perpendicular to tangent)
  // Rotate tangent 90 degrees to get normal
  //   let normal = normalize(vec2<f32>(- tangent.y, tangent.x));

  //   if (side) {
  //     p = p + normal * width / 2.;
  //   }
  //   else {
  //     p = p - normal * width / 2.;
  //   }

  return p;
}



struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) alpha: f32,
}

struct Progress {
  curve: u32,
  curve_progress: f32
}

struct CurveSample {
  line_pos: vec2<f32>,
  line_width: f32,
  rotation: f32,
}

fn scan_for_curve(instance_index: u32) -> Progress {
  var progress: Progress;

  var curve_starts_index = 0u;
  var max_length = arrayLength(&curve_lengths);
  loop {
    if (curve_starts_index > max_length - 2u) {
      break;
    }
    if (instance_index < curve_lengths[curve_starts_index + 1u]) {
      break;
    }
    curve_starts_index = curve_starts_index + 1u;
  }

  progress.curve = curve_starts_index;
  progress.curve_progress = f32(instance_index - curve_lengths[curve_starts_index]) / f32(curve_lengths[curve_starts_index + 1u] - curve_lengths[curve_starts_index]);
  return progress;
}

fn sample_curve(progress: Progress) -> CurveSample {
  let curve_length = curve_starts[progress.curve + 1u] - curve_starts[progress.curve];

  var line_pos: vec2<f32>;
  var line_width: f32;
  var rotation: f32;

  if (curve_length == 2u) {
    let start_at_point = curve_starts[progress.curve];
    line_width = mix(widths[start_at_point], widths[start_at_point + 1u], progress.curve_progress);
    line_pos = mix(vertices[start_at_point], vertices[start_at_point + 1u], progress.curve_progress);
    rotation = atan2(vertices[start_at_point + 1u].y - vertices[start_at_point].y, vertices[start_at_point + 1u].x - vertices[start_at_point].x);
  }
  else {
    let start_at_point = curve_starts[progress.curve] + u32(progress.curve_progress * f32(curve_length - 2u));
    let t = fract(progress.curve_progress * f32(curve_length - 2u));

    let width0 = select(widths[start_at_point], (widths[start_at_point] + widths[start_at_point + 1u]) / 2., start_at_point > curve_starts[progress.curve]);
    let width1 = widths[start_at_point + 1u];
    let width2 = select(widths[start_at_point + 2u], (widths[start_at_point + 1u] + widths[start_at_point + 2u]) / 2., start_at_point < curve_starts[progress.curve] + curve_length - 3u);

    var p0: vec2<f32> = (select(vertices[start_at_point], (vertices[start_at_point] + vertices[start_at_point + 1u]) / 2., start_at_point > curve_starts[progress.curve]));
    let p1: vec2<f32> = (vertices[start_at_point + 1u]);
    let p2: vec2<f32> = (select((vertices[start_at_point + 1u] + vertices[start_at_point + 2u]) / 2., vertices[start_at_point + 2u], start_at_point >= curve_starts[progress.curve] + curve_length - 3u));

    line_width = select(mix(width1, width0, 1. - t * 2.), mix(width1, width2, (t - 0.5) * 2.), t > 0.5);
    line_pos = bezierCurve(t, p0, p1, p2);
    let tangent = bezierTangent(t, p0, p1, p2);
    rotation = atan2(tangent.y, tangent.x);
  }

  var sample: CurveSample;
  sample.line_pos = line_pos;
  sample.line_width = line_width;
  sample.rotation = rotation;
  return sample;
}

/// Get particle position offset for the given index
/// If particle_positions array is empty, returns zero vector (no particles active)
fn get_particle_offset(index: u32) -> vec2<f32> {
  let particle_count = arrayLength(&particle_positions);
  if (particle_count == 0u) {
    return vec2<f32>(0.0);
  }
  // Clamp index to array bounds
  let safe_index = min(index, particle_count - 1u);
  return particle_positions[safe_index];
}

