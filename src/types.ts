import { Color, Pt } from 'pts'
import { Parser } from './Parser'
import { BasicPt } from './AsemicPt'
export type { Parser } from './Parser'
export type { default as Renderer } from './canvasRenderer'

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
  ready?: boolean
  frameReady?: boolean
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
