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

  postMessage(data: Partial<AsemicData>) {
    if (!this.ready) {
      this.messageQueue.push(data)
      return
    }
    this.worker.postMessage(data)
  }
  dispose() {
    this.worker.terminate()
  }
  constructor(
    canvas: HTMLCanvasElement,
    onmessage?: (data: AsemicDataBack) => void
  ) {
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
          this.worker.postMessage(data)
        }
        this.messageQueue = []
      }
      if (onmessage) onmessage(evt.data)
    }
  }
}
