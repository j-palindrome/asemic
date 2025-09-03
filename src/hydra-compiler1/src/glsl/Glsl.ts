import ImmutableList from './ImmutableList'
import { ProcessedTransformDefinition } from './transformDefinitions'

export interface TransformApplication {
  transform: ProcessedTransformDefinition
  userArgs: unknown[]
}

export class Glsl {
  transforms: ImmutableList<TransformApplication>

  constructor(transforms: ImmutableList<TransformApplication>) {
    this.transforms = transforms
  }
}
