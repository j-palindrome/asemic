import { Color, Pt } from 'pts'
import { InputSchema } from '../renderer/inputSchema'
import { Scene } from './types/Scene'

export type AsemicData = {
  scene?: Scene
  sceneIndex?: number // Index of current scene for noise table isolation
  live: {
    keys: string[]
    index: { value: number }
  }
  reset?: true
  play?: boolean | { pauseAt: number }
  mouse?: { x: number; y: number; cursorPosition: number }
  offscreenCanvas?: OffscreenCanvas
  startRecording?: boolean
  stopRecording?: boolean
  params?: InputSchema['params']
  presets?: InputSchema['presets']
  files?: Record<string, string>
  loadFiles?: Record<string, ImageData[]>
}
