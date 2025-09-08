import { ProcessedTransformDefinition } from './transformDefinitions'

export interface TransformApplication {
  transform: ProcessedTransformDefinition
  userArgs: unknown[]
}

export class Glsl {
  transforms: TransformApplication[]

  constructor(transformApplication: TransformApplication) {
    this.transforms = [transformApplication]
  }

  // out(output: Output) {
  //   output.render(this.transforms);
  // }
}
