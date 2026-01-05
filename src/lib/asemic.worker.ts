import { flatMap, isUndefined, max } from 'lodash'
import WebGPURenderer from './renderers/visual/WebGPURenderer'
import type { AsemicData } from './types'
import { compileWithContext, noise, osc, shape } from './hydra-compiler'
import { invoke } from '@tauri-apps/api/core'
import { Scene } from './types/Scene'
// import { generators, generators as realOsc } from 'hydra-ts'

let renderer: WebGPURenderer
let offscreenCanvas: OffscreenCanvas

self.onmessage = (ev: MessageEvent<AsemicData>) => {
  if (ev.data.offscreenCanvas) {
    offscreenCanvas = ev.data.offscreenCanvas
    renderer = new WebGPURenderer(ev.data.offscreenCanvas.getContext('webgpu')!)
    renderer.setup().then(() => {
      self.postMessage({
        ready: true
      }) as any
    })
  }
  // if (!renderer?.device || !offscreenCanvas) return
  if (!offscreenCanvas) return

  if (!isUndefined(ev.data.groups) && !isUndefined(ev.data.scene)) {
    renderer.render(ev.data.groups, ev.data.scene)
  }
  // if (!isUndefined(ev.data.scene)) {
  //   currentScene = ev.data.scene

  //   parser.draw(currentScene)
  //   renderer.render(parser.groups)
  //   if (parser.output.errors.length > 0) {
  //     self.postMessage({
  //       errors: parser.output.errors
  //     })
  //   }
  // }
}
