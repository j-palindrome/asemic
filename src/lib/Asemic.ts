import { isUndefined } from 'lodash'
// Import worker directly as a URL using Vite's ?worker syntax
// Note: Vite automatically appends ?worker to .ts files in workers
// @ts-ignore
import AsemicWorker from './asemic.worker.ts?worker'
import { Parser, Scene } from './parser/Parser'
import { AsemicData } from './types'

export default class Asemic {
  static defaultSettings = Parser.defaultSettings
  worker: Worker
  offscreenCanvas: OffscreenCanvas
  ready = false
  messageQueue: Partial<AsemicData>[] = []

  postMessage(data: Partial<AsemicData>) {
    if (!isUndefined(data.offscreenCanvas)) {
      this.worker.postMessage(
        {
          offscreenCanvas: data.offscreenCanvas
        },
        [data.offscreenCanvas]
      )
    }

    if (!isUndefined(data.preProcess)) {
      this.worker.postMessage({
        preProcess: data.preProcess
      })
    }

    if (!isUndefined(data.scene)) {
      this.worker.postMessage({
        scene: data.scene,
        preProcess: data.preProcess
      })
    }

    if (!isUndefined(data.live)) {
      this.worker.postMessage({
        live: data.live
      })
    }

    if (!isUndefined(data.play)) {
      this.worker.postMessage({
        play: data.play
      })
    }

    if (!isUndefined(data.scrub)) {
      this.worker.postMessage({
        scrub: data.scrub
      })
    }

    if (!isUndefined(data.startRecording)) {
      this.worker.postMessage({
        startRecording: data.startRecording
      })
    }

    if (!isUndefined(data.stopRecording)) {
      this.worker.postMessage({
        stopRecording: data.stopRecording
      })
    }

    if (!isUndefined(data.files)) {
      this.worker.postMessage({
        files: data.files
      })
    }

    if (!isUndefined(data.loadFiles)) {
      this.worker.postMessage({
        loadFiles: data.loadFiles
      })
    }
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
          this.postMessage(data)
        }
        this.messageQueue = []
      }
      if (onmessage) onmessage(evt.data)
    }
  }
}
