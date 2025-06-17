import { float, instancedArray, uniformArray, varying, vec2 } from 'three/tsl';
import { ComputeNode, Scene, Vector2, WebGPURenderer } from 'three/webgpu';
import { AsemicGroup } from 'src/AsemicPt';
export default abstract class BrushBuilder<T extends BrushTypes> {
    protected settings: ProcessData<T> & BrushData<T>;
    protected info: {
        controlPointCounts: ReturnType<typeof uniformArray>;
        curvePositionArray: ReturnType<typeof instancedArray>;
        curveColorArray: ReturnType<typeof instancedArray>;
        instancesPerCurve: number;
    } & Record<string, any>;
    protected renderer: WebGPURenderer;
    protected scene: Scene;
    protected abstract getDefaultBrushSettings(): BrushData<T>;
    protected abstract onFrame(): any;
    protected abstract onDraw(): any;
    protected abstract onInit(): any;
    protected abstract onDispose(): any;
    protected advanceControlPoints: ComputeNode;
    protected loadControlPoints: ComputeNode;
    protected nextTime: number;
    protected size: Vector2;
    protected group: AsemicGroup[];
    frame(elapsedTime: number): void;
    dispose(): void;
    protected getBezier(progress: ReturnType<typeof float>, position: ReturnType<typeof vec2>, extra?: {
        rotation?: ReturnType<typeof float>;
        width?: ReturnType<typeof float>;
        color?: ReturnType<typeof varying> | ReturnType<ReturnType<typeof float>['toVar']>;
        progress?: ReturnType<typeof varying>;
    }): void;
    screenToWorld(ev: MouseEvent): Vector2;
    protected getLength(group: AsemicGroup): void;
    constructor(settings: Partial<ProcessData<T>> & Partial<BrushData<T>>, { renderer, group, scene }: {
        renderer: WebGPURenderer;
        group: AsemicGroup[];
        scene: Scene;
    });
}
//# sourceMappingURL=BrushBuilder.d.ts.map