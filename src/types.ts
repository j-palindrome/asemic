import { Pt } from 'pts'
import { Parser } from './parse'
export type { Parser } from './parse'
export type { default as Renderer } from './renderer'

export type AsemicData = {
  source?: string
  preProcess?: Partial<Parser['preProcessing']>
  live: {
    keys: string[]
    text: string[]
    index: { type: 'keys' | 'text'; value: number }
  }
  play?: boolean | { scene: number }
  offscreenCanvas?: OffscreenCanvas
}
export type AsemicDataBack = {
  settings?: Parser['settings']
  lastTransform?: FlatTransform
} & Partial<Parser['output']>

export type Transform = {
  scale: Pt
  rotation: number
  translation: Pt
  width: number | (() => number)
  add?: string
  rotate?: string
  length?: number
}
export type FlatTransform = {
  scale: Pt
  rotation: number
  translation: Pt
  width: number
  length?: number
  offset?: number
}
