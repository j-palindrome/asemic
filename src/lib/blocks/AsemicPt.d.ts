import type { Parser } from '../parser/Parser';
type BasicPtLike = BasicPt | [number, number];
export declare class BasicPt extends Float32Array {
    get x(): number;
    set x(val: number);
    get y(): number;
    set y(val: number);
    add(addition: BasicPt | [number, number]): this;
    magnitude(): number;
    angle0to1(): number;
    subtract(point: BasicPt | [number, number]): this;
    rotate(amount0To1: number, around?: BasicPtLike): this;
    exponent(exp: BasicPtLike): this;
    scale([x, y]: [number, number] | BasicPt, center?: [number, number] | BasicPt): this;
    divide([x, y]: [number, number] | BasicPt): this;
    oneOver(): this;
    lerp(target: BasicPtLike, t: number): this;
    clone(): BasicPt;
    constructor(x?: number, y?: number, length?: number);
}
export declare class AsemicPt extends BasicPt {
    parent: Parser;
    constructor(parent: Parser, x?: number, y?: number, { inherit }?: {
        inherit?: AsemicPt;
    });
    get w(): number;
    set w(val: number);
    get h(): number;
    set h(val: number);
    get s(): number;
    set s(val: number);
    get l(): number;
    set l(val: number);
    get a(): number;
    set a(val: number);
    lerp(target: AsemicPt, t: number): this;
    clone(inherit?: boolean): AsemicPt;
    to(transform: string): this;
}
export {};
