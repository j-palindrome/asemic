export declare function isBrushType<T extends BrushTypes>(type: BrushTypes, target: T): type is T;
export declare const isTransformData: (transform: any) => transform is TransformData;
export declare const toTuple: <T extends any[]>(...args: T) => T;
