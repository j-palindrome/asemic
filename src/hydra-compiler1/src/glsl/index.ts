import { createTransformChainClass, createGenerators } from './createGenerators'
import { generatorTransforms, modifierTransforms } from './transformDefinitions'
import { compileGlsl } from '../compiler/compileWithEnvironment'
import { utilityFunctions } from './utilityFunctions'

const TransformChainClass = createTransformChainClass(modifierTransforms)
const rawGenerators = createGenerators(generatorTransforms, TransformChainClass)

export function toFragmentShader(generatorFn: (...args: any[]) => any) {
  return (...args: any[]) => {
    const glslObj = generatorFn(...args)
    const shaderParams = compileGlsl(glslObj.transforms.toArray())

    return shaderParams
  }
}

export const gradient = rawGenerators.gradient
export const noise = rawGenerators.noise
export const osc = rawGenerators.osc
export const shape = rawGenerators.shape
export const solid = rawGenerators.solid
export const src = rawGenerators.src
export const voronoi = rawGenerators.voronoi
