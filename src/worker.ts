import { flatMap, isUndefined, max } from 'lodash'
import { Parser } from './parse'
import type { AsemicData, AsemicDataBack, FlatTransform } from './types'
import Renderer from './renderer'

export const createWorker = () => {
  let parser: Parser = new Parser()
  let renderer: Renderer
  let offscreenCanvas: OffscreenCanvas

  self.onmessage = (ev: MessageEvent<AsemicData>) => {
    if (ev.data.offscreenCanvas) {
      renderer = new Renderer(ev.data.offscreenCanvas.getContext('2d')!)
      offscreenCanvas = ev.data.offscreenCanvas
    }
    if (!renderer) return
    if (!isUndefined(ev.data.preProcess)) {
      Object.assign(parser.preProcessing, ev.data.preProcess)
      if (!isUndefined(parser.preProcessing.width))
        offscreenCanvas.width = parser.preProcessing.width
      if (!isUndefined(parser.preProcessing.height))
        offscreenCanvas.height = parser.preProcessing.height
    }
    if (!isUndefined(ev.data.live)) {
      Object.assign(parser.live, ev.data.live)
    }
    if (!isUndefined(ev.data.play)) {
      parser.play(ev.data.play)
      self.postMessage({ osc: parser.output.osc } as AsemicDataBack)
    }
    if (!isUndefined(ev.data.source)) {
      if (parser.rawSource !== ev.data.source) {
        parser.rawSource = ev.data.source
        parser.preProcess(ev.data.source)
        self.postMessage({ settings: parser.settings })
      }

      parser.frame()
      if (parser.settings.h === 'auto') {
        if (parser.curves.length === 0) return

        const maxY = max(flatMap(parser.curves, '1'))! + 0.1

        if (
          offscreenCanvas.height !== Math.floor(maxY * offscreenCanvas.width)
        ) {
          offscreenCanvas.height = offscreenCanvas.width * maxY
          // onResize()

          // animationFrame.current = requestAnimationFrame(() => {
          //   worker.postMessage({
          //     source: scenesSourceRef.current
          //   })
          // })
          // return
        }
      } else {
        renderer.render(parser.output.curves)
        // animationFrame.current = requestAnimationFrame(() => {
        //   worker.postMessage({
        //     source: scenesSourceRef.current
        //   })
        // })
      }

      self.postMessage({
        lastTransform: {
          translation: parser.transform.translation,
          rotation: parser.transform.rotation,
          scale: parser.transform.scale,
          width: parser.getDynamicValue(parser.transform.width)
        } as FlatTransform,
        ...parser.output
      })
    }
  }
}
