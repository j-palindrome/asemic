import { flatMap, isUndefined, max } from 'lodash'
import WebGPURenderer from './renderers/visual/WebGPURenderer'
import type { AsemicData, FlatTransform } from './types'
import { Parser } from './parser/Parser'
import { compileWithContext, noise, osc, shape } from './hydra-compiler'
// import { generators, generators as realOsc } from 'hydra-ts'

let parser: Parser = new Parser()
let renderer: WebGPURenderer
let offscreenCanvas: OffscreenCanvas
let animationFrame: number | null = null
let ready = true
// Video recording state
let isRecording = false

const startRecording = async () => {
  if (isRecording) return
  isRecording = true
  self.postMessage({ recordingStarted: true } as Partial<Parser['output']>)
}

const stopRecording = async () => {
  if (!isRecording) return
  isRecording = false
  self.postMessage({ recordingStopped: true } as Partial<Parser['output']>)
}

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

  if (!isUndefined(ev.data.startRecording)) {
    startRecording()
  }
  if (!isUndefined(ev.data.stopRecording)) {
    stopRecording()
  }

  if (!isUndefined(ev.data.preProcess) && renderer) {
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
    parser.scenes.play(ev.data.play)
    self.postMessage({ osc: parser.output.osc } as Partial<Parser['output']>)
  }
  if (!isUndefined(ev.data.scrub)) {
    parser.scenes.scrub(ev.data.scrub)
  }
  if (!isUndefined(ev.data.params)) {
    parser.params = { ...parser.params, ...ev.data.params }
  }
  if (!isUndefined(ev.data.presets)) {
    parser.presets = { ...parser.presets, ...ev.data.presets }
  }
  if (!isUndefined(ev.data.loadFiles)) {
    parser.data.loadFiles(ev.data.loadFiles)
  }
  if (!isUndefined(ev.data.source)) {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
    }
    if (parser.rawSource !== ev.data.source) {
      parser.rawSource = ev.data.source
      parser.setup(ev.data.source)

      self.postMessage({
        settings: parser.settings,
        ...parser.output
      } as Partial<Parser['output']>)
    }

    const animate = async () => {
      if (!ready && animationFrame) {
        cancelAnimationFrame(animationFrame)
      }
      animationFrame = requestAnimationFrame(animate)
      ready = false
      parser.draw()
      for (let group of parser.groups) {
        if (group.settings.synth) {
          parser.output.sc.push({
            path: `${group.settings.synth}/buffer`,
            value: group[0].flatMap(x => [x[0], x[1]])
          })
        }
      }
      renderer.render(parser.groups)

      ready = true

      self.postMessage(parser.output)
    }
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
    }
    animationFrame = requestAnimationFrame(animate)
  }

  if (parser.settings.h === 'auto') {
    const maxY = max(flatMap(parser.groups.flat(), '1'))! + 0.1

    if (offscreenCanvas.height !== Math.floor(maxY * offscreenCanvas.width)) {
      offscreenCanvas.height = offscreenCanvas.width * maxY
      parser.preProcessing.height = offscreenCanvas.height
      self.postMessage({
        preProcessing: parser.preProcessing
      } as Partial<Parser['output']>)
    }
  }
}
