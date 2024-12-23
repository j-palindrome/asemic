import { GroupBuilder } from './GroupBuilder'
import { PtBuilder } from './PtBuilder'

export default class Drawing {
  groups: GroupBuilder[]
  generate: (b: Drawing) => (([number, number] | PtBuilder)[] | GroupBuilder)[]

  initialize() {
    this.groups = this.generate(this).map(group =>
      group instanceof GroupBuilder ? group : new GroupBuilder(...group)
    )
  }

  constructor(generate: Drawing['generate']) {
    this.generate = generate
    this.initialize()
  }
}
