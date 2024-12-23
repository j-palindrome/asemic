import { IPt, Pt } from 'pts'
import { Vector2 } from 'three'

export class PtBuilder extends Pt {
  strength?: CoordinateSettings['strength']
  color?: CoordinateSettings['color']
  alpha?: CoordinateSettings['alpha']
  thickness?: CoordinateSettings['thickness']

  toVector2() {
    return new Vector2(this.x, this.y)
  }

  $lerp(other: PtBuilder, amount: number) {
    return this.$add(other.$subtract(this).multiply(amount))
  }

  lerp(other: PtBuilder, amount: number): this {
    return this.add(other.$subtract(this).multiply(amount))
  }

  constructor(...args: Array<number | number[] | IPt | Float32Array>) {
    super(...args)
  }
}
