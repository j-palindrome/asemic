import { AsemicPt } from './AsemicPt'

export default class AsemicCurve extends Array<AsemicPt> {
  type: string

  constructor(props: Pick<AsemicCurve, 'type'>, ...points: AsemicPt[]) {
    super(...points)
    Object.assign(this, props)
    Object.setPrototypeOf(this, AsemicCurve.prototype)
  }
}
