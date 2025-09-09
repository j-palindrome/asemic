import { AsemicPt, BasicPt } from '../../blocks/AsemicPt';
export declare class AsemicGroup extends Array<AsemicPt[]> {
    settings: {
        mode: 'line' | 'fill' | 'blank';
        texture?: string;
        fragment?: string;
        synth?: string;
        xy?: string;
        wh?: string;
    };
    imageDatas?: ImageData[];
    xy: BasicPt;
    wh: BasicPt;
    constructor(parser: any, settings?: Partial<AsemicGroup['settings']>);
    addCurve(curve: AsemicPt[]): void;
}
