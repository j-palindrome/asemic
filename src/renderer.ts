import { AsemicGroup } from './AsemicPt'

export default abstract class Renderer {
  abstract render(curves: AsemicGroup[]): void
}
