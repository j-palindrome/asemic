import { AsemicPt } from 'src/blocks/AsemicPt'
import AsemicRenderer from './AsemicRenderer'
import AsemicCurve from 'src/blocks/AsemicCurve'

export default abstract class AsemicAudio extends AsemicRenderer {
  ctx: AudioContext | null = null
  isSetup = false

  stop(): void {
    if (!this.ctx) return
    this.ctx!.suspend()
  }

  async start() {
    if (!this.isSetup) {
      await this.setup()
      this.isSetup = true
    }
    this.ctx!.resume()
  }
}
