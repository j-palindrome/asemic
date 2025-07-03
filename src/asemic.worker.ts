import { flatMap, isUndefined, max } from 'lodash'
import WebGPURenderer from './renderers/visual/WebGPURenderer'
import { Parser } from './Parser'
import type { AsemicData, AsemicDataBack, FlatTransform } from './types'
import CanvasRenderer from './renderers/visual/CanvasRenderer'
import Renderer from './renderers/AsemicRenderer'
import AsemicAudio from './renderers/AsemicAudio'
import AsemicVisual from './renderers/AsemicVisual'
import ElRenderer from './renderers/audio/ElRenderer'

let parser: Parser = new Parser()
let renderer: AsemicVisual
let audioRenderer: AsemicAudio
let offscreenCanvas: OffscreenCanvas
let animationFrame: number | null = null
let ready = true

// Video recording state
let isRecording = false
let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []

const startRecording = async () => {
  if (isRecording) return

  try {
    // Create a MediaStream from the canvas
    const stream = offscreenCanvas.captureStream(30) // 30 FPS

    // Create MediaRecorder with WebM format
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9'
    })

    recordedChunks = []

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data)
      }
    }

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' })
      self.postMessage({
        recordingStopped: true,
        recordedData: blob
      } as AsemicDataBack)
    }

    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event)
      self.postMessage({
        recordingStopped: false,
        error: 'Recording failed'
      } as AsemicDataBack)
    }

    mediaRecorder.start(100) // Collect data every 100ms
    isRecording = true

    self.postMessage({ recordingStarted: true } as AsemicDataBack)
  } catch (error) {
    console.error('Failed to start recording:', error)
    self.postMessage({
      recordingStarted: false,
      error: 'Failed to initialize recorder'
    } as AsemicDataBack)
  }
}

const stopRecording = async () => {
  if (!isRecording || !mediaRecorder) return

  isRecording = false
  mediaRecorder.stop()
  mediaRecorder = null
}

self.onmessage = async (ev: MessageEvent<AsemicData>) => {
  if (ev.data.offscreenCanvas) {
    offscreenCanvas = ev.data.offscreenCanvas
    renderer = new WebGPURenderer(ev.data.offscreenCanvas.getContext('webgpu')!)
    await renderer.setup()

    postMessage({
      ready: true
    } as AsemicDataBack)
  }
  // if (!renderer?.device || !offscreenCanvas) return
  if (!offscreenCanvas) return
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
    parser.play(ev.data.play)
    self.postMessage({ osc: parser.output.osc } as AsemicDataBack)
  }
  if (!isUndefined(ev.data.scrub)) {
    parser.scrub(ev.data.scrub)
    // Render once to show the scrubbed position
    parser.draw()
    renderer.render(parser.curves)
    self.postMessage({
      lastTransform: {
        translation: parser.currentTransform.translation,
        rotation: parser.currentTransform.rotation,
        scale: parser.currentTransform.scale,
        width: parser.evalExpr(parser.currentTransform.width)
      } as FlatTransform,
      progress: parser.progress.progress,
      totalLength: parser.duration,
      ...parser.output
    } as AsemicDataBack)
  }
  if (!isUndefined(ev.data.source)) {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
    }
    if (parser.rawSource !== ev.data.source) {
      parser.rawSource = ev.data.source
      parser.setup(ev.data.source)
      self.postMessage({ settings: parser.settings })
    }

    const animate = async () => {
      if (!ready) {
        throw new Error('two frames requested at once')
      }
      ready = false
      parser.draw()
      renderer.render(parser.curves)

      // No need for manual frame capture with MediaRecorder

      ready = true
      self.postMessage({
        lastTransform: {
          translation: parser.currentTransform.translation,
          rotation: parser.currentTransform.rotation,
          scale: parser.currentTransform.scale,
          width: parser.evalExpr(parser.currentTransform.width)
        } as FlatTransform,
        progress: parser.progress.progress,
        totalLength: parser.duration,
        ...parser.output
      } as AsemicDataBack)

      animationFrame = requestAnimationFrame(animate)
    }
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
    }
    animationFrame = requestAnimationFrame(animate)

    if (parser.settings.h === 'auto') {
      if (parser.curves.length === 0) return

      const maxY = max(flatMap(parser.curves, '1'))! + 0.1

      if (offscreenCanvas.height !== Math.floor(maxY * offscreenCanvas.width)) {
        offscreenCanvas.height = offscreenCanvas.width * maxY
        parser.preProcessing.height = offscreenCanvas.height
        self.postMessage({
          preProcessing: parser.preProcessing
        } as AsemicDataBack)
      }
    }
  }
  if (!isUndefined(ev.data.startRecording)) {
    await startRecording()
  }
  if (!isUndefined(ev.data.stopRecording)) {
    await stopRecording()
  }
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
    parser.play(ev.data.play)
    self.postMessage({ osc: parser.output.osc } as AsemicDataBack)
  }
  if (!isUndefined(ev.data.scrub)) {
    parser.scrub(ev.data.scrub)
    // Render once to show the scrubbed position
    parser.draw()
    renderer.render(parser.curves)
    self.postMessage({
      lastTransform: {
        translation: parser.currentTransform.translation,
        rotation: parser.currentTransform.rotation,
        scale: parser.currentTransform.scale,
        width: parser.evalExpr(parser.currentTransform.width)
      } as FlatTransform,
      progress: parser.progress.progress,
      totalLength: parser.duration,
      ...parser.output
    } as AsemicDataBack)
  }
  if (!isUndefined(ev.data.source)) {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
    }
    if (parser.rawSource !== ev.data.source) {
      parser.rawSource = ev.data.source
      parser.setup(ev.data.source)
      self.postMessage({ settings: parser.settings })
    }

    const animate = async () => {
      if (!ready) {
        throw new Error('two frames requested at once')
      }
      ready = false
      parser.draw()
      renderer.render(parser.curves)

      // Capture frame if recording
      if (isRecording) {
        await captureFrame()
      }

      ready = true
      self.postMessage({
        lastTransform: {
          translation: parser.currentTransform.translation,
          rotation: parser.currentTransform.rotation,
          scale: parser.currentTransform.scale,
          width: parser.evalExpr(parser.currentTransform.width)
        } as FlatTransform,
        progress: parser.progress.progress,
        totalLength: parser.duration,
        ...parser.output
      } as AsemicDataBack)

      animationFrame = requestAnimationFrame(animate)
    }
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
    }
    animationFrame = requestAnimationFrame(animate)

    if (parser.settings.h === 'auto') {
      if (parser.curves.length === 0) return

      const maxY = max(flatMap(parser.curves, '1'))! + 0.1

      if (offscreenCanvas.height !== Math.floor(maxY * offscreenCanvas.width)) {
        offscreenCanvas.height = offscreenCanvas.width * maxY
        parser.preProcessing.height = offscreenCanvas.height
        self.postMessage({
          preProcessing: parser.preProcessing
        } as AsemicDataBack)
      }
    }
  }
  if (!isUndefined(ev.data.startRecording)) {
    await startRecording()
  }
  if (!isUndefined(ev.data.stopRecording)) {
    await stopRecording()
  }
}
