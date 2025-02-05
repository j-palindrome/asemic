import { Vector2 } from 'three'

const bezierJS = (t: number, p0: Vector2, p1: Vector2, p2: Vector2) => {
  const tInverse = 1 - t
  const test = new Vector2()
  const test2 = new Vector2()
  return test
    .copy(p0)
    .multiplyScalar(tInverse ** 2)
    .add(test2.copy(p1).multiplyScalar(2 * tInverse * t))
    .add(test2.copy(p2).multiplyScalar(t ** 2))
}

export const multiBezierJS = (t: number, ...points: Vector2[]) => {
  const subdivisions = points.length - 2
  const progress = t * subdivisions // 0 -> numSubdivisions
  const startCurve = Math.floor(progress)
  const p1 = points[startCurve + 1]
  const p0 =
    startCurve > 1
      ? points[startCurve].clone().lerp(p1, 0.5)
      : points[startCurve]
  const p2 =
    startCurve === points.length - 3
      ? points[startCurve + 2].clone().lerp(p1, 0.5)
      : points[startCurve + 2]
  return bezierJS(progress % 1, p0, p1, p2)
}
