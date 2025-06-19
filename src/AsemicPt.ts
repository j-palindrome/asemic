import { Color, Group, GroupLike, Pt, PtIterable, PtLike } from 'pts'
import type { Parser } from './Parser'

type BasicPtLike = BasicPt | [number, number]
export class BasicPt extends Float32Array {
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

  // Fast mutable operations
  add(addition: BasicPt | [number, number]): this {
    this[0] += addition[0]
    this[1] += addition[1]
    return this
  }

  subtract(point: BasicPt | [number, number]): this {
    this[0] -= point[0]
    this[1] -= point[1]
    return this
  }

  rotate(amount0To1: number, around?: BasicPtLike): this {
    const theta = amount0To1 * Math.PI * 2
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    const cx = around ? around[0] : 0
    const cy = around ? around[1] : 0
    const dx = this[0] - cx
    const dy = this[1] - cy
    const x = dx * cos - dy * sin + cx
    const y = dx * sin + dy * cos + cy
    this[0] = x
    this[1] = y
    return this
  }

  scale(
    [x, y]: [number, number] | BasicPt,
    center?: [number, number] | BasicPt
  ): this {
    if (y === undefined) {
      y = x
    }
    if (center) {
      this[0] = center[0] + (this[0] - center[0]) * x
      this[1] = center[1] + (this[1] - center[1]) * y
    } else {
      this[0] *= x
      this[1] *= y
    }
    return this
  }

  lerp(target: BasicPtLike, t: number): this {
    this[0] += (target[0] - this[0]) * t
    this[1] += (target[1] - this[1]) * t
    return this
  }

  clone(): BasicPt {
    const pt = new BasicPt(this[0], this[1])
    return pt
  }

  constructor(x: number = 0, y: number = 0, length = 2) {
    super(length)
    this[0] = x
    this[1] = y
  }
}

export class AsemicPt extends BasicPt {
  parent: Parser

  constructor(parent: Parser, x: number = 0, y: number = 0) {
    super(x, y, 7)
    this.parent = parent
    this[2] = this.parent.evalExpr(this.parent.transform.width)
    this[3] = this.parent.evalExpr(this.parent.transform.h)
    this[4] = this.parent.evalExpr(this.parent.transform.s)
    this[5] = this.parent.evalExpr(this.parent.transform.l)
    this[6] = this.parent.evalExpr(this.parent.transform.a)
  }

  get w() {
    return this[2]
  }
  set w(val) {
    this[2] = val
  }
  get h() {
    return this[3]
  }
  set h(val) {
    this[3] = val
  }
  get s() {
    return this[4]
  }
  set s(val) {
    this[4] = val
  }
  get l() {
    return this[5]
  }
  set l(val) {
    this[5] = val
  }
  get a() {
    return this[6]
  }
  set a(val) {
    this[6] = val
  }

  clone(): AsemicPt {
    const pt = new AsemicPt(this.parent, this[0], this[1])
    return pt
  }
}
