import BrushBuilder from './BrushBuilder';
export declare class ParticlesBrush extends BrushBuilder<'particles'> {
    protected getDefaultBrushSettings(): BrushData<'particles'>;
    protected onFrame(): void;
    protected onDraw(): void;
    protected onInit(): void;
    protected onDispose(): void;
}
//# sourceMappingURL=ParticlesBrush.d.ts.map