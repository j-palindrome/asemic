export declare const defaultSettings: () => {
    debug: boolean;
    h: number | "window" | "auto";
    perform: boolean;
    scene: number;
    fullscreen: boolean;
    folder: string;
};
export declare const splitString: (string: string, at: string | RegExp) => [string, string];
export declare const splitStringLast: (string: string, at: string) => [string, string];
export declare const splitStringAt: (string: string, at: number, length: number) => [string, string];
