import BrushBuilder from './BrushBuilder';
type VectorList = [number, number];
type Vector3List = [number, number, number];
export type Jitter = {
    size?: VectorList;
    position?: VectorList;
    hsl?: Vector3List;
    a?: number;
    rotation?: number;
};
export declare class BlobBrush extends BrushBuilder<'blob'> {
    protected getDefaultBrushSettings(): {
        type: 'blob';
        centerMode: 'center' | 'first' | 'betweenEnds';
    };
    protected onFrame(): void;
    protected onDraw(): void;
    protected onInit(): void;
    protected onDispose(): void;
}
export {};
//# sourceMappingURL=BlobBrush.d.ts.map