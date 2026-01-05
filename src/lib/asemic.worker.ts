import { flatMap, isUndefined, max } from 'lodash'
import WebGPURenderer from './renderers/visual/WebGPURenderer'
import type { AsemicData } from './types'
import { Parser, Scene } from './parser/Parser'
import { compileWithContext, noise, osc, shape } from './hydra-compiler'
import { invoke } from '@tauri-apps/api/core'
// import { generators, generators as realOsc } from 'hydra-ts'

let parser: Parser = new Parser()
let renderer: WebGPURenderer
let offscreenCanvas: OffscreenCanvas
let currentScene: Scene | null = null

self.onmessage = (ev: MessageEvent<AsemicData>) => {
  if (ev.data.offscreenCanvas) {
    offscreenCanvas = ev.data.offscreenCanvas
    renderer = new WebGPURenderer(ev.data.offscreenCanvas.getContext('webgpu')!)
    renderer.setup().then(() => {
      self.postMessage({
        ready: true
      } as Partial<Parser['output']>)
    })
  }
  // if (!renderer?.device || !offscreenCanvas) return
  if (!offscreenCanvas) return

  if (!isUndefined(ev.data.reset) && ev.data.reset) {
    console.log('setup parser', ev.data)
    parser.setup()
  }
  if (!isUndefined(ev.data.preProcess) && renderer) {
    Object.assign(parser.preProcessing, ev.data.preProcess)
    if (parser.preProcessing.width)
      offscreenCanvas.width = parser.preProcessing.width
    if (parser.preProcessing.height)
      offscreenCanvas.height = parser.preProcessing.height
  }
  if (!isUndefined(ev.data.live)) {
    Object.assign(parser.live, ev.data.live)
  }
  if (!isUndefined(ev.data.loadFiles)) {
    parser.data.loadFiles(ev.data.loadFiles)
  }
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
