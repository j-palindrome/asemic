import { AsemicPt } from '../../blocks/AsemicPt';
import AsemicVisual from '../AsemicVisual';
export default class CanvasRenderer extends AsemicVisual {
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    protected format(curves: AsemicPt[][]): [number, number][][];
    render(curves: AsemicPt[][], { clear }?: {
        clear?: boolean;
    }): void;
    constructor(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D);
}
