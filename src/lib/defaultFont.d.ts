import { Parser } from './types';
export declare class AsemicFont {
    parser: Parser;
    characters: Record<string, () => void>;
    protected defaultCharacters: AsemicFont['characters'];
    protected defaultDynamicCharacters: AsemicFont['characters'];
    dynamicCharacters: AsemicFont['characters'];
    reset(): void;
    resetCharacter(char: string): void;
    parseCharacters(chars: AsemicFont['characters']): void;
    constructor(parser: Parser, characters: AsemicFont['characters']);
}
export declare class DefaultFont extends AsemicFont {
    constructor(parser: Parser);
}
