import { isUndefined } from 'lodash'
// @ts-ignore
import AsemicWorker from './asemic.worker'
import { Parser } from './parse'
import CanvasRenderer from './canvasRenderer'
import { AsemicData, AsemicDataBack } from './types'

export default class Asemic {
  static defaultSettings = Parser.defaultSettings
  worker = new AsemicWorker() as Worker
  offscreenCanvas: OffscreenCanvas
  ready = false
  messageQueue: Partial<AsemicData>[] = []
  animationFrame: number | null
  source: string

  animate() {
    this.worker.postMessage({
      source: this.source
    })

    this.animationFrame = requestAnimationFrame(this.animate)
  }

  postMessage(data: Partial<AsemicData>) {
    if (!this.ready) {
      this.messageQueue.push(data)
      return
    }
    if (data.source) {
      this.source = data.source
      if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame)
      }
      this.animationFrame = requestAnimationFrame(this.animate)
    } else {
      this.worker.postMessage(data)
    }
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
    this.animate = this.animate.bind(this)
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
