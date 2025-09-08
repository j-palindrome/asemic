import { createGenerators } from './src/glsl/createGenerators'
import {
  generatorTransforms,
  modifierTransforms
} from './src/glsl/transformDefinitions'

export const { gradient, noise, osc, shape, solid, src, voronoi } =
  createGenerators({
    generatorTransforms,
    modifierTransforms
  })

export { compileWithContext } from './src/compiler/compileWithContext'
