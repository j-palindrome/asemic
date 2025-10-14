/**
 * Main AssemblyScript Module for Asemic Parser
 *
 * Entry point and exports for WASM
 */

import { Point, Transform, Progress } from './types'
import { ExpressionEvaluator } from './expressions'
import { DrawingMethods, interpolateCurve } from './drawing'

/** Global state for the WASM parser */
let evaluator: ExpressionEvaluator
let drawing: DrawingMethods
let curves: Point[][] = []

/** Initialize the WASM module */
export function init(width: f64, height: f64): void {
  evaluator = new ExpressionEvaluator()
  evaluator.width = width
  evaluator.height = height
  drawing = new DrawingMethods(evaluator)
  curves = []
}

/** Reset state */
export function reset(): void {
  curves = []
  evaluator.progress.reset()
  evaluator.accumulators.fill(0)
  evaluator.noiseIndex = 0
  evaluator.groupCount = 0
}

/** Set progress values */
export function setProgress(
  time: f64,
  scrub: f64,
  scrubTime: f64,
  progress: f64,
  seed: f64
): void {
  evaluator.progress.time = time
  evaluator.progress.scrub = scrub
  evaluator.progress.scrubTime = scrubTime
  evaluator.progress.progress = progress
  evaluator.progress.seed = seed
}

/** Set loop indexes (for repeat operations) */
export function setIndexes(
  i0: i32,
  i1: i32,
  i2: i32,
  n0: i32,
  n1: i32,
  n2: i32
): void {
  evaluator.progress.index0 = i0
  evaluator.progress.index1 = i1
  evaluator.progress.index2 = i2
  evaluator.progress.count0 = n0
  evaluator.progress.count1 = n1
  evaluator.progress.count2 = n2
}

/** Set transform */
export function setTransform(
  tx: f64,
  ty: f64,
  sx: f64,
  sy: f64,
  rotation: f64,
  cx: f64,
  cy: f64
): void {
  drawing.builder.currentTransform.tx = tx
  drawing.builder.currentTransform.ty = ty
  drawing.builder.currentTransform.sx = sx
  drawing.builder.currentTransform.sy = sy
  drawing.builder.currentTransform.rotation = rotation
  drawing.builder.currentTransform.cx = cx
  drawing.builder.currentTransform.cy = cy
}

/** Reset transform to identity */
export function resetTransform(): void {
  drawing.builder.currentTransform.reset()
}

// ============================================================================
// Expression Evaluation
// ============================================================================

/** Evaluate an expression */
export function expr(input: string): f64 {
  return evaluator.eval(input)
}

/** Hash function */
export function hash(n: f64): f64 {
  return evaluator.hash(n)
}

/** Linear interpolation */
export function lerp(a: f64, b: f64, t: f64): f64 {
  return evaluator.lerp(a, b, t)
}

// ============================================================================
// Drawing Functions
// ============================================================================

/** Triangle */
export function tri(x: f64, y: f64, w: f64, h: f64): void {
  const pts = drawing.tri(x, y, w, h)
  curves.push(pts)
  evaluator.groupCount++
}

/** Square */
export function squ(x: f64, y: f64, w: f64, h: f64): void {
  const pts = drawing.squ(x, y, w, h)
  curves.push(pts)
  evaluator.groupCount++
}

/** Pentagon (n-gon) */
export function pen(sides: i32, x: f64, y: f64, w: f64, h: f64): void {
  const pts = drawing.pen(sides, x, y, w, h)
  curves.push(pts)
  evaluator.groupCount++
}

/** Hexagon */
export function hex(x: f64, y: f64, w: f64, h: f64): void {
  const pts = drawing.hex(x, y, w, h)
  curves.push(pts)
  evaluator.groupCount++
}

/** Circle */
export function circle(x: f64, y: f64, w: f64, h: f64, segments: i32): void {
  const pts = drawing.circle(x, y, w, h, segments)
  curves.push(pts)
  evaluator.groupCount++
}

/** Sequence of points */
export function seq(count: i32, x: f64, y: f64, xStep: f64, yStep: f64): void {
  const pts = drawing.seq(count, x, y, xStep, yStep)
  curves.push(pts)
  evaluator.groupCount++
}

/** Line */
export function line(x1: f64, y1: f64, x2: f64, y2: f64, segments: i32): void {
  const pts = drawing.line(x1, y1, x2, y2, segments)
  curves.push(pts)
  evaluator.groupCount++
}

// ============================================================================
// Curve Utilities
// ============================================================================

/** Get number of curves */
export function getCurveCount(): i32 {
  return curves.length
}

/** Get number of points in a curve */
export function getCurvePointCount(curveIndex: i32): i32 {
  if (curveIndex < 0 || curveIndex >= curves.length) {
    return 0
  }
  return curves[curveIndex].length
}

/** Get a point from a curve */
export function getCurvePoint(curveIndex: i32, pointIndex: i32): Point {
  if (curveIndex < 0 || curveIndex >= curves.length) {
    return new Point(0, 0)
  }
  const curve = curves[curveIndex]
  if (pointIndex < 0 || pointIndex >= curve.length) {
    return new Point(0, 0)
  }
  return curve[pointIndex]
}

/** Interpolate a curve to have more points */
export function interpolate(curveIndex: i32, targetCount: i32): void {
  if (curveIndex < 0 || curveIndex >= curves.length) {
    return
  }
  curves[curveIndex] = interpolateCurve(curves[curveIndex], targetCount)
}

/** Get tangent angle at progress on curve */
export function getTangent(curveIndex: i32, progress: f64): f64 {
  if (curveIndex < 0 || curveIndex >= curves.length) {
    return 0
  }
  return drawing.tangent(progress, curves[curveIndex])
}

/** Map along a curve (get point at progress) */
export function mapCurve(curveIndex: i32, progress: f64): Point {
  if (curveIndex < 0 || curveIndex >= curves.length) {
    return new Point(0, 0)
  }
  return drawing.mapCurve(progress, curves[curveIndex])
}

// ============================================================================
// Memory Access Helpers (for JS bridge)
// ============================================================================

/**
 * Get flat array of all curve data for transfer to JS
 * Returns: [curveCount, curve0Length, x0, y0, x1, y1, ..., curve1Length, ...]
 */
export function exportCurves(): Float64Array {
  // Calculate total size needed
  let totalSize: i32 = 1 // For curve count
  for (let i: i32 = 0; i < curves.length; i++) {
    totalSize += 1 + curves[i].length * 2 // length + (x,y) pairs
  }

  const result = new Float64Array(totalSize)
  let offset: i32 = 0

  // Write curve count
  result[offset++] = f64(curves.length)

  // Write each curve
  for (let i: i32 = 0; i < curves.length; i++) {
    const curve = curves[i]
    result[offset++] = f64(curve.length)

    for (let j: i32 = 0; j < curve.length; j++) {
      result[offset++] = curve[j].x
      result[offset++] = curve[j].y
    }
  }

  return result
}

/** Clear all curves */
export function clearCurves(): void {
  curves = []
  evaluator.groupCount = 0
}
