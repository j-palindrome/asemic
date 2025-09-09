import { AsemicPt } from '../../blocks/AsemicPt';
import { Parser } from '../Parser';
export declare class UtilityMethods {
    parser: Parser;
    constructor(parser: Parser);
    getBounds(fromGroup: number, toGroup?: number): number[];
    repeat(count: string, callback: () => void): Parser;
    within(coord0: string, coord1: string, callback: () => void): Parser;
    center(argsStr: string, callback: () => void): Parser;
    each(makeCurves: () => void, callback: (pt: AsemicPt) => void): Parser;
    test(condition: string | number, callback?: () => void, callback2?: () => void): Parser;
    or(value: number, ...callbacks: ((p: any) => void)[]): void;
    noise(value: number, frequencies: number[], phases?: number[]): number;
}
