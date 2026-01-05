import { AsemicPt, BasicPt } from '../../blocks/AsemicPt'
import { Parser } from '../Parser'

export class AsemicGroup {
  points: Array<AsemicPt[]> = []
  settings: {
    mode: 'line' | 'fill' | 'blank'
    texture?: string
    a?: string
    synth?: string
    xy?: string
    wh?: string
    vert: string
    curve: 'true' | 'false'
    count: number
    correction: number
    close?: boolean
    blend?: boolean
  } = {
    mode: 'line',
    vert: '0,0',
    curve: 'true',
    count: 100,
    correction: 0,
    close: false
  }
  imageDatas?: ImageData[]
  xy: BasicPt = new BasicPt(0, 0)
  wh: BasicPt = new BasicPt(1, 1)
  parser: Parser

  constructor(parser: Parser, settings: Partial<AsemicGroup['settings']> = {}) {
    this.settings = { ...this.settings, ...settings }
    this.parser = parser
  }

  addCurve(curve: AsemicPt[]) {
    this.points.push(curve)
  }
}
