/*
Format for adding functions to hydra. For each entry in this file, hydra automatically generates a glsl function and javascript function with the same name. You can also ass functions dynamically using setFunction(object).

{
  name: 'osc', // name that will be used to access function in js as well as in glsl
  type: 'src', // can be 'src', 'color', 'combine', 'combineCoords'. see below for more info
  inputs: [
    {
      name: 'freq',
      type: 'float',
      default: 0.2
    },
    {
      name: 'sync',
      type: 'float',
      default: 0.1
    },
    {
      name: 'offset',
      type: 'float',
      default: 0.0
    }
  ],
    glsl: `
      vec2 st = _st;
      float r = sin((st.x-offset*2/freq+time*sync)*freq)*0.5  + 0.5;
      float g = sin((st.x+time*sync)*freq)*0.5 + 0.5;
      float b = sin((st.x+offset/freq+time*sync)*freq)*0.5  + 0.5;
      return vec4(r, g, b, 1.0);
   `
}

// The above code generates the glsl function:
`vec4 osc(vec2 _st, float freq, float sync, float offset){
 vec2 st = _st;
 float r = sin((st.x-offset*2/freq+time*sync)*freq)*0.5  + 0.5;
 float g = sin((st.x+time*sync)*freq)*0.5 + 0.5;
 float b = sin((st.x+offset/freq+time*sync)*freq)*0.5  + 0.5;
 return vec4(r, g, b, 1.0);
}`


Types and default arguments for hydra functions.
The value in the 'type' field lets the parser know which type the function will be returned as well as default arguments.

const types = {
  'src': {
    returnType: 'vec4',
    implicitFirstArg: ['vec2 _st']
  },
  'coord': {
    returnType: 'vec2',
    implicitFirstArg: ['vec2 _st']
  },
  'color': {
    returnType: 'vec4',
    implicitFirstArg: ['vec4 _c0']
  },
  'combine': {
    returnType: 'vec4',
    implicitFirstArg: ['vec4 _c0', 'vec4 _c1']
  },
  'combineCoord': {
    returnType: 'vec2',
    implicitFirstArg: ['vec2 _st', 'vec4 _c0']
  }
}

*/

import { Texture2D } from 'regl'

export type TransformDefinitionType =
  | 'src'
  | 'coord'
  | 'color'
  | 'combine'
  | 'combineCoord'

export type TransformDefinitionInputTypeFloat = {
  type: 'float'
  default?:
    | number
    | number[]
    | ((context: any, props: any) => number | number[])
}

export type TransformDefinitionInputTypeSampler2D = {
  type: 'sampler2D'
  default?: number
}

export type TransformDefinitionInputTypeVec4 = {
  type: 'vec4'
  default?: string | number
}

export type TransformDefinitionInputUnion =
  | TransformDefinitionInputTypeFloat
  | TransformDefinitionInputTypeSampler2D
  | TransformDefinitionInputTypeVec4

export type TransformDefinitionInput = TransformDefinitionInputUnion & {
  name: string
  vecLen?: number
}

export interface TransformDefinition {
  name: string
  type: TransformDefinitionType
  inputs: readonly TransformDefinitionInput[]
  glsl: string
}

export interface ProcessedTransformDefinition extends TransformDefinition {
  processed: true
}

export const generatorTransforms = [
  {
    name: 'noise',
    type: 'src',
    inputs: [
      {
        type: 'f32',
        name: 'scale',
        default: 10
      },
      {
        type: 'f32',
        name: 'offset',
        default: 0.1
      }
    ],
    glsl: `var color: vec3<f32> = vec3<f32>(0.);
	let scaled_st = _st * (scale);
	let i_st: vec2<f32> = floor(scaled_st);
	let f_st: vec2<f32> = fract(scaled_st);
	var m_dist: f32 = 10.;
	var m_point: vec2<f32>;

	for (var j: i32 = -1; j <= 1; j = j + 1) {

		for (var i: i32 = -1; i <= 1; i = i + 1) {
			let neighbor: vec2<f32> = vec2<f32>(f32(i), f32(j));
			let p: vec2<f32> = i_st + neighbor;
			var point: vec2<f32> = fract(sin(vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)))) * 43758.547);
			point = 0.5 + 0.5 * sin(time * speed + 6.2831 * point);
			let diff: vec2<f32> = neighbor + point - f_st;
			let dist: f32 = length(diff);
			if (dist < m_dist) {
				m_dist = dist;
				m_point = point;
			}
		}

	}

	color = color + (dot(m_point, vec2<f32>(0.3, 0.6)));
	color = color * (1. - blending * m_dist);
	return vec4<f32>(color, 1.);`
  },
  {
    name: 'voronoi',
    type: 'src',
    inputs: [
      {
        type: 'f32',
        name: 'scale',
        default: 5
      },
      {
        type: 'f32',
        name: 'speed',
        default: 0.3
      },
      {
        type: 'f32',
        name: 'blending',
        default: 0.3
      }
    ],
    glsl: `	var color: vec3<f32> = vec3<f32>(0.);
	_st = _st * (scale);
	let i_st: vec2<f32> = floor(_st);
	let f_st: vec2<f32> = fract(_st);
	var m_dist: f32 = 10.;
	var m_point: vec2<f32>;

	for (var j: i32 = -1; j <= 1; j = j + 1) {

		for (var i: i32 = -1; i <= 1; i = i + 1) {
			let neighbor: vec2<f32> = vec2<f32>(f32(i), f32(j));
			let p: vec2<f32> = i_st + neighbor;
			var point: vec2<f32> = fract(sin(vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)))) * 43758.547);
			point = 0.5 + 0.5 * sin(time * speed + 6.2831 * point);
			let diff: vec2<f32> = neighbor + point - f_st;
			let dist: f32 = length(diff);
			if (dist < m_dist) {
				m_dist = dist;
				m_point = point;
			}
		}

	}

	color = color + (dot(m_point, vec2<f32>(0.3, 0.6)));
	color = color * (1. - blending * m_dist);
	return vec4<f32>(color, 1.);`
  },
  {
    name: 'osc',
    type: 'src',
    inputs: [
      {
        type: 'f32',
        name: 'frequency',
        default: 60
      },
      {
        type: 'f32',
        name: 'sync',
        default: 0.1
      },
      {
        type: 'f32',
        name: 'offset',
        default: 0
      }
    ],
    glsl: `let st: vec2<f32> = _st;
	let r: f32 = sin((st.x - offset / frequency + time * sync) * frequency) * 0.5 + 0.5;
	let g: f32 = sin((st.x + time * sync) * frequency) * 0.5 + 0.5;
	let b: f32 = sin((st.x + offset / frequency + time * sync) * frequency) * 0.5 + 0.5;
	return vec4<f32>(r, g, b, 1.);`
  },
  {
    name: 'shape',
    type: 'src',
    inputs: [
      {
        type: 'f32',
        name: 'sides',
        default: 3
      },
      {
        type: 'f32',
        name: 'radius',
        default: 0.3
      },
      {
        type: 'f32',
        name: 'smoothing',
        default: 0.01
      }
    ],
    glsl: `let st: vec2<f32> = _st * 2. - 1.;
	let a: f32 = atan2(st.x, st.y) + 3.1416;
	let r: f32 = 2. * 3.1416 / sides;
	let d: f32 = cos(floor(0.5 + a / r) * r - a) * length(st);
	return vec4<f32>(vec3<f32>(1. - smoothstep(radius, radius + smoothing + 0.0000001, d)), 1.);`
  },
  {
    name: 'gradient',
    type: 'src',
    inputs: [
      {
        type: 'f32',
        name: 'speed',
        default: 0
      }
    ],
    glsl: `	return vec4<f32>(_st, sin(time * speed), 1.);`
  },
  {
    name: 'src',
    type: 'src',
    inputs: [
      {
        type: 'texture_2d<f32>',
        name: 'tex',
        default: 'inputTexture'
      },
      {
        type: 'sampler',
        name: 'sampler',
        default: 'textureSampler'
      }
    ],
    glsl: `	return textureSample(tex, sampler, fract(_st));`
  },
  {
    name: 'solid',
    type: 'src',
    inputs: [
      {
        type: 'f32',
        name: 'r',
        default: 0
      },
      {
        type: 'f32',
        name: 'g',
        default: 0
      },
      {
        type: 'f32',
        name: 'b',
        default: 0
      },
      {
        type: 'f32',
        name: 'a',
        default: 1
      }
    ],
    glsl: `return vec4<f32>(r, g, b, a);`
  }
] as const

export const modifierTransforms = [
  {
    name: 'rotate',
    type: 'coord',
    inputs: [
      {
        type: 'f32',
        name: 'angle',
        default: 10
      },
      {
        type: 'f32',
        name: 'speed',
        default: 0
      }
    ],
    glsl: `var xy: vec2<f32> = _st - vec2<f32>(0.5);
	let ang: f32 = angle + speed * time;
	xy = mat2x2<f32>(cos(ang), -sin(ang), sin(ang), cos(ang)) * xy;
	xy = xy + (0.5);
	return xy;`
  },
  {
    name: 'scale',
    type: 'coord',
    inputs: [
      {
        type: 'f32',
        name: 'amount',
        default: 1.5
      },
      {
        type: 'f32',
        name: 'xMult',
        default: 1
      },
      {
        type: 'f32',
        name: 'yMult',
        default: 1
      },
      {
        type: 'f32',
        name: 'offsetX',
        default: 0.5
      },
      {
        type: 'f32',
        name: 'offsetY',
        default: 0.5
      }
    ],
    glsl: `var xy: vec2<f32> = _st - vec2<f32>(offsetX, offsetY);
	xy = xy * (1. / vec2<f32>(amount * xMult, amount * yMult));
	xy = xy + (vec2<f32>(offsetX, offsetY));
	return xy;
   `
  },
  {
    name: 'pixelate',
    type: 'coord',
    inputs: [
      {
        type: 'f32',
        name: 'pixelX',
        default: 20
      },
      {
        type: 'f32',
        name: 'pixelY',
        default: 20
      }
    ],
    glsl: `let xy: vec2<f32> = vec2<f32>(pixelX, pixelY);
	return (floor(_st * xy) + 0.5) / xy;`
  },
  {
    name: 'posterize',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'bins',
        default: 3
      },
      {
        type: 'f32',
        name: 'gamma',
        default: 0.6
      }
    ],
    glsl: `var c2: vec4<f32> = pow(_c0, vec4<f32>(gamma));
	c2 = c2 * (vec4<f32>(bins));
	c2 = floor(c2);
	c2 = c2 / (vec4<f32>(bins));
	c2 = pow(c2, vec4<f32>(1. / gamma));
	return vec4<f32>(c2.xyz, _c0.a);`
  },
  {
    name: 'shift',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'r',
        default: 0.5
      },
      {
        type: 'f32',
        name: 'g',
        default: 0
      },
      {
        type: 'f32',
        name: 'b',
        default: 0
      },
      {
        type: 'f32',
        name: 'a',
        default: 0
      }
    ],
    glsl: `var c2: vec4<f32> = vec4<f32>(_c0);
	c2.r = fract(c2.r + r);
	c2.g = fract(c2.g + g);
	c2.b = fract(c2.b + b);
	c2.a = fract(c2.a + a);
	return vec4<f32>(c2.rgba);`
  },
  {
    name: 'repeat',
    type: 'coord',
    inputs: [
      {
        type: 'f32',
        name: 'repeatX',
        default: 3
      },
      {
        type: 'f32',
        name: 'repeatY',
        default: 3
      },
      {
        type: 'f32',
        name: 'offsetX',
        default: 0
      },
      {
        type: 'f32',
        name: 'offsetY',
        default: 0
      }
    ],
    glsl: `var st: vec2<f32> = _st * vec2<f32>(repeatX, repeatY);
	st.x = st.x + (step(1., ((st.y) % (2.))) * offsetX);
	st.y = st.y + (step(1., ((st.x) % (2.))) * offsetY);
	return fract(st);`
  },
  {
    name: 'modulateRepeat',
    type: 'combineCoord',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'repeatX',
        default: 3
      },
      {
        type: 'f32',
        name: 'repeatY',
        default: 3
      },
      {
        type: 'f32',
        name: 'offsetX',
        default: 0.5
      },
      {
        type: 'f32',
        name: 'offsetY',
        default: 0.5
      }
    ],
    glsl: `var st: vec2<f32> = _st * vec2<f32>(repeatX, repeatY);
	st.x = st.x + (step(1., ((st.y) % (2.))) + color.r * offsetX);
	st.y = st.y + (step(1., ((st.x) % (2.))) + color.g * offsetY);
	return fract(st);`
  },
  {
    name: 'repeatX',
    type: 'coord',
    inputs: [
      {
        type: 'f32',
        name: 'reps',
        default: 3
      },
      {
        type: 'f32',
        name: 'offset',
        default: 0
      }
    ],
    glsl: `var st: vec2<f32> = _st * vec2<f32>(reps, 1.);
	st.y = st.y + (step(1., ((st.x) % (2.))) * offset);
	return fract(st);`
  },
  {
    name: 'modulateRepeatX',
    type: 'combineCoord',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'reps',
        default: 3
      },
      {
        type: 'f32',
        name: 'offset',
        default: 0.5
      }
    ],
    glsl: `var st: vec2<f32> = _st * vec2<f32>(reps, 1.);
	st.y = st.y + (step(1., ((st.x) % (2.))) + color.r * offset);
	return fract(st);`
  },
  {
    name: 'repeatY',
    type: 'coord',
    inputs: [
      {
        type: 'f32',
        name: 'reps',
        default: 3
      },
      {
        type: 'f32',
        name: 'offset',
        default: 0
      }
    ],
    glsl: ` var st: vec2<f32> = _st * vec2<f32>(1., reps);
	st.x = st.x + (step(1., ((st.y) % (2.))) * offset);
	return fract(st);`
  },
  {
    name: 'modulateRepeatY',
    type: 'combineCoord',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'reps',
        default: 3
      },
      {
        type: 'f32',
        name: 'offset',
        default: 0.5
      }
    ],
    glsl: `var st: vec2<f32> = _st * vec2<f32>(1., reps);
	st.x = st.x + (step(1., ((st.y) % (2.))) * offset);
	return fract(st);`
  },
  {
    name: 'kaleid',
    type: 'coord',
    inputs: [
      {
        type: 'f32',
        name: 'nSides',
        default: 4
      }
    ],
    glsl: `var st: vec2<f32> = _st;
	st = st - (0.5);
	let r: f32 = length(st);
	var a: f32 = atan2(st.y, st.x);
	let pi: f32 = 2. * 3.1416;
	a = ((a) % (pi / nSides));
	a = abs(a - pi / nSides / 2.);
	return r * vec2<f32>(cos(a), sin(a));`
  },
  {
    name: 'modulateKaleid',
    type: 'combineCoord',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'nSides',
        default: 4
      }
    ],
    glsl: `let st: vec2<f32> = _st - 0.5;
	let r: f32 = length(st);
	var a: f32 = atan2(st.y, st.x);
	let pi: f32 = 2. * 3.1416;
	a = ((a) % (pi / nSides));
	a = abs(a - pi / nSides / 2.);
	return (color.r + r) * vec2<f32>(cos(a), sin(a));`
  },
  {
    name: 'scroll',
    type: 'coord',
    inputs: [
      {
        type: 'f32',
        name: 'scrollX',
        default: 0.5
      },
      {
        type: 'f32',
        name: 'scrollY',
        default: 0.5
      },
      {
        type: 'f32',
        name: 'speedX',
        default: 0
      },
      {
        type: 'f32',
        name: 'speedY',
        default: 0
      }
    ],
    glsl: `
   _st.x = _st.x + (scrollX + time * speedX);
	_st.y = _st.y + (scrollY + time * speedY);
	return fract(_st);`
  },
  {
    name: 'scrollX',
    type: 'coord',
    inputs: [
      {
        type: 'f32',
        name: 'scrollX',
        default: 0.5
      },
      {
        type: 'f32',
        name: 'speed',
        default: 0
      }
    ],
    glsl: `_st.x = _st.x + (scrollX + time * speed);
	return fract(_st);`
  },
  {
    name: 'modulateScrollX',
    type: 'combineCoord',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'scrollX',
        default: 0.5
      },
      {
        type: 'f32',
        name: 'speed',
        default: 0
      }
    ],
    glsl: `_st.x = _st.x + (color.r * scrollX + time * speed);
	return fract(_st);`
  },
  {
    name: 'scrollY',
    type: 'coord',
    inputs: [
      {
        type: 'f32',
        name: 'scrollY',
        default: 0.5
      },
      {
        type: 'f32',
        name: 'speed',
        default: 0
      }
    ],
    glsl: `_st.y = _st.y + (scrollY + time * speed);
	return fract(_st);`
  },
  {
    name: 'modulateScrollY',
    type: 'combineCoord',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'scrollY',
        default: 0.5
      },
      {
        type: 'f32',
        name: 'speed',
        default: 0
      }
    ],
    glsl: `_st.y = _st.y + (color.r * scrollY + time * speed);
	return fract(_st);`
  },
  {
    name: 'add',
    type: 'combine',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'amount',
        default: 1
      }
    ],
    glsl: `	return (_c0 + color) * amount + _c0 * (1. - amount);`
  },
  {
    name: 'sub',
    type: 'combine',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'amount',
        default: 1
      }
    ],
    glsl: `  return (_c0 - color) * amount + _c0 * (1. - amount);`
  },
  {
    name: 'layer',
    type: 'combine',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      }
    ],
    glsl: `   return vec4<f32>(mix(_c0.rgb, color.rgb, color.a), _c0.a + color.a);`
  },
  {
    name: 'blend',
    type: 'combine',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'amount',
        default: 0.5
      }
    ],
    glsl: `   return _c0 * (1. - amount) + color * amount;`
  },
  {
    name: 'mult',
    type: 'combine',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'amount',
        default: 1
      }
    ],
    glsl: `   return _c0 * (1. - amount) + _c0 * color * amount;`
  },
  {
    name: 'diff',
    type: 'combine',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      }
    ],
    glsl: `   return vec4<f32>(abs(_c0.rgb - color.rgb), max(_c0.a, color.a));`
  },
  {
    name: 'modulate',
    type: 'combineCoord',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'amount',
        default: 0.1
      }
    ],
    glsl: `   return _st + color.xy * amount;`
  },
  {
    name: 'modulateScale',
    type: 'combineCoord',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'multiple',
        default: 1
      },
      {
        type: 'f32',
        name: 'offset',
        default: 1
      }
    ],
    glsl: `   var xy: vec2<f32> = _st - vec2<f32>(0.5);
	xy = xy * (1. / vec2<f32>(offset + multiple * color.r, offset + multiple * color.g));
	xy = xy + (vec2<f32>(0.5));
	return xy;`
  },
  {
    name: 'modulatePixelate',
    type: 'combineCoord',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'multiple',
        default: 10
      },
      {
        type: 'f32',
        name: 'offset',
        default: 3
      }
    ],
    glsl: `   let xy: vec2<f32> = vec2<f32>(offset + color.x * multiple, offset + color.y * multiple);
	return (floor(_st * xy) + 0.5) / xy;`
  },
  {
    name: 'modulateRotate',
    type: 'combineCoord',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'multiple',
        default: 1
      },
      {
        type: 'f32',
        name: 'offset',
        default: 0
      }
    ],
    glsl: `   var xy: vec2<f32> = _st - vec2<f32>(0.5);
	let angle: f32 = offset + color.x * multiple;
	xy = mat2x2<f32>(cos(angle), -sin(angle), sin(angle), cos(angle)) * xy;
	xy = xy + (0.5);
	return xy;`
  },
  {
    name: 'modulateHue',
    type: 'combineCoord',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      },
      {
        type: 'f32',
        name: 'amount',
        default: 1
      }
    ],
    glsl: `   return _st + vec2<f32>(color.g - color.r, color.b - color.g) * amount * 1. / resolution;`
  },
  {
    name: 'invert',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'amount',
        default: 1
      }
    ],
    glsl: `   return vec4<f32>((1. - _c0.rgb) * amount + _c0.rgb * (1. - amount), _c0.a);`
  },
  {
    name: 'contrast',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'amount',
        default: 1.6
      }
    ],
    glsl: `   let c: vec4<f32> = (_c0 - vec4<f32>(0.5)) * vec4<f32>(amount) + vec4<f32>(0.5);
	return vec4<f32>(c.rgb, _c0.a);`
  },
  {
    name: 'brightness',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'amount',
        default: 0.4
      }
    ],
    glsl: `   return vec4<f32>(_c0.rgb + vec3<f32>(amount), _c0.a);`
  },
  {
    name: 'mask',
    type: 'combine',
    inputs: [
      {
        name: 'color',
        type: 'vec4<f32>',
        vecLen: 4
      }
    ],
    glsl: `let a: f32 = _luminance(color.rgb);
	return vec4<f32>(_c0.rgb * a, a);`
  },
  {
    name: 'luma',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'threshold',
        default: 0.5
      },
      {
        type: 'f32',
        name: 'tolerance',
        default: 0.1
      }
    ],
    glsl: `let a: f32 = smoothstep(threshold - (tolerance + 0.0000001), threshold + (tolerance + 0.0000001), _luminance(_c0.rgb));
	return vec4<f32>(_c0.rgb * a, a);`
  },
  {
    name: 'thresh',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'threshold',
        default: 0.5
      },
      {
        type: 'f32',
        name: 'tolerance',
        default: 0.04
      }
    ],
    glsl: `return vec4<f32>(vec3<f32>(smoothstep(threshold - (tolerance + 0.0000001), threshold + (tolerance + 0.0000001), _luminance(_c0.rgb))), _c0.a);`
  },
  {
    name: 'color',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'r',
        default: 1
      },
      {
        type: 'f32',
        name: 'g',
        default: 1
      },
      {
        type: 'f32',
        name: 'b',
        default: 1
      },
      {
        type: 'f32',
        name: 'a',
        default: 1
      }
    ],
    glsl: `let c: vec4<f32> = vec4<f32>(r, g, b, a);
	let pos: vec4<f32> = step(vec4<f32>(0.), c);
	return vec4<f32>(mix((1. - _c0) * abs(c), c * _c0, pos));`
  },
  {
    name: 'saturate',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'amount',
        default: 2
      }
    ],
    glsl: `let W: vec3<f32> = vec3<f32>(0.2125, 0.7154, 0.0721);
	let intensity: vec3<f32> = vec3<f32>(dot(_c0.rgb, W));
	return vec4<f32>(mix(intensity, _c0.rgb, amount), _c0.a);`
  },
  {
    name: 'hue',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'hue',
        default: 0.4
      }
    ],
    glsl: `var c: vec3<f32> = _rgbToHsv(_c0.rgb);
	c.r = c.r + (hue);
	return vec4<f32>(_hsvToRgb(c), _c0.a);`
  },
  {
    name: 'colorama',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'amount',
        default: 0.005
      }
    ],
    glsl: `var c: vec3<f32> = _rgbToHsv(_c0.rgb);
	c = c + (vec3<f32>(amount));
	c = _hsvToRgb(c);
	c = fract(c);
	return vec4<f32>(c, _c0.a);`
  },
  {
    name: 'sum',
    type: 'color',
    inputs: [
      {
        type: 'vec4<f32>',
        name: 'scale',
        default: 1
      }
    ],
    glsl: `var v: vec4<f32> = _c0 * s;
	return v.r + v.g + v.b + v.a;
} 

fn sum(_st: vec2<f32>, s: vec4<f32>) -> f32 {
	let v: vec2<f32> = _st.xy * s.xy;
	return v.x + v.y;
} `
  },
  {
    name: 'r',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'scale',
        default: 1
      },
      {
        type: 'f32',
        name: 'offset',
        default: 0
      }
    ],
    glsl: `return vec4<f32>(_c0.r * scale + offset);`
  },
  {
    name: 'g',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'scale',
        default: 1
      },
      {
        type: 'f32',
        name: 'offset',
        default: 0
      }
    ],
    glsl: `return vec4<f32>(_c0.g * scale + offset);`
  },
  {
    name: 'b',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'scale',
        default: 1
      },
      {
        type: 'f32',
        name: 'offset',
        default: 0
      }
    ],
    glsl: `return vec4<f32>(_c0.b * scale + offset);`
  },
  {
    name: 'a',
    type: 'color',
    inputs: [
      {
        type: 'f32',
        name: 'scale',
        default: 1
      },
      {
        type: 'f32',
        name: 'offset',
        default: 0
      }
    ],
    glsl: `return vec4<f32>(_c0.a * scale + offset);`
  }
] as const
