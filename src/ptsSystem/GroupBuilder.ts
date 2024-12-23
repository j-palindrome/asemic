import { Group, Pt } from 'pts'
import { PtBuilder } from './PtBuilder'
import { CurvePath, LineCurve, QuadraticBezierCurve, Vector2 } from 'three'
import { Jitter } from '../Brush'

const settings: {
  spacing: number
  defaults: Jitter
  recalculate: boolean | ((progress: number) => number)
  modifyPosition: string
  modifyColor: string
  modifyIncludes: string
} & CoordinateSettings = {
  defaults: {
    size: [1, 1],
    hsl: [100, 100, 100],
    a: 100,
    position: [0, 0],
    rotation: 0
  },
  modifyPosition: `return position;`,
  modifyIncludes: ``,
  modifyColor: `return color;`,
  spacing: 1,
  recalculate: false,
  strength: 0,
  thickness: 1,
  color: [1, 1, 1],
  alpha: 1
}

export class GroupBuilder extends Group {
  curvePath?: CurvePath<Vector2>
  settings: {
    degree: 2 | 1
  } = { degree: 1 }

  rad(rotation: number) {
    return this.rotate2D(rotation * Math.PI * 2)
  }

  getArcLength() {
    let arcLength = 0
    for (let i = 0; i < this.length - 1; i++) {
      arcLength += this.at(i)
        .$subtract(this.at(i + 1))
        .magnitude()
    }
    return arcLength
  }

  protected toCurvePath(): CurvePath<Vector2> {
    // NOTE: will only run once, if the curve is changed do I need to recompute?
    if (this.curvePath) return this.curvePath
    this.curvePath = new CurvePath()
    if (this.length <= 1) {
      throw new Error(`Curve length is ${this.length}`)
    }

    if (this.length == 2) {
      this.curvePath.add(
        new LineCurve(this.at(0).toVector2(), this.at(1).toVector2())
      )
      return this.curvePath
    }
    for (let i = 0; i < this.length - 2; i++) {
      if ((this.at(i + 1).strength ?? settings.strength) > 0.5) {
        this.curvePath.add(
          new LineCurve(
            (i === 0 ? this.at(i) : this.at(i).$lerp(this.at(i + 1), 0.5),
            this.at(i + 1)).toVector2()
          )
        )
        this.curvePath.add(
          new LineCurve(
            this.at(i + 1).toVector2(),
            (i === this.length - 3
              ? this.at(i + 2)
              : this.at(i + 1).$lerp(this.at(i + 2), 0.5)
            ).toVector2()
          )
        )
      } else {
        this.curvePath.add(
          new QuadraticBezierCurve(
            (i === 0
              ? this.at(i)
              : this.at(i).$lerp(this.at(i + 1), 0.5)
            ).toVector2(),
            this.at(i + 1).toVector2(),
            (i === this.length - 3
              ? this.at(i + 2)
              : this.at(i + 1).$lerp(this.at(i + 2), 0.5)
            ).toVector2()
          )
        )
      }
    }
    return this.curvePath
  }

  setLength(controlPointsCount: number) {
    const newCurve = this.toCurvePath()
    const newCurvePoints: PtBuilder[] = []
    for (let i = 0; i < controlPointsCount; i++) {
      const u = i / (controlPointsCount - 1)
      newCurvePoints.push(
        new PtBuilder(newCurve.getPointAt(u).toArray() as [number, number])
      )

      this.splice(0, this.length, ...newCurvePoints)
    }
  }

  set(settings: Partial<GroupBuilder['settings']>) {
    Object.assign(this.settings, settings)
    return this
  }

  within(origin: [number, number], bounds: [number, number]) {
    const bound = this.boundingBox()
    const size = bound[1].$subtract(bound[0])
    const center = bound[0].$add(bound[1]).divide(0.5)

    const scaled = this.scale(new Pt(bounds).divide(size), bound[0])
    // .subtract(
    //   new Pt(origin).subtract(bound[0])
    // )
    console.log(scaled)

    return scaled
  }

  constructor(...args: ([number, number] | PtBuilder)[]) {
    super(...args.map(x => new PtBuilder(x)))
  }
}
