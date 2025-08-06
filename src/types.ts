import { Color, Pt } from 'pts'
import { Parser } from './Parser'
import { BasicPt } from './blocks/AsemicPt'
import { InputSchema } from './server/inputSchema'
export type { Parser } from './Parser'
export type { default as Renderer } from './renderers/visual/CanvasRenderer'

export type AsemicData = {
  source?: string
  preProcess?: Partial<Parser['preProcessing']>
  live: {
    keys: string[]
    text: string[]
    index: { type: 'keys' | 'text'; value: number }
  }
  play?: boolean | { scene: number }
  scrub?: number
  offscreenCanvas?: OffscreenCanvas
  startRecording?: boolean
  stopRecording?: boolean
  params?: InputSchema['params']
  presets?: InputSchema['presets']
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
  width: string
  h: string
  s: string
  l: string
  a: string
}
export type FlatTransform = {
  scale: BasicPt
  rotation: number
  translation: BasicPt
  width: number
  length?: number
  offset?: number
}
