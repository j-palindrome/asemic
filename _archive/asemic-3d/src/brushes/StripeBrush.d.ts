import BrushBuilder from './BrushBuilder';
export declare class StripeBrush extends BrushBuilder<'stripe'> {
    protected getDefaultBrushSettings(): {
        type: 'stripe';
    };
    protected onFrame(): void;
    protected onDraw(): void;
    protected onInit(): void;
    protected onDispose(): void;
}
//# sourceMappingURL=StripeBrush.d.ts.map