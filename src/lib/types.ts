import { Color, Pt } from 'pts'
import { InputSchema } from '../renderer/inputSchema'

export type AsemicData = {
  preProcess?: Partial<any>
  scene?: any
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

export type BasicPt = {
  x: number
  y: number
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

export interface Scene {
  code: string
  length?: number
  offset?: number
  pause?: number | false
  params?: Record<string, number[]>
  // Runtime-only properties (not persisted):
  scrub: number
  [key: string]: any
  width: number
  height: number
  id: string
}
