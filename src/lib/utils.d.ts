export declare const defaultPreProcess: () => {
    replacements: Record<string, string>;
    width: number;
    height: number;
    directory: string;
};
export declare const lerp: (a: number, b: number, t: number) => number;
export declare const clamp: (value: number, min: number, max: number) => number;
export declare const mapRange: (value: number, inMin: number, inMax: number, outMin: number, outMax: number) => number;
export declare const mapRangeClamp: (value: number, inMin: number, inMax: number, outMin: number, outMax: number) => number;
export declare const stripComments: (str: string) => string;
