import { CurvePath, LineCurve, QuadraticBezierCurve, Vector2 } from 'three'
import { PointBuilder } from '../drawingSystem/PointBuilder'

export default class Drawing {
  curves: PointBuilder[][]
  generate: (b: Drawing) => Drawing
  transformData: TransformData = this.toTransform()

  points() {}

  protected toTransform(
    transform?: CoordinateData | TransformData
  ): TransformData {
    if (!transform) {
      return {
        scale: new PointBuilder([1, 1]),
        rotate: 0,
        translate: new PointBuilder()
      }
    }
    return {
      scale:
        typeof transform.scale === 'number'
          ? new PointBuilder([transform.scale, transform.scale])
          : transform.scale instanceof Array
          ? new PointBuilder(transform.scale)
          : transform.scale ?? new PointBuilder([1, 1]),
      rotate: (transform.rotate ?? 0) * Math.PI * 2,
      translate:
        transform.translate instanceof Vector2
          ? transform.translate
          : new PointBuilder(transform.translate)
    }
  }

  protected applyTransform<T extends Vector2 | TransformData>(
    vector: T,
    transformData: TransformData | CoordinateData,
    invert: boolean = false
  ): T {
    const newTransform = this.toTransform(transformData)
    if (vector instanceof Vector2) {
      if (invert) {
        vector
          .sub(newTransform.translate)
          .rotateAround({ x: 0, y: 0 }, -newTransform.rotate)
          .divide(newTransform.scale)
      } else {
        vector
          .multiply(newTransform.scale)
          .rotateAround({ x: 0, y: 0 }, newTransform.rotate)
          .add(newTransform.translate)
      }
    } else {
      if (invert) {
        vector.translate.sub(
          newTransform.translate
            .divide(vector.scale)
            .rotateAround({ x: 0, y: 0 }, -vector.rotate)
        )
        vector.rotate -= newTransform.rotate
        vector.scale.divide(newTransform.scale)
      } else {
        vector.translate.add(
          newTransform.translate
            .multiply(vector.scale)
            .rotateAround({ x: 0, y: 0 }, newTransform.rotate)
        )
        vector.rotate += newTransform.rotate
        vector.scale.multiply(newTransform.scale)
      }
    }

    return vector
  }

  transform(transformData: TransformData | CoordinateData) {
    this.applyTransform(this.transformData, transformData)
  }

  toPoint(coordinate: Coordinate | PointBuilder) {
    if (coordinate instanceof PointBuilder) return coordinate
    if (coordinate[2]) {
      this.transform(coordinate[2])
    }

    return this.applyTransform(
      new PointBuilder([coordinate[0], coordinate[1]], coordinate[2]),
      this.transformData
    )
  }

  protected interpolateCurve(
    curve: PointBuilder[],
    controlPointsCount: number
  ) {
    const newCurve = this.makeCurvePath(curve)

    const newCurvePoints: PointBuilder[] = []
    for (let i = 0; i < controlPointsCount; i++) {
      const u = i / (controlPointsCount - 1)
      newCurvePoints.push(
        new PointBuilder(newCurve.getPointAt(u).toArray() as [number, number])
      )

      curve.splice(0, curve.length, ...newCurvePoints)
    }
  }

  protected makeCurvePath(curve: PointBuilder[]): CurvePath<Vector2> {
    const path: CurvePath<Vector2> = new CurvePath()
    if (curve.length <= 1) {
      throw new Error(`Curve length is ${curve.length}`)
    }
    if (curve.length == 2) {
      path.add(new LineCurve(curve[0], curve[1]))
      return path
    }
    for (let i = 0; i < curve.length - 2; i++) {
      if (curve[i + 1].strength > 0.5) {
        path.add(
          new LineCurve(
            i === 0 ? curve[i] : curve[i].clone().lerp(curve[i + 1], 0.5),
            curve[i + 1]
          )
        )
        path.add(
          new LineCurve(
            curve[i + 1],
            i === curve.length - 3
              ? curve[i + 2]
              : curve[i + 1].clone().lerp(curve[i + 2], 0.5)
          )
        )
      } else {
        path.add(
          new QuadraticBezierCurve(
            i === 0 ? curve[i] : curve[i].clone().lerp(curve[i + 1], 0.5),
            curve[i + 1],
            i === curve.length - 3
              ? curve[i + 2]
              : curve[i + 1].clone().lerp(curve[i + 2], 0.5)
          )
        )
      }
    }
    return path
  }

  shape(
    points: 2 | 3 | 4 | 5 | 6,
    { out = 0.5, width = 1, height = 1, up = 0, into = 0 } = {}
  ) {
    let curve: [number, number][] =
      points === 2
        ? [
            [0, 0],
            [width, height]
          ]
        : points === 3
        ? [
            [0, 0],
            [out, height * 2],
            [width, up]
          ]
        : points === 4
        ? [
            [0, 0],
            [width / 2 - out, height - up],
            [width / 2 + out, height],
            [width, 0]
          ]
        : points === 5
        ? [
            [0, 0],
            [-out, up + height / 2],
            [width / 2, height],
            [width + out, up + height / 2],
            [width, 0]
          ]
        : [
            [0, 0],
            [-out, up],
            [-out + into, height],
            [width + out - into, height],
            [width + out, up],
            [width, 0]
          ]
    this.curves.push(curve.map(x => this.toPoint(new PointBuilder(x))))
    return this
  }

  constructor(generate: Drawing['generate']) {
    this.generate = generate
    this.generate(this)
  }
}
