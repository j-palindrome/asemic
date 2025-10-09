/**
 * Drawing Methods for AssemblyScript
 *
 * Generates geometric primitives and curves
 */

import { Point, Transform, Progress } from './types'
import { ExpressionEvaluator } from './expressions'

/** Curve builder - manages points in a curve */
export class CurveBuilder {
  points: Point[]
  currentTransform: Transform
  evaluator: ExpressionEvaluator

  constructor(evaluator: ExpressionEvaluator) {
    this.points = []
    this.currentTransform = new Transform()
    this.evaluator = evaluator
  }

  /** Add a point to the current curve */
  addPoint(x: f64, y: f64): void {
    const pt = new Point(x, y)
    this.currentTransform.apply(pt)
    this.points.push(pt)
    this.evaluator.progress.point++
  }

  /** Get all points and reset */
  flush(): Point[] {
    const result = this.points
    this.points = []
    return result
  }

  /** Clear all points */
  clear(): void {
    this.points = []
  }
}

/** Drawing functions */
export class DrawingMethods {
  evaluator: ExpressionEvaluator
  builder: CurveBuilder

  constructor(evaluator: ExpressionEvaluator) {
    this.evaluator = evaluator
    this.builder = new CurveBuilder(evaluator)
  }

  /** Triangle: tri(x, y, size) or tri(x, y, w, h) */
  tri(x: f64, y: f64, w: f64, h: f64 = -1): Point[] {
    if (h < 0) h = w

    const hw = w / 2
    const hh = h / 2

    // Three points of triangle (pointing up)
    this.builder.addPoint(x, y - hh) // Top
    this.builder.addPoint(x - hw, y + hh) // Bottom left
    this.builder.addPoint(x, y + hh) // Bottom center
    this.builder.addPoint(x + hw, y + hh) // Bottom right
    this.builder.addPoint(x, y - hh) // Back to top

    return this.builder.flush()
  }

  /** Square: squ(x, y, size) or squ(x, y, w, h) */
  squ(x: f64, y: f64, w: f64, h: f64 = -1): Point[] {
    if (h < 0) h = w

    const hw = w / 2
    const hh = h / 2

    // Four corners of square
    this.builder.addPoint(x - hw, y - hh) // Top left
    this.builder.addPoint(x - hw, y + hh) // Bottom left
    this.builder.addPoint(x + hw, y + hh) // Bottom right
    this.builder.addPoint(x + hw, y - hh) // Top right
    this.builder.addPoint(x - hw, y - hh) // Back to top left

    return this.builder.flush()
  }

  /** Pentagon: pen(sides, x, y, w, h) */
  pen(sides: i32, x: f64, y: f64, w: f64, h: f64 = -1): Point[] {
    if (h < 0) h = w

    const hw = w / 2
    const hh = h / 2

    // Generate points around a circle
    for (let i: i32 = 0; i <= sides; i++) {
      const angle = (f64(i) / f64(sides)) * Math.PI * 2 - Math.PI / 2
      const px = x + Math.cos(angle) * hw
      const py = y + Math.sin(angle) * hh
      this.builder.addPoint(px, py)
    }

    return this.builder.flush()
  }

  /** Hexagon: hex(x, y, w, h) */
  hex(x: f64, y: f64, w: f64, h: f64 = -1): Point[] {
    return this.pen(6, x, y, w, h)
  }

  /** Circle: circle(x, y, w, h, segments = 8) */
  circle(x: f64, y: f64, w: f64, h: f64 = -1, segments: i32 = 8): Point[] {
    if (h < 0) h = w

    const hw = w / 2
    const hh = h / 2

    // Generate points around ellipse
    for (let i: i32 = 0; i <= segments; i++) {
      const angle = (f64(i) / f64(segments)) * Math.PI * 2
      const px = x + Math.cos(angle) * hw
      const py = y + Math.sin(angle) * hh
      this.builder.addPoint(px, py)
    }

    return this.builder.flush()
  }

  /** Sequence: seq(count, x, y, xStep, yStep) */
  seq(count: i32, x: f64, y: f64, xStep: f64, yStep: f64): Point[] {
    for (let i: i32 = 0; i < count; i++) {
      this.builder.addPoint(x + f64(i) * xStep, y + f64(i) * yStep)
    }

    return this.builder.flush()
  }

  /** Line: line(x1, y1, x2, y2, segments = 2) */
  line(x1: f64, y1: f64, x2: f64, y2: f64, segments: i32 = 2): Point[] {
    for (let i: i32 = 0; i <= segments; i++) {
      const t = f64(i) / f64(segments)
      const px = x1 + (x2 - x1) * t
      const py = y1 + (y2 - y1) * t
      this.builder.addPoint(px, py)
    }

    return this.builder.flush()
  }

  /** Map curve - interpolate along existing curve */
  mapCurve(progress: f64, sourceCurve: Point[]): Point {
    const count = sourceCurve.length
    if (count === 0) {
      return new Point(0, 0)
    }
    if (count === 1) {
      return sourceCurve[0].clone()
    }

    // Clamp progress
    let p = progress
    if (p >= 1) p = 0.999
    else if (p < 0) p = 0

    // Quadratic bezier interpolation
    const index = (count - 2) * p
    const start = i32(Math.floor(index))
    const localT = index - f64(start)

    if (start + 2 >= count) {
      return sourceCurve[count - 1].clone()
    }

    const p0 = sourceCurve[start]
    const p1 = sourceCurve[start + 1]
    const p2 = sourceCurve[start + 2]

    // Quadratic Bezier: B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
    const t = localT
    const u = 1 - t
    const uu = u * u
    const tt = t * t
    const ut2 = 2 * u * t

    return new Point(
      uu * p0.x + ut2 * p1.x + tt * p2.x,
      uu * p0.y + ut2 * p1.y + tt * p2.y
    )
  }

  /** Calculate tangent angle at point on curve */
  tangent(progress: f64, curve: Point[]): f64 {
    const count = curve.length
    if (count < 3) {
      return 0
    }

    let p = progress
    if (p >= 1) p = 0.999
    else if (p < 0) p = 0

    const index = (count - 2) * p
    const start = i32(Math.floor(index))
    const localT = index - f64(start)

    if (start + 2 >= count) {
      return 0
    }

    const p0 = curve[start]
    const p1 = curve[start + 1]
    const p2 = curve[start + 2]

    // Quadratic Bezier tangent: B'(t) = 2(1-t)(P₁ - P₀) + 2t(P₂ - P₁)
    const t = localT
    const u = 1 - t

    const tangentX = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x)
    const tangentY = 2 * u * (p1.y - p0.y) + 2 * t * (p2.y - p1.y)

    // Normalize and return angle (0-1)
    const magnitude = Math.sqrt(tangentX * tangentX + tangentY * tangentY)
    if (magnitude === 0) {
      return 0
    }

    const angle = Math.atan2(tangentY, tangentX)
    return (angle + Math.PI) / (2 * Math.PI)
  }
}

/** Helper: Interpolate curve with specified number of points */
export function interpolateCurve(source: Point[], targetCount: i32): Point[] {
  if (source.length === 0) {
    return []
  }
  if (source.length >= targetCount || targetCount <= 0) {
    return source
  }

  const result: Point[] = []

  // If source has 1 or 2 points, just duplicate
  if (source.length <= 2) {
    for (let i: i32 = 0; i < targetCount; i++) {
      result.push(source[source.length - 1].clone())
    }
    return result
  }

  // Interpolate using quadratic bezier
  for (let i: i32 = 0; i < targetCount; i++) {
    const t = f64(i) / f64(targetCount - 1)
    const index = (source.length - 2) * t
    const start = i32(Math.floor(index))
    const localT = index - f64(start)

    if (start + 2 >= source.length) {
      result.push(source[source.length - 1].clone())
      continue
    }

    const p0 = source[start]
    const p1 = source[start + 1]
    const p2 = source[start + 2]

    const u = 1 - localT
    const uu = u * u
    const tt = localT * localT
    const ut2 = 2 * u * localT

    result.push(
      new Point(
        uu * p0.x + ut2 * p1.x + tt * p2.x,
        uu * p0.y + ut2 * p1.y + tt * p2.y
      )
    )
  }

  return result
}
