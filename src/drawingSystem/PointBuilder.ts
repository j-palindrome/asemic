import { Vector2 } from 'three'
import Builder from './Builder'
const vector = new Vector2()
const vector2 = new Vector2()

export class PointBuilder extends Vector2 {
  strength: TransformData['strength'] = 1
  color: TransformData['color'] = [1, 1, 1]
  alpha: TransformData['alpha'] = 1
  thickness: TransformData['thickness'] = 1

  constructor(
    x: number,
    y: number,
    { strength, color, alpha, thickness }: Partial<CoordinateData>
  ) {
    super(x, y)
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
    return new PointBuilder([
      this.x,
      this.y,
      {
        strength: this.strength,
        color: this.color,
        alpha: this.alpha,
        thickness: this.thickness
      }
    ]) as this
  }
}
