import { AsemicPt } from '../../blocks/AsemicPt';
import { Parser } from '../Parser';
export declare class DataMethods {
    parser: Parser;
    constructor(parser: Parser);
    /**
     * Load multiple files into the image store
     * @param files - Dictionary of filename to ImageBitmap arrays
     */
    loadFiles(files: Partial<any>): Parser;
    /**
     * Look up a pixel value from a loaded image
     * @param name - The name of the loaded image
     * @param coord - Coordinate string to parse
     * @param channel - Which channel to return: 'r', 'g', 'b', 'a', or 'brightness' (default)
     * @returns Normalized pixel value (0-1)
     */
    table(name: string, coord: string, channel?: string): number;
    processMouse(mouse: NonNullable<any>): AsemicPt;
    resolveName(name: string): string;
}
