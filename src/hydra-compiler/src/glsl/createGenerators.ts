import {
  ProcessedTransformDefinition,
  TransformDefinition,
  TransformDefinitionType
} from './transformDefinitions.js'
import { Glsl } from './Glsl'
import ImmutableList from './ImmutableList.js'

type Generator = (...args: unknown[]) => Glsl

export function createTransformChainClass<
  T extends readonly TransformDefinition[]
>(modifierTransforms: T): typeof Glsl {
  const sourceClass = class extends Glsl {}

  for (const transform of modifierTransforms) {
    const processed = processGlsl(transform)

    addTransformChainMethod(sourceClass, processed)
  }

  return sourceClass
}

export function createGenerator(
  generatorTransform: TransformDefinition,
  TransformChainClass: typeof Glsl
): Generator {
  const processed = processGlsl(generatorTransform)

  return (...args: unknown[]) =>
    new TransformChainClass(
      new ImmutableList({
        transform: processed,
        userArgs: args
      })
    )
}

export function createGenerators(
  generatorTransforms: readonly TransformDefinition[],
  sourceClass: typeof Glsl
): Record<string, Generator> {
  const generatorMap: Record<string, Generator> = {}

  for (const transform of generatorTransforms) {
    generatorMap[transform.name] = createGenerator(transform, sourceClass)
  }

  return generatorMap
}

export function addTransformChainMethod(
  cls: typeof Glsl,
  processedTransformDefinition: ProcessedTransformDefinition
) {
  function addTransformApplicationToInternalChain(
    this: Glsl,
    ...args: unknown[]
  ): Glsl {
    const transform = {
      transform: processedTransformDefinition,
      userArgs: args
    }

    return new cls(this.transforms.append(transform))
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
    ...transformDefinition.inputs.map(input => `${input.name}: ${input.type}`)
  ].join(', ')

  const glslFunction = `
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
