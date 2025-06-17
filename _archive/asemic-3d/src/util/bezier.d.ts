import { Vector2 } from 'three';
import { float, vec2 } from 'three/tsl';
export declare const multiBezierJS: (t: number, ...points: Vector2[]) => Vector2;
export declare const rotate2d: (v: ReturnType<typeof vec2>, a: number | ReturnType<typeof float>) => import("three/tsl").ShaderNodeObject<import("three/src/nodes/math/OperatorNode.js").default>;
export declare const bezier2Tangent: ({ t, p0, p1, p2 }: {
    t: ReturnType<typeof float>;
    p0: ReturnType<typeof vec2>;
    p1: ReturnType<typeof vec2>;
    p2: ReturnType<typeof vec2>;
}) => import("three/tsl").ShaderNodeObject<import("three/src/nodes/math/OperatorNode.js").default>;
export declare const polyLine: ({ t, p0, p1, p2 }: {
    t: ReturnType<typeof float>;
    p0: ReturnType<typeof vec2>;
    p1: ReturnType<typeof vec2>;
    p2: ReturnType<typeof vec2>;
}) => import("three/tsl").ShaderNodeObject<import("three/webgpu").Node>;
export declare const bezier2: (t: any, p0: any, p1: any, p2: any) => any;
export declare const bezierRational: ({ t, p0, p1, p2, strength }: {
    t: any;
    p0: any;
    p1: any;
    p2: any;
    strength: any;
}) => any;
export declare const bezierPosition: ({ t, p0, p1, p2, strength }: {
    t: any;
    p0: any;
    p1: any;
    p2: any;
    strength: any;
}) => import("three/tsl").ShaderNodeObject<import("three/webgpu").VarNode>;
export declare const bezierRotation: ({ t, p0, p1, p2, strength }: {
    t: any;
    p0: any;
    p1: any;
    p2: any;
    strength: any;
}) => import("three/tsl").ShaderNodeObject<import("three/src/nodes/math/MathNode.js").default>;
//# sourceMappingURL=bezier.d.ts.map