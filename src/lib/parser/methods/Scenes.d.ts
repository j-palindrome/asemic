import { AsemicData, Parser } from '../../types';
import { InputSchema } from '../../server/inputSchema';
export declare class SceneMethods {
    parser: Parser;
    constructor(parser: Parser);
    scene(...scenes: {
        draw: () => void;
        setup?: () => void;
        length?: number;
        offset?: number;
        pause?: number;
    }[]): Parser;
    play(play: AsemicData['play']): void;
    param(paramName: string, { value, min, max, exponent }: InputSchema['params'][string]): Parser;
    preset(presetName: string, values: string): Parser;
    toPreset(presetName: string, amount?: string | number): Parser;
    scrub(progress: number): Parser;
}
