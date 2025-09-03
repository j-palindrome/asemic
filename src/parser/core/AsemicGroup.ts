import { AsemicPt, BasicPt } from '../../blocks/AsemicPt'

export class AsemicGroup extends Array<AsemicPt[]> {
  settings: {
    mode: 'line' | 'fill' | 'blank'
    texture?: string
    fragment?: string
    synth?: string
    xy?: string
    wh?: string
  } = { mode: 'line' }
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
