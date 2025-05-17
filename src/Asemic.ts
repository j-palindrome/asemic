import { isUndefined } from 'lodash'
// @ts-ignore
import AsemicWorker from './asemic.worker'
import { Parser } from './parse'
import Renderer from './renderer'
import { AsemicData, AsemicDataBack } from './types'

export default class Asemic {
  static defaultSettings = Parser.defaultSettings
  worker = new AsemicWorker() as Worker
  offscreenCanvas: OffscreenCanvas

  postMessage(data: Partial<AsemicData>) {
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
      if (onmessage) onmessage(evt.data)
    }
  }
}
