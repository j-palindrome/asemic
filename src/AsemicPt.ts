import { Color, Group, GroupLike, Pt, PtIterable, PtLike } from 'pts'
import type { Parser } from './parse'

type AsemicPtLike = Pt | Float32Array | number[]
type AsemicGroupLike = AsemicGroup | AsemicPt[]
type AsemicPtIterable = AsemicGroupLike | Iterable<AsemicPt>
type PtLikeIterable = AsemicGroupLike | AsemicPtLike[] | Iterable<AsemicPtLike>

// @ts-ignore
export class AsemicGroup extends Group {
  at(i: number): AsemicPt {
    if (i < 0) i += this.length
    return this[i] as AsemicPt
  }

  //     get p1(): Pt;
  //     get p2(): Pt;
  //     get p3(): Pt;
  //     get p4(): Pt;
  //     get q1(): Pt;
  //     get q2(): Pt;
  //     get q3(): Pt;
  //     get q4(): Pt;
  clone(): AsemicGroup {
    return new AsemicGroup(...(this as unknown as AsemicPt[]))
  }

  reverse(): AsemicPt[] {
    return super.reverse() as AsemicPt[]
  }

  split(chunkSize: number, stride?: number, loopBack?: boolean): AsemicGroup[] {
    return super.split(chunkSize, stride, loopBack) as AsemicGroup[]
  }
  insert(pts: AsemicPtIterable, index?: number): this {
    return super.insert(pts, index) as this
  }
  remove(index?: number, count?: number): AsemicGroup {
    return super.remove(index, count) as this
  }
  segments(
    pts_per_segment?: number,
    stride?: number,
    loopBack?: boolean
  ): AsemicGroup[] {
    return super.segments(pts_per_segment, stride, loopBack) as AsemicGroup[]
  }
  lines(): AsemicGroup[] {
    return super.lines() as AsemicGroup[]
  }
  interpolate(t: number): AsemicPt {
    return new AsemicPt(this.at(0).parent, super.interpolate(t))
  }
  $matrixAdd(g: GroupLike | number[][] | number): AsemicGroup {
    return super.$matrixAdd(g) as AsemicGroup
  }
  $matrixMultiply(
    g: GroupLike | number,
    transposed?: boolean,
    elementwise?: boolean
  ): AsemicGroup {
    return super.$matrixMultiply(g, transposed, elementwise) as AsemicGroup
  }
  zipSlice(index: number, defaultValue?: number | boolean): AsemicPt {
    return super.zipSlice(index, defaultValue) as AsemicPt
  }
  $zip(defaultValue?: number | boolean, useLongest?: boolean): Group {
    return super.$zip(defaultValue, useLongest) as AsemicGroup
  }

  aSlice(start?: number, end?: number): AsemicGroup {
    return new AsemicGroup(...(super.slice(start, end) as AsemicPt[]))
  }

  flat<A, D extends number = 1>(
    this: A,
    depth?: D | undefined
  ): FlatArray<A, D>[] {
    // @ts-ignore
    return super.flat(depth) as unknown as AsemicPt[]
  }

  map<U>(
    callbackfn: (value: AsemicPt, index: number, array: AsemicPt[]) => U,
    thisArg?: any
  ): U[] {
    return super.map(callbackfn, thisArg)
  }

  flatMap<U>(
    callbackfn: (value: AsemicPt, index: number, array: AsemicPt[]) => U[] | U,
    thisArg?: any
  ): U[] {
    return super.flatMap(callbackfn, thisArg)
  }

  static fromArray(list: PtLikeIterable) {
    throw new Error('AsemicGroup: use fromPointArray.')
  }

  static fromPointArray(list: AsemicPtIterable) {
    return super.fromPtArray(list) as AsemicGroup
  }

  constructor(...args: AsemicPt[]) {
    super(...args)
  }
}

export class AsemicPt extends Pt {
  width: number
  parent: Parser
  color: Pt

  lerp(nextPt: AsemicPt, amount: number): this {
    this.add(nextPt.$subtract(this).scale(amount))
    return this
  }

  $lerp(nextPt: AsemicPt, amount: number): AsemicPt {
    return this.$add(nextPt.$subtract(this).scale(amount))
  }

  clone(): AsemicPt {
    return new AsemicPt(this.parent, this.x, this.y)
  }
  $to(...args: any[]): AsemicPt {
    return this.clone().to(...args)
  }
  $take(axis: string | number[]): AsemicPt {
    return super.$take(axis) as AsemicPt
  }
  $add(...args: any[]): AsemicPt {
    return this.clone().add(...args)
  }
  $subtract(...args: any[]): AsemicPt {
    return this.clone().subtract(...args)
  }
  $multiply(...args: any[]): AsemicPt {
    return this.clone().multiply(...args)
  }
  $divide(...args: any[]): AsemicPt {
    return this.clone().divide(...args)
  }
  // unit(magnitude?: number): AsemicPt;
  // $unit(magnitude?: number): AsemicPt;
  // $cross(...args: any[]): AsemicPt {

  //     return this.clone().cross(...args)

  // }
  // $project(...args: any[]): AsemicPt {
  //   return this.clone().proj
  // }
  abs(): this {
    return super.abs() as this
  }
  $abs(): AsemicPt {
    return this.clone().abs()
  }
  floor(): AsemicPt {
    return super.floor() as this
  }
  $floor(): AsemicPt {
    return this.clone().floor()
  }
  ceil(): AsemicPt {
    return super.ceil() as this
  }
  $ceil(): AsemicPt {
    return this.clone().ceil()
  }
  round(): AsemicPt {
    return super.round() as this
  }
  $round(): AsemicPt {
    return this.clone().round()
  }
  $min(...args: any[]): AsemicPt {
    return super.$min(...args) as AsemicPt
  }
  $max(...args: any[]): AsemicPt {
    return super.$max(...args) as AsemicPt
  }

  constructor(parent: Parser, ...args: ConstructorParameters<typeof Pt>) {
    super(...args)
    this.width =
      typeof parent.transform.width === 'function'
        ? parent.transform.width()
        : parent.transform.width
    this.color =
      typeof parent.transform.hsla === 'function'
        ? parent.transform.hsla()
        : parent.transform.hsla
    this.parent = parent
  }
}
