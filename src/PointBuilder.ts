import { Vector2 } from 'three'
import Builder from './Builder'
const vector = new Vector2()
const vector2 = new Vector2()

export class PointBuilder extends Vector2 {
  strength: TransformData['strength']
  color: TransformData['color']
  alpha: TransformData['alpha']
  thickness: TransformData['thickness']

  constructor(
    x: number,
    y: number,
    { strength, color, alpha, thickness }: Partial<CoordinateData> = {}
  ) {
    super(x, y)
    this.strength = strength ?? 1
    this.color = color ?? [0, 0, 0]
    this.alpha = alpha ?? 1
    this.thickness = thickness ?? 1
  }

  lerpRandom(point: Vector2) {
    const difference = point.clone().sub(this)
    this.randomize(difference)
    return this
  }

  randomize(point: Vector2) {
    this.add({
      x: point[0] * Math.random() - point[0] / 2,
      y: point[1] * Math.random() - point[1] / 2
    })
    return this
  }

  override clone() {
    return new PointBuilder(this.x, this.y, {
      strength: this.strength,
      color: this.color,
      alpha: this.alpha,
      thickness: this.thickness
    }) as this
  }
}
