import { AsemicGroup } from 'src/Parser'
import { AsemicPt } from '../blocks/AsemicPt'

export default abstract class AsemicRenderer {
  abstract setup(): Promise<void>

  abstract render(groups: AsemicGroup[]): void
}
