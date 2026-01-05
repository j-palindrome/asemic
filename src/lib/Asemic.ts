import { isUndefined } from 'lodash'
// Import worker directly as a URL using Vite's ?worker syntax
// Note: Vite automatically appends ?worker to .ts files in workers
// @ts-ignore
import AsemicWorker from './asemic.worker.ts?worker'
import { Parser, Scene } from '../../legacy/parser/Parser'
import { AsemicData } from './types'

export default class Asemic {
  static defaultSettings = Parser.defaultSettings
  worker: Worker
  offscreenCanvas: OffscreenCanvas
  ready = false
  messageQueue: Partial<AsemicData>[] = []

  postMessage(data: Partial<AsemicData>) {
    this.worker.postMessage(data)
  }

  dispose() {
    this.worker.terminate()
  }

  setup(canvas: HTMLCanvasElement) {
    try {
      this.offscreenCanvas = canvas.transferControlToOffscreen()
      this.worker.postMessage(
        {
          offscreenCanvas: this.offscreenCanvas
        },
        [this.offscreenCanvas]
      )
    } catch (e) {
      console.error('Transferred already')
    }
  }

  constructor(onmessage?: (data: Partial<Parser['output']>) => void) {
    // Create worker using Vite's worker import
    this.worker = new AsemicWorker({ name: 'asemic' })

    this.worker.onmessage = (evt: { data: Partial<Parser['output']> }) => {
      if (evt.data.ready) {
        this.ready = true
        for (const data of this.messageQueue) {
          console.log('posting queued message')
          this.postMessage(data)
        }
        this.messageQueue = []
      }
      if (onmessage) onmessage(evt.data)
    }
  }
}
