import { Color, Pt } from 'pts'
import { AsemicGroup, Parser, Scene } from './parser/Parser'
import { BasicPt } from './blocks/AsemicPt'
import { InputSchema } from '../renderer/inputSchema'
export type { Parser } from './parser/Parser'

export type AsemicData = {
  scene?: Scene
  groups?: AsemicGroup[]
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
