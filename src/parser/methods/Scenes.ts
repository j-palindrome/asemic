import { isUndefined } from 'lodash'
import { AsemicData } from '../../types'
import { InputSchema } from '../../server/inputSchema'

export class SceneMethods {
  parser: any

  constructor(parser: any) {
    this.parser = parser
  }

  scene(
    ...scenes: {
      draw: () => void
      setup?: () => void
      length?: number
      offset?: number
      pause?: number
    }[]
  ) {
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
      this.parser.totalLength += length - offset
    }
    return this.parser
  }

  play(play: AsemicData['play']) {
    if (play === true) {
      if (this.parser.pauseAt) {
        this.parser.pausedAt.push(this.parser.pauseAt)
        this.parser.pauseAt = false
      }
    } else if (typeof play === 'object') {
      if (!isUndefined(play.scene) && this.parser.sceneList[play.scene]) {
        this.parser.reset()
        this.parser.setup(this.parser.rawSource)
        for (let i = 0; i < play.scene; i++) {
          // parse each scene until now to get OSC messages
          this.parser.mode = 'blank'
          try {
            this.parser.sceneList[i].draw(this.parser)
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
        ? this.parser.expr(value)
        : 0,
      min: this.parser.expr(min),
      max: this.parser.expr(max),
      exponent: this.parser.expr(exponent)
    }
    if (!this.parser.output.params) this.parser.output.params = {}
    this.parser.output.params[paramName] = this.parser.params[paramName]
    this.parser.constants[paramName] = () => this.parser.params[paramName].value

    return this.parser
  }

  preset(presetName: string, values: string) {
    const tokenized = this.parser.tokenize(values)
    if (!this.parser.presets[presetName]) {
      this.parser.presets[presetName] = {}
    }
    for (let token of tokenized) {
      const [paramName, value] = token.split('=')
      if (!this.parser.params[paramName]) {
        this.parser.error(
          `Parameter '${paramName}' must be defined before creating preset`
        )
        continue
      }
      this.parser.presets[presetName][paramName] = {
        ...this.parser.params[paramName],
        value: this.parser.expr(value)
      }
    }
    if (!this.parser.output.presets) this.parser.output.presets = {}
    this.parser.output.presets[presetName] = this.parser.presets[presetName]
    return this.parser
  }

  toPreset(presetName: string, amount: string | number = 1) {
    if (!this.parser.presets[presetName]) {
      this.parser.error(`Preset '${presetName}' not found`)
      return this.parser
    }

    const lerpAmount = this.parser.expr(amount)
    for (let paramName of Object.keys(this.parser.presets[presetName])) {
      if (!this.parser.params[paramName]) {
        this.parser.error(
          `Parameter '${paramName}' not found for preset '${presetName}'`
        )
        continue
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
    this.parser.progress.progress = progress

    // Clear any pause states when scrubbing
    this.parser.pauseAt = false
    this.parser.pausedAt = []

    return this.parser
  }
}
