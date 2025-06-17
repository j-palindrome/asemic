import BrushBuilder from './BrushBuilder';
export declare class DashBrush extends BrushBuilder<'dash'> {
    protected getDefaultBrushSettings(): BrushData<"dash">;
    protected onFrame(): void;
    protected onDraw(): void;
    protected onInit(): void;
    protected onDispose(): void;
}
//# sourceMappingURL=DashBrush.d.ts.map