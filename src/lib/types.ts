import { Color, Pt } from 'pts'
import { Parser, Scene } from './parser/Parser'
import { BasicPt } from './blocks/AsemicPt'
import { InputSchema } from '../renderer/inputSchema'
export type { Parser } from './parser/Parser'

export type AsemicData = {
  scene?: Scene
  preProcess?: Partial<Parser['preProcessing']>
  live: {
    keys: string[]
    text: string[]
    index: { value: number }
  }
  play?:
    | boolean
    | { scene: number; pauseAt: undefined }
    | { pauseAt: number; scene: undefined }
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

export type Transform = {
  '*': BasicPt
  '+': BasicPt
  '@': number
  add?: string
  rotate?: string
  w: number | (() => number)
  h: number | (() => number)
  s: number | (() => number)
  l: number | (() => number)
  a: number | (() => number)
}
export type FlatTransform = {
  scale: BasicPt
  rotation: number
  translation: BasicPt
  width: number
  length?: number
  offset?: number
}
