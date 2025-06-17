import BrushBuilder from './BrushBuilder';
export declare class LineBrush extends BrushBuilder<'line'> {
    protected getDefaultBrushSettings(): {
        type: 'line';
    };
    protected onFrame(): void;
    protected onDraw(): void;
    protected onInit(): void;
    protected onDispose(): void;
}
//# sourceMappingURL=LineBrush.d.ts.map