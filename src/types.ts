import { Pt } from 'pts'
import { Parser } from './parse'

export type AsemicData = {
  source?: string
  preProcess?: Partial<Parser['preProcessing']>
  live: {
    keys?: string
    text?: string
    keysIndex?: number
    textIndex?: number
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
