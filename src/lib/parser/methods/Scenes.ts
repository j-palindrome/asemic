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

  param(
    paramName: string,
    { value, min = 0, max = 1, exponent = 1 }: InputSchema['params'][string]
  ) {
    this.parser.params[paramName] = {
      type: 'number',
      value: this.parser.params[paramName]
        ? this.parser.params[paramName].value
        : value
        ? this.parser.expressions.expr(value)
        : 0,
      min: this.parser.expressions.expr(min),
      max: this.parser.expressions.expr(max),
      exponent: this.parser.expressions.expr(exponent)
    }
    if (!this.parser.output.params) this.parser.output.params = {}
    this.parser.output.params[paramName] = this.parser.params[paramName]
    this.parser.constants[paramName] = () => this.parser.params[paramName].value

    return this.parser
  }

  preset(presetName: string, values: string) {
    const tokenized = this.parser.parsing.tokenize(values)
    if (!this.parser.presets[presetName]) {
      this.parser.presets[presetName] = {}
    }
    for (let token of tokenized) {
      const [paramName, value] = token.split('=')
      if (!this.parser.params[paramName]) {
        throw new Error(
          `Parameter '${paramName}' must be defined before creating preset`
        )
      }
      this.parser.presets[presetName][paramName] = {
        ...this.parser.params[paramName],
        value: this.parser.expressions.expr(value)
      }
    }
    if (!this.parser.output.presets) this.parser.output.presets = {}
    this.parser.output.presets[presetName] = this.parser.presets[presetName]
    return this.parser
  }

  toPreset(presetName: string, amount: string | number = 1) {
    if (!this.parser.presets[presetName]) {
      throw new Error(`Preset '${presetName}' not found`)
    }

    const lerpAmount = this.parser.expressions.expr(amount)
    for (let paramName of Object.keys(this.parser.presets[presetName])) {
      if (!this.parser.params[paramName]) {
        throw new Error(
          `Parameter '${paramName}' not found for preset '${presetName}'`
        )
      }

      const targetValue = this.parser.presets[presetName][paramName].value
      const currentValue = this.parser.params[paramName].value
      this.parser.params[paramName].value =
        currentValue + (targetValue - currentValue) * lerpAmount
    }
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
