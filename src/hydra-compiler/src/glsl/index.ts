import { createTransformChainClass, createGenerators } from './createGenerators'
import { generatorTransforms, modifierTransforms } from './transformDefinitions'
import { compileGlsl } from '../compiler/compileWithEnvironment'
import { utilityFunctions } from './utilityFunctions'

const TransformChainClass = createTransformChainClass(modifierTransforms)
const rawGenerators = createGenerators(generatorTransforms, TransformChainClass)

function toFragmentShader(generatorFn: (...args: any[]) => any) {
  return (...args: any[]) => {
    const glslObj = generatorFn(...args)
    const shaderParams = compileGlsl(glslObj.transforms.toArray())

    return shaderParams
  }
}

export const gradient = toFragmentShader(rawGenerators.gradient)
export const noise = toFragmentShader(rawGenerators.noise)
export const osc = toFragmentShader(rawGenerators.osc)
export const shape = toFragmentShader(rawGenerators.shape)
export const solid = toFragmentShader(rawGenerators.solid)
export const src = toFragmentShader(rawGenerators.src)
export const voronoi = toFragmentShader(rawGenerators.voronoi)
