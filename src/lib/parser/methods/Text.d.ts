import { AsemicFont } from '../../defaultFont';
import { Parser } from '../Parser';
export declare class TextMethods {
    parser: Parser;
    private fontCache;
    private characterCache;
    private regexCache;
    private static readonly BRACKET_REGEX;
    constructor(parser: Parser);
    text(token: string): Parser;
    resetFont(name: string): Parser;
    font(name: string, chars: AsemicFont['characters']): Parser;
    keys(index: string | number): Parser;
    regex(regex: string, seed?: string | number): Parser;
    clearCaches(): void;
    getCacheStats(): {
        fontCache: number;
        characterCache: number;
        regexCache: number;
    };
}
