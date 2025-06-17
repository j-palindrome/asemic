import { ThreeElement } from '@react-three/fiber';
import { ReactNode } from 'react';
import { QuadMesh } from 'three/webgpu';
import SceneBuilder from '../builders/SceneBuilder';
import { SettingsInput } from '../util/useEvents';
declare module '@react-three/fiber' {
    interface ThreeElements {
        quadMesh: ThreeElement<typeof QuadMesh>;
    }
}
export declare function AsemicCanvas({ children, className, dimensions: [width, height], style, outputChannel, useAudio, highBitDepth }: {
    className?: string;
    dimensions?: [number | string, number | string];
    style?: React.CSSProperties;
    useAudio?: boolean;
    outputChannel?: number | ((ctx: AudioContext) => number);
    highBitDepth?: boolean;
} & React.PropsWithChildren): import("react/jsx-runtime").JSX.Element;
export declare function useAsemic<T extends SettingsInput>({ ...settings }?: {
    controls?: T;
} & Partial<SceneBuilder['sceneSettings']>): any;
export declare function Asemic<T extends SettingsInput>({ children, ...props }: Parameters<typeof useAsemic<T>>[0] & {
    children: ((builder: SceneBuilder) => ReactNode) | ReactNode;
}): import("react/jsx-runtime").JSX.Element;
