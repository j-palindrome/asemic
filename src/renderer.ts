import { AsemicGroup } from './AsemicPt'

export default abstract class Renderer {
  abstract setup(): Promise<void>
  abstract render(curves: AsemicGroup[]): void
}
