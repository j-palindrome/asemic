import { isUndefined } from 'lodash'
// Import worker directly as a URL using Vite's ?worker syntax
// Note: Vite automatically appends ?worker to .ts files in workers
// @ts-ignore
import AsemicWorker from './asemic.worker.ts?worker'
import { Parser } from './Parser'
import CanvasRenderer from './canvasRenderer'
import { AsemicData, AsemicDataBack } from './types'

export default class Asemic {
  static defaultSettings = Parser.defaultSettings
  worker: Worker
  offscreenCanvas: OffscreenCanvas
  ready = false
  messageQueue: Partial<AsemicData>[] = []
  animationFrame: number | null

  postMessage(data: Partial<AsemicData>) {
    if (!this.ready) {
      this.messageQueue.push(data)
      return
    }
    this.worker.postMessage(data)
  }

  dispose() {
    if (this.animationFrame) {
      window.cancelAnimationFrame(this.animationFrame)
      this.animationFrame = null
    }
    this.worker.terminate()
  }

  constructor(
    canvas: HTMLCanvasElement,
    onmessage?: (data: AsemicDataBack) => void
  ) {
    // Create worker using Vite's worker import
    this.worker = new AsemicWorker({ name: 'asemic' })

    this.offscreenCanvas = canvas.transferControlToOffscreen()
    this.worker.postMessage(
      {
        offscreenCanvas: this.offscreenCanvas
      },
      [this.offscreenCanvas]
    )
    this.worker.onmessage = (evt: { data: Partial<AsemicDataBack> }) => {
      if (evt.data.ready) {
        this.ready = true
        for (const data of this.messageQueue) {
          this.postMessage(data)
        }
        this.messageQueue = []
      }
      if (onmessage) onmessage(evt.data)
    }
  }
}
