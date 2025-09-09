import { InputSchema } from '../../server/inputSchema';
export declare const defaultOutput: () => {
    osc: {
        path: string;
        args: (string | number | [number, number])[];
    }[];
    sc: {
        path: string;
        value: number | number[];
    }[];
    scSynthDefs: Record<string, string>;
    curves: any[];
    errors: string[];
    pauseAt: string | false;
    eval: string[];
    params: InputSchema["params"] | undefined;
    presets: InputSchema["presets"] | undefined;
    resetParams: boolean;
    resetPresets: boolean;
    files: string[];
};
