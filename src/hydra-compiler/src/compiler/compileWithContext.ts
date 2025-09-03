import { Precision } from '../Hydra'
import { TypedArg } from './formatArguments'
import { utilityFunctions } from '../glsl/utilityFunctions'
import { TransformApplication } from '../glsl/Glsl'
import { generateGlsl } from './generateGlsl'

export interface TransformApplicationContext {
  defaultUniforms?: {
    [name: string]: any
  }
  precision: Precision
}

export type CompiledTransform = {
  frag: string
  uniforms: {
    [name: string]:
      | string
      | ((context: any, props: any) => number | number[])
      | undefined
  }
}

export interface ShaderParams {
  uniforms: TypedArg[]
  transformApplications: TransformApplication[]
  fragColor: string
}

export function compileWithContext(
  transformApplications: TransformApplication[],
  context: TransformApplicationContext
): CompiledTransform {
  const shaderParams = compileGlsl(transformApplications)

  const uniforms: Record<TypedArg['name'], TypedArg['value']> = {}
  shaderParams.uniforms.forEach(uniform => {
    uniforms[uniform.name] = uniform.value
  })

  const frag = `
  ${Object.values(shaderParams.uniforms)
    .map(uniform => {
      return `@group(0) @binding(${uniform.binding || 0}) var<uniform> ${
        uniform.name
      }: ${uniform.type};`
    })
    .join('\n')}
  @group(0) @binding(1) var<uniform> time: f32;
  @group(0) @binding(2) var<uniform> resolution: vec2<f32>;

  ${Object.values(utilityFunctions)
    .map(transform => {
      return `
            ${transform.glsl}
          `
    })
    .join('')}

  ${shaderParams.transformApplications
    .map(transformApplication => {
      return `
            ${transformApplication.transform.glsl}
          `
    })
    .join('')}

  @vertex
  fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var pos = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0),
      vec2<f32>( 1.0, -1.0),
      vec2<f32>(-1.0,  1.0),
      vec2<f32>( 1.0, -1.0),
      vec2<f32>( 1.0,  1.0),
      vec2<f32>(-1.0,  1.0)
    );
    return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  }

  @fragment
  fn fs_main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
    var c = vec4<f32>(1.0, 0.0, 0.0, 1.0);
    var st = fragCoord.xy / resolution.xy;
    return ${shaderParams.fragColor};
  }
  `

  return {
    frag: frag,
    uniforms: { ...context.defaultUniforms, ...uniforms }
  }
}

export function compileGlsl(
  transformApplications: TransformApplication[]
): ShaderParams {
  const shaderParams: ShaderParams = {
    uniforms: [],
    transformApplications: [],
    fragColor: ''
  }

  // Note: generateGlsl() also mutates shaderParams.transformApplications
  shaderParams.fragColor = generateGlsl(
    transformApplications,
    shaderParams
  )('st')

  // remove uniforms with duplicate names
  let uniforms: Record<string, TypedArg> = {}
  shaderParams.uniforms.forEach(uniform => (uniforms[uniform.name] = uniform))
  shaderParams.uniforms = Object.values(uniforms)

  return shaderParams
}
