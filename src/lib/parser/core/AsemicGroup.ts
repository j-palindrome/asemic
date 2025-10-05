import { AsemicPt, BasicPt } from '../../blocks/AsemicPt'

export class AsemicGroup extends Array<AsemicPt[]> {
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
  } = { mode: 'line', vert: '0,0', curve: 'true', count: 100 }
  imageDatas?: ImageData[]
  xy: BasicPt = new BasicPt(0, 0)
  wh: BasicPt = new BasicPt(1, 1)

  constructor(parser: any, settings: Partial<AsemicGroup['settings']> = {}) {
    super()
    this.settings = { ...this.settings, ...settings }
  }

  addCurve(curve: AsemicPt[]) {
    this.push(curve)
  }
}
