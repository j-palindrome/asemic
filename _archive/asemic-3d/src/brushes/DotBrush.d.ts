import BrushBuilder from './BrushBuilder';
export declare class DotBrush extends BrushBuilder<'dot'> {
    protected getDefaultBrushSettings(): {
        type: 'dot';
    };
    protected onDispose(): void;
    protected onDraw(): void;
    protected onInit(): void;
    protected onFrame(): void;
}
//# sourceMappingURL=DotBrush.d.ts.map