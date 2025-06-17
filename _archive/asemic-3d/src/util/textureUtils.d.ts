import { WebGPURenderer } from 'three/src/Three.WebGPU.js';
export declare function copyGPUTextureToBuffer(renderer: WebGPURenderer, gpuTexture: GPUTexture, x?: number, y?: number, faceIndex?: number, width?: number, height?: number): Promise<any>;
