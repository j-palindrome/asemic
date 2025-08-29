import { GlEnvironment } from '../Hydra'
import { TypedArg } from './formatArguments'
import { utilityFunctions } from '../glsl/utilityFunctions'
import { TransformApplication } from '../glsl/Glsl'
import { DynamicVariable, DynamicVariableFn, Texture2D, Uniform } from 'regl'
import { generateGlsl } from './generateGlsl'

export type CompiledTransform = {
  frag: string
  uniforms: {
    [name: string]:
      | string
      | Uniform
      | ((context: any, props: any) => number | number[])
      | Texture2D
      | DynamicVariable<any>
      | DynamicVariableFn<any, any, any>
      | undefined
  }
}

export interface ShaderParams {
  uniforms: TypedArg[]
  transformApplications: TransformApplication[]
  fragColor: string
  includes: string
}

export function compileWithEnvironment(
  transformApplications: TransformApplication[],
  environment: GlEnvironment
): CompiledTransform {
  const shaderParams = compileGlsl(transformApplications)

  const uniforms: Record<TypedArg['name'], TypedArg['value']> = {}
  shaderParams.uniforms.forEach(uniform => {
    uniforms[uniform.name] = uniform.value
  })

  const frag = `
  precision ${environment.precision} float;
  ${Object.values(shaderParams.uniforms)
    .map(uniform => {
      return `
      uniform ${uniform.type} ${uniform.name};`
    })
    .join('')}
  uniform float time;
  uniform vec2 resolution;
  varying vec2 uv;

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

  void main () {
    vec4 c = vec4(1, 0, 0, 1);
    vec2 st = gl_FragCoord.xy/resolution.xy;
    gl_FragColor = ${shaderParams.fragColor};
  }
  `

  return {
    frag: frag,
    uniforms: { ...environment.defaultUniforms, ...uniforms }
  }
}

export function compileGlsl(
  transformApplications: TransformApplication[]
): ShaderParams {
  const shaderParams: ShaderParams = {
    uniforms: [],
    transformApplications: [],
    fragColor: '',
    includes: ''
  }

  // Note: generateGlsl() also mutates shaderParams.transformApplications
  shaderParams.fragColor = generateGlsl(
    transformApplications,
    shaderParams
  )('st')

  shaderParams.includes = shaderParams.transformApplications
    .map(transformApplication => {
      return `
            ${transformApplication.transform.glsl}
          `
    })
    .join('')

  // remove uniforms with duplicate names
  const uniforms: Record<string, TypedArg> = {}
  shaderParams.uniforms.forEach(uniform => (uniforms[uniform.name] = uniform))
  shaderParams.uniforms = Object.values(uniforms)

  return shaderParams
}
