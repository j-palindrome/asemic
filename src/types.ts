import { Pt } from 'pts'
import { Parser } from './parse'

export type AsemicData = {
  source?: string
  progress?: Partial<Parser['progress']>
  settingsSource?: string

  preProcess?: Parser['preProcessing']
  live: {
    keys?: string
    text?: string
    keysIndex?: number
    textIndex?: number
  }
  error?: string
  play?: boolean | { scene: number }
}
export type AsemicDataBack = {
  response?: 'editable'
  bitmap?: ImageBitmap
  errors?: string[]
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
