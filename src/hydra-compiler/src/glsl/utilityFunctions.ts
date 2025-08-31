// functions that are only used within other functions

export const utilityFunctions = {
  _luminance: {
    type: 'util',
    glsl: `fn _luminance(rgb: vec3<f32>) -> f32 {
	let W: vec3<f32> = vec3<f32>(0.2125, 0.7154, 0.0721);
	return dot(rgb, W);
}`
  },
  _noise: {
    type: 'util',
    glsl: `
fn permute(x: vec4<f32>) -> vec4<f32> {
	return (((x * 34. + 1.) * x) % (289.));
} 

fn taylorInvSqrt(r: vec4<f32>) -> vec4<f32> {
	return 1.7928429 - 0.85373473 * r;
} 

fn _noise(v: vec3<f32>) -> f32 {
	let C: vec2<f32> = vec2<f32>(1. / 6., 1. / 3.);
	let D: vec4<f32> = vec4<f32>(0., 0.5, 1., 2.);
	var i: vec3<f32> = floor(v + dot(v, C.yyy));
	let x0: vec3<f32> = v - i + dot(i, C.xxx);
	let g: vec3<f32> = step(x0.yzx, x0.xyz);
	let l: vec3<f32> = 1. - g;
	let i1: vec3<f32> = min(g.xyz, l.zxy);
	let i2: vec3<f32> = max(g.xyz, l.zxy);
	let x1: vec3<f32> = x0 - i1 + 1. * C.xxx;
	let x2: vec3<f32> = x0 - i2 + 2. * C.xxx;
	let x3: vec3<f32> = x0 - 1. + 3. * C.xxx;
	i = ((i) % (289.));
	let p: vec4<f32> = permute(permute(permute(i.z + vec4<f32>(0., i1.z, i2.z, 1.)) + i.y + vec4<f32>(0., i1.y, i2.y, 1.)) + i.x + vec4<f32>(0., i1.x, i2.x, 1.));
	let n_: f32 = 1. / 7.;
	let ns: vec3<f32> = n_ * D.wyz - D.xzx;
	let j: vec4<f32> = p - 49. * floor(p * ns.z * ns.z);
	let x_: vec4<f32> = floor(j * ns.z);
	let y_: vec4<f32> = floor(j - 7. * x_);
	let x: vec4<f32> = x_ * ns.x + ns.yyyy;
	let y: vec4<f32> = y_ * ns.x + ns.yyyy;
	let h: vec4<f32> = 1. - abs(x) - abs(y);
	let b0: vec4<f32> = vec4<f32>(x.xy, y.xy);
	let b1: vec4<f32> = vec4<f32>(x.zw, y.zw);
	let s0: vec4<f32> = floor(b0) * 2. + 1.;
	let s1: vec4<f32> = floor(b1) * 2. + 1.;
	let sh: vec4<f32> = -step(h, vec4<f32>(0.));
	let a0: vec4<f32> = b0.xzyw + s0.xzyw * sh.xxyy;
	let a1: vec4<f32> = b1.xzyw + s1.xzyw * sh.zzww;
	var p0: vec3<f32> = vec3<f32>(a0.xy, h.x);
	var p1: vec3<f32> = vec3<f32>(a0.zw, h.y);
	var p2: vec3<f32> = vec3<f32>(a1.xy, h.z);
	var p3: vec3<f32> = vec3<f32>(a1.zw, h.w);
	let norm: vec4<f32> = taylorInvSqrt(vec4<f32>(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
	p0 = p0 * (norm.x);
	p1 = p1 * (norm.y);
	p2 = p2 * (norm.z);
	p3 = p3 * (norm.w);
	var m: vec4<f32> = max(0.6 - vec4<f32>(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4<f32>(0.));
	m = m * m;
	return 42. * dot(m * m, vec4<f32>(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
    `
  },

  _rgbToHsv: {
    type: 'util',
    glsl: `
fn _rgbToHsv(c: vec3<f32>) -> vec3<f32> {
	let K: vec4<f32> = vec4<f32>(0., -1. / 3., 2. / 3., -1.);
	let p: vec4<f32> = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
	let q: vec4<f32> = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
	let d: f32 = q.x - min(q.w, q.y);
	let e: f32 = 0.0000000001;
	return vec3<f32>(abs(q.z + (q.w - q.y) / (6. * d + e)), d / (q.x + e), q.x);
}
	`
  },
  _hsvToRgb: {
    type: 'util',
    glsl: `
fn _hsvToRgb(c: vec3<f32>) -> vec3<f32> {
	let K: vec4<f32> = vec4<f32>(1., 2. / 3., 1. / 3., 3.);
	let p: vec3<f32> = abs(fract(c.xxx + K.xyz) * 6. - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.), vec3<f32>(1.)), c.y);
} 

`
  },
  _rotate: {
    type: 'util',
    glsl: `
fn _rotate(uv: vec2<f32>, cp: vec2<f32>, a: f32, side: bool) -> vec2<f32> {
	var uv_var = uv;
	let angle: f32 = a * 3.141592;
	let n: vec2<f32> = vec2<f32>(sin(angle), cos(angle));
	let d: f32 = dot(uv_var - cp, n);
	if (side) {
		uv_var = uv_var - (n * max(0., d) * 2.);
	} else { 
		uv_var = uv_var - (n * min(0., d) * 2.);
	}
	return uv_var;
}`
  }
}
