import { isUndefined } from 'lodash'
import { AsemicData, Parser } from '../../types'
import { InputSchema } from '@/renderer/inputSchema'

export class SceneMethods {
  parser: Parser

  constructor(parser: Parser) {
    this.parser = parser
  }

  scene(
    ...scenes: {
      draw: () => void
      setup?: () => void
      length?: number
      offset?: number
      pause?: number | false
    }[]
  ) {
    this.parser.output.scenes = []
    this.parser.output.sceneMetadata = []
    for (let { length = 0.1, offset = 0, pause = 0, draw, setup } of scenes) {
      this.parser.sceneList.push({
        draw,
        setup,
        isSetup: false,
        start: this.parser.totalLength,
        length,
        offset,
        pause
      })
      this.parser.output.scenes.push(this.parser.totalLength)
      this.parser.output.sceneMetadata.push({
        start: this.parser.totalLength,
        length,
        offset
      })
      this.parser.totalLength += length - offset
    }
    this.parser.output.totalLength = this.parser.totalLength
    return this.parser
  }

  play(play: AsemicData['play']) {
    if (play === true) {
      if (this.parser.pauseAt) {
        this.parser.pausedAt.push(this.parser.pauseAt)
        this.parser.pauseAt = false
      }
    } else if (typeof play === 'object') {
      if (!isUndefined(play.pauseAt)) {
        this.parser.pauseAt = play.pauseAt.toFixed(5)
      } else if (
        !isUndefined(play.scene) &&
        this.parser.sceneList[play.scene]
      ) {
        this.parser.reset()
        this.parser.setup(this.parser.rawSource)
        for (let i = 0; i < play.scene; i++) {
          try {
            this.parser.sceneList[i].setup?.()
            this.parser.sceneList[i].isSetup = true
          } catch (e: any) {
            this.parser.output.errors.push(`Error in scene ${i}: ${e.message}`)
          }
        }
        this.parser.mode = 'normal'
        this.parser.progress.progress =
          this.parser.sceneList[play.scene].start +
          this.parser.sceneList[play.scene].offset
        const fixedProgress = this.parser.progress.progress.toFixed(5)
        this.parser.pausedAt = this.parser.pausedAt.filter(
          (x: string) => x <= fixedProgress
        )
        this.parser.pauseAt = false
      }
    }
  }

  preset(presetName: string, values: string) {
    // Method removed - params no longer managed by parser
    return this.parser
  }

  toPreset(presetName: string, amount: string | number = 1) {
    // Method removed - params no longer managed by parser
    return this.parser
  }

  scrub(progress: number) {
    // Clamp progress to valid range
    progress = Math.max(0, Math.min(progress, this.parser.totalLength))

    // Reset and set the progress directly
    this.parser.reset()
    const progTime = progress.toFixed(5)
    const findIndex = this.parser.pausedAt.findIndex(x => x > progTime)
    if (findIndex !== -1) {
      this.parser.pausedAt = this.parser.pausedAt.filter(x => x < progTime)
    }
    if (this.parser.pauseAt > progTime) this.parser.pauseAt = false

    for (let scene of this.parser.sceneList) {
      if (progress >= scene.start + scene.offset) {
      } else {
        break
      }
      this.parser.progress.progress = progress

      return this.parser
    }
  }
}
