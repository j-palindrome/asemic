import { Parser, Transform } from '../../types';
export declare class TransformMethods {
    parser: Parser;
    private regexCache;
    private static readonly SCALE_REGEX;
    private static readonly ROTATION_REGEX;
    private static readonly TRANSLATION_REGEX;
    private static readonly KEY_CALL_REGEX;
    constructor(parser: Parser);
    private getCachedRegex;
    to(token: string): Parser;
    parseTransform(token: string, { thisTransform }?: {
        thisTransform?: Transform;
    }): Transform;
    applyTransform: (point: any, { relative, randomize, transform }?: {
        relative?: boolean;
        randomize?: boolean;
        transform?: Transform;
    }) => any;
    reverseTransform: (point: any, { randomize, transform }?: {
        randomize?: boolean;
        transform?: Transform;
    }) => any;
    clearCaches(): void;
    getCacheStats(): {
        regexCache: number;
    };
}
