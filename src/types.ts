import { Color, Pt } from 'pts'
import { Parser } from './parser/Parser'
import { BasicPt } from './blocks/AsemicPt'
import { InputSchema } from './server/inputSchema'
export type { Parser } from './parser/Parser'
export type { default as Renderer } from './renderers/visual/CanvasRenderer'

export type AsemicData = {
  source?: string
  preProcess?: Partial<Parser['preProcessing']>
  live: {
    keys: string[]
    text: string[]
    index: { value: number }
  }
  play?: boolean | { scene: number }
  mouse?: { x: number; y: number; cursorPosition: number }
  scrub?: number
  offscreenCanvas?: OffscreenCanvas
  startRecording?: boolean
  stopRecording?: boolean
  params?: InputSchema['params']
  presets?: InputSchema['presets']
  files?: Record<string, string>
  loadFiles?: Record<string, ImageData[]>
}
export type AsemicDataBack = {
  settings?: Parser['settings']
  lastTransform?: FlatTransform
  ready?: boolean
  frameReady?: boolean
  totalLength?: number
  progress?: number
  recordingStarted?: boolean
  recordingStopped?: boolean
  recordedData?: Blob
  frameData?: ImageBitmap
  resetPresets?: boolean
} & Partial<Parser['output']>

export type Transform = {
  scale: BasicPt
  translation: BasicPt
  rotation: number
  add?: string
  rotate?: string
  width: number
  h: number
  s: number
  l: number
  a: number
}
export type FlatTransform = {
  scale: BasicPt
  rotation: number
  translation: BasicPt
  width: number
  length?: number
  offset?: number
}

// Add Socket.IO event types for file handling
export interface ReceiveMap {
  'params:reset': () => void
  params: (obj: any) => void
  'sc:synth': (name: string, synthDef: string) => void
  'sc:set': (name: string, param: string, value: number | number[]) => void
  'sc:on': () => void
  'sc:off': () => void
  'files:load': (
    files: string[],
    callback: (filesBitmaps: Record<string, ImageData[]>) => void
  ) => void
  disconnect: () => void
}

export interface SendMap {
  params: (schema: any) => void
  'asemic:param': (args: any[]) => void
  'osc:message': (data: { address: string; data: any[] }) => void
}
