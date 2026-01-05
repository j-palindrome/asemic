import { Color, Group, GroupLike, Pt, PtIterable, PtLike } from 'pts'
import type { Parser } from '../parser/Parser'
import { parseFromFunction } from '../../src/lib/utils'

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

  magnitude(): number {
    return Math.sqrt(this[0] * this[0] + this[1] * this[1])
  }

  angle0to1(): number {
    const angle = Math.atan2(this[1], this[0])
    return (angle < 0 ? Math.PI * 2 + angle : angle) / (Math.PI * 2)
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

    if (around) {
      const cx = around[0]
      const cy = around[1]
      const dx = this[0] - cx
      const dy = this[1] - cy
      this[0] = dx * cos - dy * sin + cx
      this[1] = dx * sin + dy * cos + cy
    } else {
      const dx = this[0]
      const dy = this[1]
      this[0] = dx * cos - dy * sin
      this[1] = dx * sin + dy * cos
    }
    return this
  }

  exponent(exp: BasicPtLike): this {
    this[0] = Math.pow(this[0], exp[0])
    this[1] = Math.pow(this[1], exp[1])
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

  divide([x, y]: [number, number] | BasicPt) {
    this[0] /= x
    this[1] /= y
    return this
  }

  oneOver(): this {
    this[0] = 1 / this[0]
    this[1] = 1 / this[1]
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

  constructor(
    parent: Parser,
    x: number = 0,
    y: number = 0,
    { inherit }: { inherit?: AsemicPt } = {}
  ) {
    super(x, y, 7)
    this.parent = parent
    if (inherit) {
      this[2] = inherit[2]
      this[3] = inherit[3]
      this[4] = inherit[4]
      this[5] = inherit[5]
      this[6] = inherit[6]
    } else {
      this[2] = parseFromFunction(this.parent.currentTransform.w)
      this[3] = parseFromFunction(this.parent.currentTransform.h)
      this[4] = parseFromFunction(this.parent.currentTransform.s)
      this[5] = parseFromFunction(this.parent.currentTransform.l)
      this[6] = parseFromFunction(this.parent.currentTransform.a)
    }
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

  lerp(target: AsemicPt, t: number): this {
    this[0] += (target[0] - this[0]) * t
    this[1] += (target[1] - this[1]) * t
    this[2] += (target[2] - this[2]) * t
    this[3] += (target[3] - this[3]) * t
    this[4] += (target[4] - this[4]) * t
    this[5] += (target[5] - this[5]) * t
    this[6] += (target[6] - this[6]) * t
    return this
  }

  clone(inherit = false): AsemicPt {
    const pt = new AsemicPt(this.parent, this[0], this[1], {
      inherit: inherit ? this : undefined
    })
    return pt
  }

  to(transform: string) {
    const fixedTransform =
      this.parent.transformMethods.parseTransform(transform)

    this.parent.transformMethods.reverseTransform(this, {
      transform: this.parent.currentTransform
    })
    this.parent.transformMethods.applyTransform(this, {
      transform: fixedTransform
    })
    this.parent.transformMethods.applyTransform(this, {
      transform: this.parent.currentTransform
    })
    return this
  }
}
