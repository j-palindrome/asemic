import { Parser } from '../../types';
export declare class ExpressionMethods {
    parser: Parser;
    private static readonly BACKTICK_REGEX;
    private static readonly NUMBER_REGEX;
    private static readonly OPERATORS;
    private static readonly OPERATOR_REGEX;
    private operatorSplitCache;
    sortedKeys: string[];
    protected generateSortedKeys(): void;
    constructor(parser: any);
    protected fastExpr(stringExpr: string): number;
    expr(expr: string | number, replace?: boolean): number;
    choose(value0To1: string | number, ...callbacks: (() => void)[]): Parser;
    def(key: string, definition: string): Parser;
    defStatic(key: string, definition: string): Parser;
}
