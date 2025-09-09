import { AsemicPt, BasicPt } from '../../blocks/AsemicPt';
import { AsemicGroup } from '../core/AsemicGroup';
import { Parser } from '../Parser';
export declare class ParsingMethods {
    parser: Parser;
    private tokenizeCache;
    private regexCache;
    private static readonly COMMENT_REGEX;
    private static readonly WHITESPACE_REGEX;
    private static readonly COMMA_REGEX;
    private static readonly UNDERSCORE_REGEX;
    private static readonly SEMICOLON_REGEX;
    constructor(parser: Parser);
    tokenize(source: string | number, { separatePoints, separateFragments, separateObject, regEx, stopAt0 }?: {
        separatePoints?: boolean;
        separateFragments?: boolean;
        regEx?: RegExp;
        separateObject?: boolean;
        stopAt0?: boolean;
    }): string[];
    parsePoint(notation: string | number, { save, randomize, forceRelative }?: {
        save?: boolean;
        randomize?: boolean;
        forceRelative?: boolean;
    }): AsemicPt;
    parseArgs(args: string[]): [AsemicPt, AsemicPt, number, number];
    evalPoint<K extends boolean>(thisPoint: string | BasicPt, { basic }?: {
        basic?: K;
    }): K extends true ? BasicPt : AsemicPt;
    group(settings: AsemicGroup['settings']): Parser;
    end(): Parser;
    points(token: string): Parser;
    clearCaches(): void;
    getCacheStats(): {
        tokenizeCache: number;
        regexCache: number;
    };
}
