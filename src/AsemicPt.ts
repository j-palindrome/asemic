import { Color, Group, GroupLike, Pt, PtIterable, PtLike } from 'pts'
import type { Parser } from './Parser'

export class AsemicPt extends Float32Array {
  parent: Parser
  w: number
  hsla: Float32Array // [h, s, l, a]

  constructor(parent: Parser, x: number = 0, y: number = 0) {
    super(2)
    this[0] = x
    this[1] = y
    this.parent = parent
  }

  get x() {
    return this[0]
  }
  set x(val) {
    this[0] = val
  }
  get y() {
    return this[1]
  }
  set y(val) {
    this[1] = val
  }

  // Lazy evaluation - only compute when needed
  get width(): number {
    if (this.w === undefined) {
      this.w = this.parent.evalExpr(this.parent.transform.width)
    }
    return this.w
  }

  get color(): Float32Array {
    if (!this.hsla) {
      this.hsla = new Float32Array([
        this.parent.evalExpr(this.parent.transform.h),
        this.parent.evalExpr(this.parent.transform.s),
        this.parent.evalExpr(this.parent.transform.l),
        this.parent.evalExpr(this.parent.transform.a)
      ])
    }
    return this.hsla
  }

  // Fast mutable operations
  add(x: number, y: number): this {
    this[0] += x
    this[1] += y
    return this
  }

  scale(factor: number): this {
    this[0] *= factor
    this[1] *= factor
    return this
  }

  lerp(target: AsemicPt, t: number): this {
    this[0] += (target[0] - this[0]) * t
    this[1] += (target[1] - this[1]) * t
    return this
  }

  // Immutable operations when needed
  $add(x: number, y: number): AsemicPt {
    return new AsemicPt(this.parent, this[0] + x, this[1] + y)
  }

  clone(): AsemicPt {
    const pt = new AsemicPt(this.parent, this[0], this[1])
    pt.w = this.w
    pt.hsla = this.hsla ? new Float32Array(this.hsla) : undefined
    return pt
  }

  invalidateCache() {
    this.w = undefined
    this.hsla = undefined
  }
}
