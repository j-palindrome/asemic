fn wrap(position: vec2<f32>, min_bound: vec2<f32>, max_bound: vec2<f32>) -> vec2<f32> {
  var new_position = position;
  let range = max_bound - min_bound;
  new_position.x = min_bound.x + ((new_position.x - min_bound.x) % range.x + range.x) % range.x;
  new_position.y = min_bound.y + ((new_position.y - min_bound.y) % range.y + range.y) % range.y;
  return new_position;
}

struct ModifierInfo {
  line: f32,
  point: f32,
  position: vec2<f32>,
  velocity: vec2<f32>,
  acceleration: vec2<f32>,
  position_base: vec2<f32>,
  uv: vec2<f32>,
}

fn rotate2d(point: vec2<f32>, angle: f32) -> vec2<f32> {
  var normalized_angle = fract(angle) * 2.0 * 3.14159265359;
  if (normalized_angle < 0.0) {
    normalized_angle += 2.0 * 3.14159265359;
  }
  let cos_angle = cos(normalized_angle);
  let sin_angle = sin(normalized_angle);
  return vec2<f32>(point.x * cos_angle - point.y * sin_angle, point.x * sin_angle + point.y * cos_angle);
}

fn calculate_uv(base_pos: vec2<f32>, position: vec2<f32>) -> vec2<f32> {
    // Simple UV calculation based on position (can be customized)
    return wrap((base_pos + position) / vec2<f32>(1.0, uniforms.aspect_ratio), vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 1.0));
}

fn hash(p: f32) -> f32 {
  var h = bitcast<u32>(p);
  h = h ^ (h << 13u);
  h = h ^ (h >> 17u);
  h = h ^ (h << 5u);
  return f32(h) * 2.3283064365386963e-10;
}

fn noise(p: f32) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), u);
}