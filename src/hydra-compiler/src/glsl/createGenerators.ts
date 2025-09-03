import {
  ProcessedTransformDefinition,
  TransformDefinition,
  TransformDefinitionType
} from './transformDefinitions.js'
import { Glsl } from './Glsl'

type GeneratorMap = Record<string, (...args: unknown[]) => Glsl>

export function createGenerators({
  generatorTransforms,
  modifierTransforms
}: {
  generatorTransforms: readonly TransformDefinition[]
  modifierTransforms: readonly TransformDefinition[]
}): GeneratorMap {
  const sourceClass = class extends Glsl {}
  const generatorMap: GeneratorMap = {}

  for (const transform of generatorTransforms) {
    const processed = processGlsl(transform)

    generatorMap[processed.name] = (...args: unknown[]) =>
      new sourceClass({
        transform: processed,
        userArgs: args
      })
  }

  for (const transform of modifierTransforms) {
    const processed = processGlsl(transform)

    createTransformOnPrototype(sourceClass, processed)
  }

  return generatorMap
}

export function createTransformOnPrototype(
  cls: typeof Glsl,
  processedTransformDefinition: ProcessedTransformDefinition
) {
  function addTransformApplicationToInternalChain(
    this: Glsl,
    ...args: unknown[]
  ): Glsl {
    this.transforms.push({
      transform: processedTransformDefinition,
      userArgs: args
    })

    return this
  }

  // @ts-ignore
  cls.prototype[processedTransformDefinition.name] =
    addTransformApplicationToInternalChain
}

const typeLookup: Record<
  TransformDefinitionType,
  { returnType: string; implicitFirstArg: string }
> = {
  src: {
    returnType: 'vec4<f32>',
    implicitFirstArg: '_st: vec2<f32>'
  },
  coord: {
    returnType: 'vec2<f32>',
    implicitFirstArg: '_st: vec2<f32>'
  },
  color: {
    returnType: 'vec4<f32>',
    implicitFirstArg: '_c0: vec4<f32>'
  },
  combine: {
    returnType: 'vec4<f32>',
    implicitFirstArg: '_c0: vec4<f32>'
  },
  combineCoord: {
    returnType: 'vec2<f32>',
    implicitFirstArg: '_st: vec2<f32>'
  }
}

export function processGlsl(
  transformDefinition: TransformDefinition
): ProcessedTransformDefinition {
  const { implicitFirstArg, returnType } = typeLookup[transformDefinition.type]

  const signature = [
    implicitFirstArg,
    ...transformDefinition.inputs.map(input => `${input.type} ${input.name}`)
  ].join(', ')

  let glslFunction = `
  fn ${transformDefinition.name}(${signature}) -> ${returnType} {
      ${transformDefinition.glsl}
  }
`

  return {
    ...transformDefinition,
    glsl: glslFunction,
    processed: true
  }
}
