import { isUndefined } from 'lodash'
import { Parser } from './parse'
import type { AsemicData, AsemicDataBack, FlatTransform } from './types'

export const createWorker = () => {
  let parser: Parser = new Parser()

  self.onmessage = (ev: MessageEvent<AsemicData>) => {
    if (!isUndefined(ev.data.progress)) {
      Object.assign(parser.progress, ev.data.progress)
    }
    if (!isUndefined(ev.data.preProcess)) {
      parser.preProcessing = ev.data.preProcess
    }
    if (!isUndefined(ev.data.live)) {
      Object.assign(parser.live, ev.data.live)
    }
    if (!isUndefined(ev.data.play)) {
      parser.play(ev.data.play)
      console.log('posting osc', parser.output.osc)

      self.postMessage({ osc: parser.output.osc } as AsemicDataBack)
    }
    if (!isUndefined(ev.data.source)) {
      if (parser.rawSource !== ev.data.source) {
        parser.rawSource = ev.data.source
        parser.preProcess(ev.data.source)
        self.postMessage({ settings: parser.settings })
      }

      parser.frame()

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
