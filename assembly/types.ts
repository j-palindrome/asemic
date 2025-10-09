/**
 * AssemblyScript Types for Asemic Parser
 *
 * Core data structures using WASM-compatible types
 */

/** 2D Point with explicit memory layout */
export class Point {
  x: f64
  y: f64

  constructor(x: f64 = 0, y: f64 = 0) {
    this.x = x
    this.y = y
  }

  /** Clone this point */
  clone(): Point {
    return new Point(this.x, this.y)
  }

  /** Add another point */
  add(other: Point): Point {
    this.x += other.x
    this.y += other.y
    return this
  }

  /** Subtract another point */
  subtract(other: Point): Point {
    this.x -= other.x
    this.y -= other.y
    return this
  }

  /** Scale by factors */
  scale(sx: f64, sy: f64): Point {
    this.x *= sx
    this.y *= sy
    return this
  }

  /** Linear interpolation to another point */
  lerp(other: Point, t: f64): Point {
    this.x += (other.x - this.x) * t
    this.y += (other.y - this.y) * t
    return this
  }

  /** Distance to another point */
  distanceTo(other: Point): f64 {
    const dx = other.x - this.x
    const dy = other.y - this.y
    return Math.sqrt(dx * dx + dy * dy)
  }

  /** Magnitude (length) of this point as vector */
  magnitude(): f64 {
    return Math.sqrt(this.x * this.x + this.y * this.y)
  }

  /** Angle from origin (0-1 normalized) */
  angle0to1(): f64 {
    const angle = Math.atan2(this.y, this.x)
    return (angle + Math.PI) / (2 * Math.PI)
  }

  /** Rotate around origin */
  rotate(angle: f64): Point {
    const radians = angle * 2 * Math.PI
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const nx = this.x * cos - this.y * sin
    const ny = this.x * sin + this.y * cos
    this.x = nx
    this.y = ny
    return this
  }
}

/** Transform matrix for 2D transformations */
export class Transform {
  // Translation
  tx: f64
  ty: f64

  // Scale
  sx: f64
  sy: f64

  // Rotation (0-1 normalized)
  rotation: f64

  // Center point for rotation/scale
  cx: f64
  cy: f64

  constructor() {
    this.tx = 0
    this.ty = 0
    this.sx = 1
    this.sy = 1
    this.rotation = 0
    this.cx = 0
    this.cy = 0
  }

  /** Clone this transform */
  clone(): Transform {
    const t = new Transform()
    t.tx = this.tx
    t.ty = this.ty
    t.sx = this.sx
    t.sy = this.sy
    t.rotation = this.rotation
    t.cx = this.cx
    t.cy = this.cy
    return t
  }

  /** Reset to identity */
  reset(): void {
    this.tx = 0
    this.ty = 0
    this.sx = 1
    this.sy = 1
    this.rotation = 0
    this.cx = 0
    this.cy = 0
  }

  /** Apply this transform to a point */
  apply(point: Point): Point {
    let x = point.x
    let y = point.y

    // Translate to center
    x -= this.cx
    y -= this.cy

    // Scale
    x *= this.sx
    y *= this.sy

    // Rotate
    if (this.rotation !== 0) {
      const angle = this.rotation * 2 * Math.PI
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const nx = x * cos - y * sin
      const ny = x * sin + y * cos
      x = nx
      y = ny
    }

    // Translate back and apply offset
    x += this.cx + this.tx
    y += this.cy + this.ty

    point.x = x
    point.y = y
    return point
  }

  /** Apply inverse transform */
  applyInverse(point: Point): Point {
    let x = point.x
    let y = point.y

    // Reverse translation
    x -= this.tx + this.cx
    y -= this.ty + this.cy

    // Reverse rotation
    if (this.rotation !== 0) {
      const angle = -this.rotation * 2 * Math.PI
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const nx = x * cos - y * sin
      const ny = x * sin + y * cos
      x = nx
      y = ny
    }

    // Reverse scale
    x /= this.sx
    y /= this.sy

    // Translate back
    x += this.cx
    y += this.cy

    point.x = x
    point.y = y
    return point
  }
}

/** Progress state for animations */
export class Progress {
  point: i32
  curve: i32
  time: f64
  seed: f64
  scrub: f64
  scrubTime: f64
  progress: f64
  letter: i32

  // Indexes for repeat loops (up to 3 nested)
  index0: i32
  index1: i32
  index2: i32

  // Count nums for repeat loops
  count0: i32
  count1: i32
  count2: i32

  // Accumulator index
  accumIndex: i32

  constructor() {
    this.point = 0
    this.curve = 0
    this.time = 0
    this.seed = 0
    this.scrub = 0
    this.scrubTime = 0
    this.progress = 0
    this.letter = 0
    this.index0 = 0
    this.index1 = 0
    this.index2 = 0
    this.count0 = 0
    this.count1 = 0
    this.count2 = 0
    this.accumIndex = 0
  }

  reset(): void {
    this.point = 0
    this.curve = 0
    this.index0 = 0
    this.index1 = 0
    this.index2 = 0
    this.count0 = 0
    this.count1 = 0
    this.count2 = 0
    this.accumIndex = 0
  }
}

/** Noise generator state */
export class NoiseState {
  phase: f64
  phase2: f64
  value: f64

  constructor() {
    this.phase = Math.random() * Math.PI * 2
    this.phase2 = Math.random() * Math.PI * 2
    this.value = 0
  }

  generate(freq: f64, fmRatio: f64, modulation: f64): f64 {
    this.value += 1.0 / 60.0
    const t = this.value
    return (
      Math.sin(
        freq * t +
          this.phase +
          modulation * Math.sin(fmRatio * freq * t + this.phase2)
      ) *
        0.5 +
      0.5
    )
  }
}
