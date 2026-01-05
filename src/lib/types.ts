import { Color, Pt } from 'pts'
import { Parser, Scene } from '../../legacy/parser/Parser'
import { BasicPt } from '../../legacy/blocks/AsemicPt'
import { InputSchema } from '../renderer/inputSchema'
export type { Parser } from '../../legacy/parser/Parser'

export type AsemicData = {
  preProcess?: Partial<Parser['preProcessing']>
  scene?: Scene
  sceneIndex?: number // Index of current scene for noise table isolation
  live: {
    keys: string[]
    index: { value: number }
  }
  reset?: true
  play?: boolean | { pauseAt: number }
  mouse?: { x: number; y: number; cursorPosition: number }
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
