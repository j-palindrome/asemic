import { VideoTexture } from 'three';
type SrcKey = 'video' | 'stream' | 'cam' | 'screen';
type SrcProperties<T extends SrcKey> = {
    dimensions: [number, number];
} & (T extends 'video' ? {
    src: string;
} : T extends 'stream' ? {
    src?: MediaStream;
} : T extends 'cam' ? {
    src?: MediaStreamConstraints;
} : T extends 'screen' ? {
    src?: DisplayMediaStreamOptions;
} : never);
export declare class AsemicInput<T extends SrcKey> {
    dynamic: boolean;
    width: number;
    height: number;
    video: HTMLVideoElement;
    texture: VideoTexture;
    type: T;
    props: SrcProperties<T>;
    constructor(type: T, props: SrcProperties<T>);
    initCam(constraints?: MediaStreamConstraints): Promise<void>;
    initVideo(url: string): Promise<unknown>;
    initStream(streamName: any): Promise<void>;
    initScreen(options?: DisplayMediaStreamOptions): Promise<void>;
    resize(width: any, height: any): void;
    init(): Promise<VideoTexture>;
}
export default AsemicInput;
