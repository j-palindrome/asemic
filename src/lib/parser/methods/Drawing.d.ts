import { AsemicPt } from '../../blocks/AsemicPt';
import { Parser } from '../Parser';
export declare class DrawingMethods {
    parser: Parser;
    constructor(parser: any);
    protected mapCurve(multiplyPoints: AsemicPt[], addPoints: AsemicPt[], start: AsemicPt, end: AsemicPt, { add }?: {
        add?: boolean;
    }): void;
    tri(argsStr: string, { add }?: {
        add?: boolean;
    }): Parser;
    squ(argsStr: string, { add }?: {
        add?: boolean;
    }): Parser;
    pen(argsStr: string, { add }?: {
        add?: boolean;
    }): Parser;
    hex(argsStr: string): Parser;
    circle(argsStr: string): Parser;
    seq(countA: string, expressionA: string, { closed, end }?: {
        closed?: boolean;
        end?: boolean;
    }): Parser;
    line(...tokens: string[]): Parser;
}
