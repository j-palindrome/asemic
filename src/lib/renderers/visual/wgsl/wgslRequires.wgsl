const PI = 3.1415926535897932384626433832795;

fn saw(value: f32) -> f32 {
  return fract(value);
}

fn triangle(value: f32) -> f32 {
  return 2.0 * abs(fract(value) - 0.5);
}

fn normalCoords(position: vec2<f32>) -> vec2<f32> {
  // Convert coordinates from [0, 1] to [-1, 1] on x
  let x = position.x * 2.0 - 1.0;
  let aspect_ratio = canvas_dimensions.y / canvas_dimensions.x;
  // Convert coordinates from [0, 0.5] to [1, -1] on y
  let y = 1.0 - position.y * (2. / aspect_ratio);
  return vec2<f32>(x, y);
}

fn bezierTangent(t: f32, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>) -> vec2<f32> {
  let u = 1.0 - t;
  let dx = 2.0 * (u * (p1.x - p0.x) + t * (p2.x - p1.x));
  let dy = 2.0 * (u * (p1.y - p0.y) + t * (p2.y - p1.y));
  return vec2<f32>(dx, dy);
}

fn bezierCurve(t: f32, p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, side: bool, width: f32) -> vec2<f32> {
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
  let normal = normalize(vec2<f32>(- tangent.y, tangent.x));

  if (side) {
    p = p + normal * width / 2.;
  }
  else {
    p = p - normal * width / 2.;
  }

  return p;
}

fn hueToRgb(p: f32, q: f32, t: f32) -> f32 {
  var t_adj = t;
  if (t_adj < 0.0) {
    t_adj += 1.0;
  }
  if (t_adj > 1.0) {
    t_adj -= 1.0;
  }
  if (t_adj < 1.0 / 6.0) {
    return p + (q - p) * 6.0 * t_adj;
  }
  if (t_adj < 1.0 / 2.0) {
    return q;
  }
  if (t_adj < 2.0 / 3.0) {
    return p + (q - p) * (2.0 / 3.0 - t_adj) * 6.0;
  }
  return p;
}

fn hslaToRgba(hsla: vec4<f32>) -> vec4<f32> {
  let h = hsla.x;
  let s = hsla.y;
  let l = hsla.z;
  let a = hsla.w;

  var r: f32 = 0.0;
  var g: f32 = 0.0;
  var b: f32 = 0.0;

  if (s == 0.0) {
    // Achromatic (gray)
    r = l;
    g = l;
    b = l;
  }
  else {
    let q = select(l * (1.0 + s), l + s - l * s, l < 0.5);
    let p = 2.0 * l - q;

    r = hueToRgb(p, q, h + 1.0 / 3.0);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1.0 / 3.0);
  }

  return vec4<f32>(r, g, b, a);
}

fn hash(input: f32) -> f32 {
  let x = sin(input) * 43758.5453;
  let bits = bitcast<u32>(x);
  let xor_result = (bits ^ (bits >> 13u)) * 1274126177u;
  return fract(f32(xor_result & 2147483647u) / 2147483647.0);
}

fn rotate(input: vec2<f32>, angle: f32) -> vec2<f32> {
  let cos_angle = cos(angle);
  let sin_angle = sin(angle);
  return vec2<f32>(input.x * cos_angle - input.y * sin_angle, input.x * sin_angle + input.y * cos_angle);
}

fn add(input: vec2<f32>, offset: vec2<f32>) -> vec2<f32> {
  return input + offset;
}

fn noise(index: f32, C: f32, value: f32) -> f32 {
  return sin(value * (index + hash(C)) * PI * 2.0);
}

fn noise2(index: f32, C: f32, value: vec2<f32>) -> f32 {
  return (sin(value.x * (index + hash(C)) * PI * 2.0) + sin(value.y * (index + hash(C + 1)) * PI * 2.0)) / 2.0;
}