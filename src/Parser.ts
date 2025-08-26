import _, {
  clamp,
  cloneDeep,
  isUndefined,
  last,
  pick,
  range,
  sample,
  sortBy,
  sum,
  sumBy
} from 'lodash'
import {
  defaultSettings,
  splitString,
  splitStringAt,
  splitStringLast
} from './settings'
import { AsemicPt, BasicPt } from './blocks/AsemicPt'
import { AsemicFont, DefaultFont } from './defaultFont'
import { defaultPreProcess, lerp, stripComments } from './utils'
import { AsemicData, Transform } from './types'
import { InputSchema } from './server/inputSchema'
import { log } from 'console'
import { expand } from 'regex-to-strings'
import invariant from 'tiny-invariant'
import { GalleryThumbnails, X } from 'lucide-react'
type ExprFunc = (() => void) | string

const TransformAliases = {
  scale: ['\\*', 'sca', 'scale'],
  rotation: ['\\@', 'rot', 'rotate'],
  translation: ['\\+', 'tra', 'translate'],
  width: ['w', 'wid', 'width']
}

const ONE_FRAME = 1 / 60
const CACHED = range(100).map(x => sum(range(x).map(x => 1 / (x + 1))))
const defaultTransform: () => Transform = () => ({
  translation: new BasicPt(0, 0),
  scale: new BasicPt(1, 1),
  rotation: 0,
  width: '1',
  h: '0',
  s: '0',
  l: '1',
  a: '1',
  mode: 'line' as 'line' | 'fill'
})

type Expr = string | number

const defaultOutput = () => ({
  osc: [] as { path: string; args: (string | number | [number, number])[] }[],
  sc: [] as { path: string; value: number }[],
  scSynthDefs: {} as Record<string, string>,
  curves: [],
  errors: [] as string[],
  pauseAt: false as string | false,
  eval: [] as string[],
  params: undefined as InputSchema['params'] | undefined,
  presets: undefined as InputSchema['presets'] | undefined,
  resetParams: false,
  resetPresets: false,
  files: [] as string[]
})

// Add Group class
export class AsemicGroup extends Array<AsemicPt[]> {
  settings: {
    mode: 'line' | 'fill'
    texture?: string
    xy?: string
    wh?: string
  } = { mode: 'line' }
  imageDatas?: ImageData[]
  xy: BasicPt = new BasicPt(0, 0)
  wh: BasicPt = new BasicPt(1, 1)

  constructor(parser: Parser, settings: Partial<AsemicGroup['settings']> = {}) {
    super()
    this.settings = { ...this.settings, ...settings }
  }

  addCurve(curve: AsemicPt[]) {
    this.push(curve)
  }
}

export class Parser {
  rawSource = ''
  presets: Record<string, InputSchema['params']> = {}
  protected mode = 'normal' as 'normal' | 'blank'
  protected adding = 0
  protected debugged = new Map<string, { errors: string[] }>()
  groups: AsemicGroup[] = []
  settings = defaultSettings()
  static defaultSettings = defaultSettings()
  protected currentCurve: AsemicPt[] = []
  currentTransform: Transform = defaultTransform()
  protected transforms: Transform[] = []
  protected namedTransforms: Record<string, Transform> = {}
  protected totalLength = 0
  protected pausedAt: string[] = []
  protected pauseAt: string | false = false
  protected sceneList: {
    start: number
    length: number
    draw: (p: Parser) => void
    pause: false | number
    offset: number
    isSetup: boolean
    setup?: (p: Parser) => void
  }[] = []
  params = {} as InputSchema['params']
  progress = {
    point: 0,
    time: performance.now() / 1000,
    curve: 0,
    seed: Math.random(),
    indexes: range(3).map(x => 0),
    countNums: range(3).map(x => 0),
    accums: [] as number[],
    accumIndex: 0,
    letter: 0,
    scrub: 0,
    scrubTime: 0,
    progress: 0,
    regexCache: {} as Record<string, string[]>
  }
  live = {
    keys: ['']
  }

  curveConstants: Record<string, (args: string) => void> = {
    repeat: args => {
      const [count, evaluation] = splitString(args, /\s/)
      this.repeat(count, evaluation)
    },
    within: args => {
      const [coord0, coord1, ...rest] = this.tokenize(args)
      this.within(coord0, coord1, rest.join(' '))
    },
    circle: args => {
      this.circle(args)
    },
    debug: () => this.debug()
  }

  pointConstants: Record<string, (...args: string[]) => BasicPt> = {
    '>': (progress, ...points) => {
      const exprPoints = points.map(x => this.evalPoint(x, { basic: true }))
      let exprFade = this.expr(progress)
      if (exprFade >= 1) exprFade = 0.999
      else if (exprFade < 0) exprFade = 0

      let index = (exprPoints.length - 2) * exprFade
      let start = Math.floor(index)

      const bezier = (
        point1: BasicPt,
        point2: BasicPt,
        point3: BasicPt,
        amount: number
      ) => {
        const u = 1 - amount

        return point1
          .clone()
          .scale([u ** 2, u ** 2])
          .add(
            point2
              .clone()
              .scale([2 * u * amount, 2 * u * amount])
              .add(point3.clone().scale([amount ** 2, amount ** 2]))
          )
      }

      return bezier(
        exprPoints[start],
        exprPoints[start + 1],
        exprPoints[start + 2],
        index % 1
      )
    }
  }

  index() {}

  constants: Record<string, ((...args: string[]) => number) | (() => number)> =
    {
      N: (index = 1) => {
        if (!index) index = 1
        return this.progress.countNums[this.expr(index, false) - 1]
      },
      I: (index = 1) => {
        if (!index) index = 1
        return this.progress.indexes[this.expr(index, false) - 1]
      },
      i: (index = 1) => {
        if (!index) index = 1
        const solveIndex = this.expr(index, false) - 1
        return (
          this.progress.indexes[solveIndex] /
          (this.progress.countNums[solveIndex] - 1)
        )
      },
      T: () => {
        return this.progress.time
      },
      '!': continuing => {
        const continuingSolved = this.expr(continuing, false)
        return continuingSolved ? 0 : 1
      },
      H: () => this.preProcessing.height / this.preProcessing.width,
      Hpx: () => this.preProcessing.height,
      Wpx: () => this.preProcessing.height,
      S: () => this.progress.scrubTime,
      C: () => this.progress.curve,
      L: () => this.progress.letter,
      P: () => this.progress.point,
      px: () => 1 / this.preProcessing.width,
      sin: x => Math.sin(this.expr(x, false) * Math.PI * 2) * 0.5 + 0.5,
      table: (name, point, channel) => {
        const imageName = typeof name === 'string' ? name : String(name)
        return this.table(imageName, point, channel)
      },
      acc: x => {
        if (!this.progress.accums[this.progress.accumIndex])
          this.progress.accums.push(0)
        const value = this.expr(x, false)
        // correct for 60fps
        this.progress.accums[this.progress.accumIndex] += value / 60
        const currentAccum = this.progress.accums[this.progress.accumIndex]
        this.progress.accumIndex++
        return currentAccum
      },
      '>': (...args) => {
        let exprFade = this.expr(args[0])
        if (exprFade >= 1) exprFade = 0.999
        else if (exprFade < 0) exprFade = 0
        const exprPoints = [...args.slice(1)].map(x => this.expr(x, false))

        let index = (exprPoints.length - 1) * exprFade

        return lerp(
          exprPoints[Math.floor(index)]!,
          exprPoints[Math.floor(index) + 1]!,
          index % 1
        )
      },
      '~': (speed = 1, ...freqs) => {
        let sampleIndex = this.noiseIndex
        while (sampleIndex > this.noiseTable.length - 1) {
          let frequencies: number[]
          if (freqs.length) {
            frequencies = freqs.map(x => this.expr(x, false))
          } else {
            frequencies = range(3).map(() => Math.random())
          }
          this.noiseTable.push(x => {
            return this.noise(x, frequencies) * 0.5 + 0.5
          })
          this.noiseValues.push(0)
        }

        const value = this.expr(speed) / 60
        this.noiseValues[this.noiseIndex] += value

        const noise = this.noiseTable[this.noiseIndex](
          this.noiseValues[this.noiseIndex]
        )
        this.noiseIndex++

        return noise
      }
    }
  sortedKeys: string[] = Object.keys(this.constants).sort(x => x.length - 1)

  protected reservedConstants = Object.keys(this.constants)
  protected fonts: Record<string, AsemicFont> = {
    default: new DefaultFont(this)
  }
  protected currentFont = 'default'
  protected lastPoint: AsemicPt = new AsemicPt(this, 0, 0)
  protected noiseTable: ((x: number) => number)[] = []
  protected noiseValues: number[] = []
  protected noiseIndex = 0
  protected images: Record<string, ImageData[]> = {}
  protected canvas2DContext: OffscreenCanvasRenderingContext2D | null = null
  output = defaultOutput()
  preProcessing = defaultPreProcess()

  protected getDynamicValue(value: number | (() => number)) {
    return typeof value === 'function' ? value() : value
  }

  protected error(text: string) {
    if (!this.output.errors.includes(text)) {
      this.output.errors.push(text)
    }
  }

  protected reset({ newFrame = true } = {}) {
    if (newFrame) {
      this.groups = []
      this.progress.time = performance.now() / 1000
      this.progress.progress += this.pauseAt !== false ? 0 : ONE_FRAME
      if (this.progress.progress >= this.totalLength - ONE_FRAME) {
        this.pausedAt = []
        this.progress.progress = 0
      }

      this.output = defaultOutput()
      this.output.pauseAt = this.pauseAt
    }
    this.transforms = []
    this.lastPoint = new AsemicPt(this, 0, 0)
    for (let font in this.fonts) this.fonts[font].reset()
    this.currentTransform = defaultTransform()
    this.currentCurve = []
    this.currentFont = 'default'
    this.progress.point = 0
    this.progress.curve = 0
    for (let i = 0; i < 3; i++) {
      this.progress.indexes[i] = 0
      this.progress.countNums[i] = 0
    }
    this.noiseIndex = 0
    this.progress.accumIndex = 0
    this.progress.seed = 1
  }

  play(play: AsemicData['play']) {
    if (play === true) {
      if (this.pauseAt) {
        this.pausedAt.push(this.pauseAt)
        this.pauseAt = false
      }
    } else if (typeof play === 'object') {
      if (!isUndefined(play.scene) && this.sceneList[play.scene]) {
        this.reset()
        this.setup(this.rawSource)
        for (let i = 0; i < play.scene; i++) {
          // parse each scene until now to get OSC messages
          this.mode = 'blank'
          try {
            this.sceneList[i].draw(this)
          } catch (e) {
            this.output.errors.push(`Error in scene ${i}: ${e.message}`)
          }
        }
        this.mode = 'normal'
        this.progress.progress =
          this.sceneList[play.scene].start + this.sceneList[play.scene].offset
        const fixedProgress = this.progress.progress.toFixed(5)
        this.pausedAt = this.pausedAt.filter(x => x <= fixedProgress)
        this.pauseAt = false
      }
    }
  }

  test(condition: Expr, callback?: () => void, callback2?: () => void) {
    const exprCondition = this.expr(condition, false)
    if (exprCondition) {
      callback && callback()
    } else {
      callback2 && callback2()
    }
    return this
  }

  toPreset(presetName: string, amount: Expr = 1) {
    if (!this.presets[presetName]) {
      this.error(`Preset '${presetName}' not found`)
      return this
    }

    const lerpAmount = this.expr(amount)
    for (let paramName of Object.keys(this.presets[presetName])) {
      if (!this.params[paramName]) {
        this.error(
          `Parameter '${paramName}' not found for preset '${presetName}'`
        )
        continue
      }

      const targetValue = this.presets[presetName][paramName].value
      const currentValue = this.params[paramName].value
      this.params[paramName].value =
        currentValue + (targetValue - currentValue) * lerpAmount
    }
    return this
  }

  preset(presetName: string, values: string) {
    const tokenized = this.tokenize(values)
    if (!this.presets[presetName]) {
      this.presets[presetName] = {}
    }
    for (let token of tokenized) {
      const [paramName, value] = token.split('=')
      if (!this.params[paramName]) {
        this.error(
          `Parameter '${paramName}' must be defined before creating preset`
        )
        continue
      }
      this.presets[presetName][paramName] = {
        ...this.params[paramName],
        value: this.expr(value)
      }
    }
    if (!this.output.presets) this.output.presets = {}
    this.output.presets[presetName] = this.presets[presetName]
    return this
  }

  synth(name: string, code: string) {
    this.output.scSynthDefs[name] = code
    return this
  }

  sc(args: string) {
    const [path, value] = splitString(args, ' ')
    this.output.sc.push({ path, value: this.expr(value) })
    return this
  }

  param(
    paramName: string,
    { value, min = 0, max = 1, exponent = 1 }: InputSchema['params'][string]
  ) {
    this.params[paramName] = {
      type: 'number',
      value: this.params[paramName]
        ? this.params[paramName].value
        : value
        ? this.expr(value)
        : 0,
      min: this.expr(min),
      max: this.expr(max),
      exponent: this.expr(exponent)
    }
    if (!this.output.params) this.output.params = {}
    this.output.params[paramName] = this.params[paramName]
    this.constants[paramName] = () => this.params[paramName].value

    return this
  }

  scrub(progress: number) {
    // Clamp progress to valid range
    progress = Math.max(0, Math.min(progress, this.totalLength))

    // Reset and set the progress directly
    this.reset()
    this.progress.progress = progress

    // Clear any pause states when scrubbing
    this.pauseAt = false
    this.pausedAt = []

    return this
  }

  get duration() {
    return this.totalLength
  }

  repeat(count: string, callback: ExprFunc) {
    const counts = this.tokenize(count, { separatePoints: true }).map(x =>
      this.expr(x)
    )

    const iterate = (index: number) => {
      const prevIndex = this.progress.indexes[index]
      const prevCountNum = this.progress.countNums[index]
      this.progress.countNums[index] = counts[index]
      for (let i = 0; i < this.progress.countNums[index]; i++) {
        this.progress.indexes[index] = i
        this.evalExprFunc(callback)
        if (counts[index + 1]) {
          iterate(index + 1)
        }
      }
      this.progress.indexes[index] = prevIndex
      this.progress.countNums[index] = prevCountNum
    }
    iterate(0)

    return this
  }

  draw() {
    this.reset()
    let i = 0
    for (let object of this.sceneList) {
      if (
        this.progress.progress >= object.start &&
        this.progress.progress < object.start + object.length
      ) {
        this.reset({ newFrame: false })
        this.progress.scrub =
          (this.progress.progress - object.start) / object.length
        this.progress.scrubTime = this.progress.progress - object.start
        try {
          object.draw(this)
        } catch (e) {
          this.error(
            `Scene ${i} failed: ${e instanceof Error ? e.message : String(e)}`
          )
        }
        i++

        if (
          this.pauseAt === false &&
          object.pause !== false &&
          this.progress.progress >= object.start + (object.pause - 0.02)
        ) {
          const pause = (object.start + object.pause).toFixed(5)
          if (!this.pausedAt.includes(pause)) {
            this.pauseAt = pause
            break
          }
        }
      }
    }
  }

  protected debug(slice: number = 0) {
    const toFixed = (x: number) => {
      const str = x.toFixed(2)
      return str
    }
    const allCurves = this.groups.flat().concat([this.currentCurve])
    const c = allCurves
      .slice(slice)
      .map(
        curve =>
          `[${curve.map(x => `${toFixed(x[0])},${toFixed(x[1])}`).join(' ')}]`
      )
      .join('\n')
    this.output.errors.push(c)
    return c
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
      this.sceneList.push({
        draw,
        setup,
        isSetup: false,
        start: this.totalLength,
        length,
        offset,
        pause
      })
      this.totalLength += length - offset
    }
    return this
  }

  set(settings: Partial<this['settings']>) {
    Object.assign(this.settings, settings)
    return this
  }

  protected getBounds(fromGroup: number, toGroup?: number) {
    let minX: number | undefined = undefined,
      minY: number | undefined = undefined,
      maxX: number | undefined = undefined,
      maxY: number | undefined = undefined
    for (let group of this.groups.slice(fromGroup, toGroup)) {
      for (const point of group.flat()) {
        if (minX === undefined || point[0] < minX) {
          minX = point[0]
        }
        if (maxX === undefined || point[0] > maxX) {
          maxX = point[0]
        }
        if (minY === undefined || point[1] < minY) {
          minY = point[1]
        }
        if (maxY === undefined || point[1] > maxY) {
          maxY = point[1]
        }
      }
    }
    return [minX, minY, maxX, maxY]
  }

  protected evalExprFunc(callback: ExprFunc) {
    if (typeof callback === 'string') this.parse(callback)
    else callback()
  }

  within(coord0: string, coord1: string, callback: ExprFunc) {
    // const points = this.tokenize(coords)
    const [x, y] = this.parsePoint(coord0)
    const [x2, y2] = this.parsePoint(coord1)
    const startGroup = this.groups.length
    this.evalExprFunc(callback)
    const [minX, minY, maxX, maxY] = this.getBounds(startGroup)
    const newWidth = x2 - x
    const newHeight = y2 - y
    const oldWidth = maxX! - minX!
    const oldHeight = maxY! - minY!
    const scaleX = newWidth / (oldWidth || 1)
    const scaleY = newHeight / (oldHeight || 1)

    for (let i = startGroup; i < this.groups.length; i++) {
      for (let curve of this.groups[i]) {
        for (let pt of curve) {
          pt[0] = x + (pt[0] - minX!) * scaleX
          pt[1] = y + (pt[1] - minY!) * scaleY
        }
      }
    }

    if (this.currentCurve.length) {
      this.currentCurve = this.currentCurve.map(pt => {
        pt[0] = x + (pt[0] - minX!) * scaleX
        pt[1] = y + (pt[1] - minY!) * scaleY
        return pt
      })
    }
    return this
  }

  processMouse(mouse: NonNullable<AsemicData['mouse']>) {
    // const sceneSource = this.rawSource.slice(0, mouse.cursorPosition)
    // this.rawSource = sceneSource

    // this.setup(sceneSource)
    this.draw()

    const x = mouse.x / this.preProcessing.width
    const y = mouse.y / this.preProcessing.height
    console.log(x, y)

    // Update the last point in the temporary parser
    const point = new AsemicPt(this, x, y)

    // Optionally, apply the current transform to the mouse position
    this.reverseTransform(point)

    return point
  }

  center(coords: string, callback: () => void) {
    const [centerX, centerY] = this.parsePoint(coords)
    const startGroup = this.groups.length

    callback()
    const addedGroups = this.groups.slice(startGroup)

    const [minX, minY, maxX, maxY] = this.getBounds(startGroup)

    const boundingCenterX = (minX! + maxX!) / 2
    const boundingCenterY = (minY! + maxY!) / 2

    const dx = centerX - boundingCenterX
    const dy = centerY - boundingCenterY
    const difference = new BasicPt(dx, dy)

    for (const group of addedGroups) {
      for (const pt of group.flat()) {
        pt.add(difference)
      }
    }

    return this
  }

  each(makeCurves: () => void, callback: (pt: AsemicPt) => void) {
    const start = this.groups.length
    const saveProgress = this.progress.curve
    makeCurves()
    const finalProgress = this.progress.curve
    this.progress.curve = saveProgress
    for (const group of this.groups.slice(start)) {
      this.progress.point = 0
      for (const pt of group.flat()) {
        this.progress.curve++
        this.progress.point += 1 / (group.flat().length - 1)
        callback(pt)
      }
    }
    return this
  }

  setup(source: string) {
    this.progress.seed = Math.random()
    // for (let replacement of Object.keys(this.preProcessing.replacements)) {
    //   source = source.replace(
    //     replacement,
    //     this.preProcessing.replacements[replacement]
    //   )
    // }
    this.fonts = { default: new DefaultFont(this) }
    this.totalLength = 0

    this.settings = defaultSettings()
    this.sceneList = []
    this.rawSource = source

    // Use Function constructor with 'this' bound to the Parser instance
    const setupFunction = new Function(
      'source',
      `
      with (this) {
        ${source.replaceAll('->', '()=>')}
      }
    `
    ).bind(this)

    this.output.resetParams = true
    this.output.resetPresets = true
    try {
      setupFunction(source)
      this.sortedKeys = Object.keys(this.constants).sort(x => x.length * -1)
    } catch (e) {
      this.output.errors.push(`Setup failed: ${e.message}`)
    }
  }

  protected hash = (n: number): number => {
    // Convert to string, multiply by a prime number, and take the fractional part
    const val = Math.sin(n) * (43758.5453123 + this.progress.seed)
    return Math.abs(val - Math.floor(val)) // Return the fractional part (0-1)
  }

  protected mapCurve(
    multiplyPoints: AsemicPt[],
    addPoints: AsemicPt[],
    start: AsemicPt,
    end: AsemicPt,
    { add = false } = {}
  ) {
    const angle = end.clone(true).subtract(start).angle0to1()
    const distance = end.clone(true).subtract(start).magnitude()

    const previousLength = this.adding
    this.adding += multiplyPoints.length + 2
    multiplyPoints = multiplyPoints.map((x, i) => {
      this.progress.point = (previousLength + 1 + i) / this.adding
      return x
        .clone()
        .scale([distance, 1])
        .add(addPoints[i])
        .rotate(angle)
        .add(start)
    })
    const mappedCurve = add
      ? [start, ...multiplyPoints, end]
      : [start, ...multiplyPoints, end]
    mappedCurve.forEach((x, i) => {
      this.applyTransform(x, { relative: false })
    })
    // this.crv()
    this.currentCurve.push(...(add ? mappedCurve.slice(0, -1) : mappedCurve))

    // this.lastPoint = end.clone()
    if (!add) {
      this.end()
    }
  }

  protected parseArgs(args: string[]) {
    this.progress.point = 0
    const startPoint = this.parsePoint(args[0], { randomize: true })
    this.progress.point = 1
    const endPoint = this.parsePoint(args[1], { randomize: true })

    this.reverseTransform(startPoint)
    this.reverseTransform(endPoint)

    let h = 0,
      w = 0
    if (args.length >= 3) {
      const hwParts = this.tokenize(args[2], { separatePoints: true })
      h = this.expr(hwParts[0])!
      w = hwParts.length > 1 ? this.expr(hwParts[1])! : 0
    }

    return [startPoint, endPoint, h, w] as [AsemicPt, AsemicPt, number, number]
  }

  osc(args: string) {
    const [path, ...argsArray] = splitString(args, ' ')
    this.output.osc.push({
      path,
      args: argsArray.map(x => {
        if (x.startsWith("'")) {
          return x.substring(1)
        } else if (x.startsWith('"')) {
          return x.substring(1, x.length - 1)
        } else if (x.includes(',')) {
          return [...this.evalPoint(x)] as [number, number]
        } else {
          const evaluated = this.expr(x)
          return isNaN(evaluated) ? x : evaluated
        }
      })
    })
    return this
  }

  tri(argsStr: string, { add = false } = {}) {
    const args = this.tokenize(argsStr)
    const [start, end, h] = this.parseArgs(args)
    this.mapCurve(
      [new AsemicPt(this, 0.5, h * 2)],
      [new AsemicPt(this, 0, 0)],
      start,
      end,
      { add }
    )
    return this
  }
  squ(argsStr: string, { add = false } = {}) {
    const args = this.tokenize(argsStr)
    const [start, end, h, w] = this.parseArgs(args)
    this.mapCurve(
      [new AsemicPt(this, 0, h), new AsemicPt(this, 1, h)],
      [new AsemicPt(this, -w, 0), new AsemicPt(this, w, 0)],
      start,
      end,
      { add }
    )
    return this
  }
  pen(argsStr: string, { add = false } = {}) {
    const args = this.tokenize(argsStr)

    const [start, end, h, w] = this.parseArgs(args)
    this.mapCurve(
      [
        new AsemicPt(this, 0, h * 0.5),
        new AsemicPt(this, 0.5, h * 1.1),
        new AsemicPt(this, 1, h * 0.5)
      ],
      [
        new AsemicPt(this, -w * 2, 0),
        new AsemicPt(this, 0, 0),
        new AsemicPt(this, w * 2, 0)
      ],
      start,
      end,
      { add }
    )
    return this
  }

  hex(argsStr: string) {
    const args = this.tokenize(argsStr)
    const [start, end, h, w] = this.parseArgs(args)
    this.mapCurve(
      [
        new AsemicPt(this, 0, 0),
        new AsemicPt(this, 0, h),
        new AsemicPt(this, 1, h),
        new AsemicPt(this, 1, 0)
      ],
      [
        new AsemicPt(this, -w, 0),
        new AsemicPt(this, -w, 0),
        new AsemicPt(this, w, 0),
        new AsemicPt(this, w, 0)
      ],
      start,
      end
    )
    return this
  }

  seq(argsStr: string) {
    const args = this.tokenize(argsStr)
    const count = this.expr(args[0])
    const expression = args[1]

    const points: AsemicPt[] = []

    for (let i = 0; i < count; i++) {
      this.progress.point = i / (count - 1 || 1)
      const value = this.expr(expression)
      points.push(new AsemicPt(this, value, value))
    }

    this.currentCurve.push(...points)
    this.end()
    return this
  }

  circle(argsStr: string) {
    const [centerStr, whStr] = this.tokenize(argsStr)
    const lastTo = this.cloneTransform(this.currentTransform)
    const center = this.evalPoint(centerStr)
    const [w, h] = this.evalPoint(whStr)
    this.to(`+${center[0]},${center[1]}`)

    const points: AsemicPt[] = [
      this.applyTransform(new AsemicPt(this, w, 0)),
      this.applyTransform(new AsemicPt(this, w, h)),
      this.applyTransform(new AsemicPt(this, -w, h)),
      this.applyTransform(new AsemicPt(this, -w, -h)),
      this.applyTransform(new AsemicPt(this, w, -h)),
      this.applyTransform(new AsemicPt(this, w, 0))
    ]

    this.currentCurve.push(
      ...points.map((x, i) => {
        this.progress.point =
          i === points.length - 1 ? 0 : i / (points.length - 2)
        return x.clone()
      })
    )
    this.lastPoint = last(this.currentCurve)!
    this.end()
    this.currentTransform = lastTo
    return this
  }

  noise(value: number, frequencies: number[], phases: number[] = []) {
    let sum = 0
    for (let i = 0; i < frequencies.length; i++) {
      sum +=
        Math.cos(
          frequencies[i] * (i + 1) * (value + (phases[i] || this.hash(i + 10)))
        ) /
        (i + 1)
    }
    return sum / CACHED[frequencies.length]
  }

  parse(text: string, args: string[] = []) {
    for (let i = 0; i < args.length; i++) {
      text = text.replaceAll(`$${i}`, args[i])
    }
    text = text.replaceAll(/^\s*\/\/.*/gm, '').trim()
    const tokenization: string[] = this.tokenize(text)

    for (let token of tokenization) {
      let sliced = token.substring(1, token.length - 1)
      switch (token[0]) {
        case '/':
          this.regex(sliced)
          break
        case '"':
          this.text(sliced)
          break
        case '(':
          const [functionCall, funcArgs] = splitString(sliced, /\s/)
          if (!this.curveConstants[functionCall]) {
            throw new Error(`Unknown function: ${functionCall}`)
          }
          this.curveConstants[functionCall](funcArgs)
          break
        case '{':
          this.to(sliced)
          break
        case '[':
          this.line(sliced)
          break
      }
    }

    return this
  }

  expr(expr: Expr, replace = true): number {
    const returnedExpr = this.exprEval(expr, replace)
    if (Number.isNaN(returnedExpr)) {
      throw new Error(`Expr ${expr} is NaN`)
    }
    return returnedExpr
  }

  protected exprEval(expr: Expr, replace = true): number {
    if (expr === undefined || expr === null) {
      throw new Error('undefined or null expression')
    }
    if (typeof expr === 'number') {
      return expr
    }
    expr = expr.trim()

    if (expr.length === 0) throw new Error('Empty expression')

    this.progress.curve++

    if (replace) {
      if (expr.includes('`')) {
        const matches = expr.matchAll(/`([^`]+)`/g)
        for (let match of matches) {
          const [original, expression] = match
          expr = expr.replace(original, eval(expression))
        }
      }
    }

    if (expr.includes('(')) {
      let bracket = 1
      const start = expr.indexOf('(') + 1
      let end = start
      for (; end < expr.length; end++) {
        if (expr[end] === '(') bracket++
        else if (expr[end] === ')') {
          bracket--
          if (bracket === 0) break
        }
      }

      const solvedExpr = expr.substring(start, end)

      return this.expr(
        expr.substring(0, start - 1) +
          this.expr(solvedExpr).toFixed(4) +
          expr.substring(end + 1)
      )
    }

    if (expr.match(/^\-?[0-9\.]+$/)) {
      return parseFloat(expr)
    }

    invariant(typeof expr === 'string')
    let stringExpr = expr as string

    if (stringExpr.includes(' ')) {
      // const sortedKeys = sortBy(
      //   Object.keys(this.constants),
      //   x => x.length * -1
      // )
      const [funcName, ...args] = this.tokenize(expr, {
        separatePoints: false
      })
      if (this.constants[funcName]) {
        return this.constants[funcName](...args)
      }
    }

    const operatorsList = ['&&', '^^', '_', '+', '-', '*', '/', '%', '^']

    if (expr.includes('_')) {
      const [funcName, ...args] = this.tokenize(expr, {
        separateFragments: true
      })

      const foundKey = this.sortedKeys.find(x => funcName.startsWith(x))
      if (foundKey) {
        const arg1 = funcName.slice(foundKey.length).trim()
        return this.constants[foundKey](arg1, ...args)
      }
    }

    for (let i = stringExpr.length - 1; i >= 0; i--) {
      let operator = operatorsList.find(
        x => stringExpr.substring(i, i + x.length) === x
      )
      if (operator) {
        if (
          stringExpr[i] === '-' &&
          stringExpr[i - 1] &&
          '*+/%()'.includes(stringExpr[i - 1])
        )
          continue
        let operators: [number, number] = splitStringAt(
          stringExpr,
          i,
          operator.length
        ).map(x => this.expr(x || 0, false)!) as [number, number]
        switch (operator) {
          case '&':
            return operators[0] && operators[1] ? 1 : 0

          case '|':
            return operators[0] || operators[1] ? 1 : 0

          case '^':
            return operators[0] ** operators[1]

          case '#':
            let [round, after] = operators

            const afterNum = this.expr(after || 0, false)
            if (!afterNum) {
              return this.expr(round, false)
            } else {
              return Math.floor(this.expr(round) / afterNum) * afterNum
            }

          case '+':
            return operators[0] + operators[1]

          case '-':
            return operators[0] - operators[1]

          case '*':
            return operators[0] * operators[1]

          case '/':
            return operators[0] / operators[1]

          case '%':
            return operators[0] % operators[1]
        }
      }
    }

    const sortedKeys = Object.keys(this.constants).sort(x => x.length * -1)
    const foundKey = sortedKeys.find(x => (expr as string).startsWith(x))
    if (foundKey) {
      const arg1 = expr.slice(foundKey.length).trim()
      return this.constants[foundKey](arg1)
    }

    throw new Error(`Unknown function ${expr}`)
  }

  choose(value0To1: Expr, ...callbacks: (() => void)[]) {
    const normalizedValue = this.expr(value0To1)
    const numCallbacks = callbacks.length

    if (numCallbacks === 0) return this

    // Scale the value to the number of callbacks and clamp it
    const index = Math.ceil(clamp(normalizedValue, 0, 0.999999) * numCallbacks)

    // Call the selected callback
    if (callbacks[index]) {
      callbacks[index]()
    }

    return this
  }

  protected evalPoint<K extends boolean>(
    point: string,
    { basic = false as any }: { basic?: K } = {} as any
  ): K extends true ? BasicPt : AsemicPt {
    if (
      point.startsWith('(') &&
      point.endsWith(')')
      // this.tokenize(point, { stopAt0: true })[0].length === point.length
    ) {
      const sliced = point.substring(1, point.length - 1)
      const tokens = this.tokenize(sliced)
      if (tokens.length > 1) {
        for (let key in this.pointConstants) {
          if (tokens[0] === key) {
            return (
              basic
                ? this.pointConstants[tokens[0]](...tokens.slice(1))
                : new AsemicPt(
                    this,
                    ...this.pointConstants[tokens[0]](...tokens.slice(1))
                  )
            ) as K extends true ? BasicPt : AsemicPt
          }
        }
      }
    } else if (point.startsWith('@')) {
      const [theta, radius] = this.tokenize(point.slice(1), {
        separatePoints: true
      }).map(X => this.expr(X))
      return (
        basic
          ? new BasicPt(radius, 0).rotate(theta)
          : new AsemicPt(this, radius, 0).rotate(theta)
      ) as K extends true ? BasicPt : AsemicPt
    } else if (point.startsWith('<')) {
      const groupIndex = this.groups.length - 1
      let [pointN, thisN = -1] = this.tokenize(point.slice(1), {
        separatePoints: true
      })
      const exprN = this.expr(thisN)
      const lastCurve =
        this.groups[groupIndex][
          exprN < 0 ? this.groups[groupIndex].length + exprN : exprN
        ]
      const count = Math.floor(this.expr(pointN) * (lastCurve.length - 1))
      if (!lastCurve) throw new Error(`No curve at ${exprN}`)
      if (!lastCurve[count])
        throw new Error(
          `No point at curve ${lastCurve} point ${count} (${lastCurve.length} long)`
        )

      return this.reverseTransform(lastCurve[count].clone())
    } else if (point.startsWith('[')) {
      const end = point.indexOf(']')
      point = this.tokenize(point.substring(1, end), { separatePoints: true })
        .map(x => x.trim() + point.substring(end + 1))
        .join(',')
    }

    try {
      const parts = this.tokenize(point, { separatePoints: true })
      if (parts.length === 1) {
        const coord = this.expr(parts[0])!
        return (
          basic ? new BasicPt(coord, coord) : new AsemicPt(this, coord, coord)
        ) as K extends true ? BasicPt : AsemicPt
      }
      return (
        basic
          ? new BasicPt(...parts.map(x => this.expr(x)!))
          : new AsemicPt(this, ...parts.map(x => this.expr(x)!))
      ) as K extends true ? BasicPt : AsemicPt
    } catch (e) {
      throw new Error(`Failed to evaluate point: ${point}\n${e.message}`)
    }
  }

  applyTransform = (
    point: AsemicPt,
    {
      relative = false,
      randomize = true,
      transform = this.currentTransform
    } = {}
  ): AsemicPt => {
    point.scale(transform.scale).rotate(transform.rotation)

    if (transform.rotate !== undefined && randomize) {
      point.rotate(this.expr(transform.rotate))
    }
    if (transform.add !== undefined && randomize) {
      // debugger
      point.add(
        this.evalPoint(transform.add)
          .scale(transform.scale)
          .rotate(transform.rotation)
      )
    }
    point.add(relative ? this.lastPoint : transform.translation)
    return point
  }

  reverseTransform = (
    point: AsemicPt,
    { randomize = true, transform = this.currentTransform } = {}
  ): AsemicPt => {
    point.subtract(transform.translation)
    if (transform.add !== undefined && randomize) {
      const addPoint = this.evalPoint(transform.add)
      addPoint.scale(transform.scale)
      point.subtract(addPoint)
    }
    if (transform.rotate !== undefined && randomize) {
      point.rotate(this.expr(transform.rotate) * -1)
    }
    point.divide(transform.scale).rotate(transform.rotation * -1)
    return point
  }

  // Parse point from string notation
  protected parsePoint(
    notation: string | number,
    { save = true, randomize = true, forceRelative = false } = {}
  ): AsemicPt {
    let prevCurve: AsemicPt[] | undefined
    let point: AsemicPt
    if (typeof notation === 'number') {
      point = new AsemicPt(this, notation, notation)
    } else {
      // Polar coordinates: @t,r

      // Relative coordinates: +x,y
      if (notation.startsWith('+')) {
        point = this.applyTransform(
          this.evalPoint(notation.substring(1), { basic: false }),
          {
            relative: true,
            randomize
          }
        )
      } else {
        // Absolute coordinates: x,y
        point = this.applyTransform(
          new AsemicPt(this, ...this.evalPoint(notation)),
          { relative: forceRelative, randomize }
        )
      }
    }

    if (save) this.lastPoint = point
    return point
  }

  protected cloneTransform(transform: Transform): Transform {
    const newTransform = {} as Transform
    for (let key of Object.keys(transform)) {
      if (transform[key] instanceof BasicPt) {
        newTransform[key] = transform[key].clone()
      } else {
        newTransform[key] = transform[key]
      }
    }
    return newTransform
  }

  regex(regex: string, seed: Expr = 0) {
    if (!this.progress.regexCache[regex]) {
      const iterator = expand(regex).getIterator()
      const cache: string[] = []
      let next = iterator.next()
      while (!next.done) {
        cache.push(next.value)
        next = iterator.next()
        if (cache.length > 1000) break
      }
      this.progress.regexCache[regex] = cache
    }
    const cache = this.progress.regexCache[regex]
    this.text(
      cache[
        Math.floor(
          this.hash(this.progress.curve + this.expr(seed)) * cache.length
        )
      ]!
    )
    return this
  }

  parseTransform(token: string, { thisTransform = defaultTransform() } = {}) {
    token = token.trim()
    const transforms = this.tokenize(token)

    transforms.forEach(transform => {
      if (transform.startsWith('<')) {
        if (transform.slice(1)) {
          const name = transform.slice(1)
          Object.assign(thisTransform, this.namedTransforms[name])
        } else {
          Object.assign(thisTransform, this.transforms.pop())
        }
      } else if (transform.startsWith('>')) {
        if (transform.slice(1)) {
          const name = transform.slice(1)
          this.namedTransforms[name] = this.cloneTransform(thisTransform)
        }
        this.transforms.push(this.cloneTransform(thisTransform))
      } else if (transform === '!') {
        // Reset all transformations
        thisTransform.scale.set([1, 1])
        thisTransform.translation.set([0, 0])
        thisTransform.rotation = 0
        thisTransform.a = '1'
        thisTransform.h = '0'
        thisTransform.s = '0'
        thisTransform.l = '1'
        thisTransform.width = '1'
        thisTransform.add = undefined
        thisTransform.rotate = undefined
      } else if (transform.startsWith('*<')) {
        thisTransform.scale.set(last(this.transforms)?.scale ?? [1, 1])
      } else if (transform.startsWith('+<')) {
        thisTransform.translation.set(
          last(this.transforms)?.translation ?? [0, 0]
        )
      } else if (transform.startsWith('@<')) {
        thisTransform.rotation = last(this.transforms)?.rotation ?? 0
      } else if (transform.startsWith('*!')) {
        // Reset scale
        thisTransform.scale.set([1, 1])
      } else if (transform.startsWith('@!')) {
        // Reset rotation
        thisTransform.rotation = 0
      } else if (transform.startsWith('+!')) {
        // Reset translation
        thisTransform.translation.set([0, 0])
      } else if (transform.startsWith('+=>')) {
        thisTransform.add = transform.substring(3)
      } else if (transform.startsWith('@=>')) {
        thisTransform.rotate = transform.substring(3)
      } else if (
        transform.match(
          new RegExp(`^(${TransformAliases.scale.join('|')})(.+)`)
        )
      ) {
        // Scale
        const match = transform.match(
          new RegExp(`^(${TransformAliases.scale.join('|')})(.+)`)
        )
        if (match) {
          thisTransform.scale.scale(this.evalPoint(match[2]))
        }
      } else if (
        transform.match(
          new RegExp(`^(${TransformAliases.rotation.join('|')})(.+)`)
        )
      ) {
        // Rotation
        let match = transform.match(
          new RegExp(`^(${TransformAliases.rotation.join('|')})(.+)`)
        )
        if (match) {
          thisTransform.rotation += this.expr(match[2])!
        }
      } else if (
        transform.match(
          new RegExp(`^(${TransformAliases.translation.join('|')})(.+)`)
        )
      ) {
        // Translation
        const match = transform.match(
          new RegExp(`^(${TransformAliases.translation.join('|')})(.+)`)
        )
        if (match) {
          thisTransform.translation.add(
            this.evalPoint(match[2])
              .scale(thisTransform.scale)
              .rotate(thisTransform.rotation)
          )
        }
      } else {
        const keyCall = transform.match(/^([a-z]+)\=(.+)/)
        if (keyCall) {
          const key = keyCall[1]
          const value = keyCall[2]
          switch (key) {
            case 'width':
            case 'w':
            case 'wid':
              thisTransform.width = value
              break
              break
            default:
              if (value.includes(',')) {
                thisTransform[key] = this.evalPoint(value, {
                  basic: true
                })
              } else {
                thisTransform[key] = value
              }
              break
          }
        }
      }
    })
    return thisTransform
  }

  to(token: string) {
    this.parseTransform(token, { thisTransform: this.currentTransform })
    return this
  }

  protected tokenize(
    source: string,
    {
      separatePoints = false,
      separateFragments = false,
      separateObject = false,
      regEx = /^\s/,
      stopAt0 = false
    }: {
      separatePoints?: boolean
      separateFragments?: boolean
      regEx?: RegExp
      separateObject?: boolean
      stopAt0?: boolean
    } = {}
  ): string[] {
    if (separatePoints) regEx = /^\,/
    else if (separateFragments) regEx = /^\_/
    else if (separateObject) regEx = /^\;/

    // Predefined functions

    // Tokenize the source
    let tokens: string[] = []
    let current = ''
    let inBrackets = 0
    let inParentheses = 0
    let inBraces = 0

    let isEscaped = false
    for (let i = 0; i < source.length; i++) {
      const char = source[i]

      if (isEscaped) {
        isEscaped = false
        continue
      }
      switch (char) {
        case '[':
          inBrackets++
          break
        case ']':
          inBrackets--
          break
        case '(':
          inParentheses++
          break
        case ')':
          inParentheses--
          break
        case '{':
          inBraces++
          break
        case '}':
          inBraces--
          break
        case '\\':
          isEscaped = true
          continue
      }
      const hasTotalBrackets = inBraces + inParentheses + inBrackets > 0
      if (current === '' && !hasTotalBrackets) {
        switch (char) {
          case '"':
          case '/':
            current += source[i]
            i++
            while (true) {
              current += source[i]
              if (source[i] === '\\') i++
              if (source[i] === char) {
                break
              }
              i++
            }
            continue
        }
      }

      if (stopAt0 && i > 0 && !hasTotalBrackets) {
        return [current, source.slice(i + 1)]
      } else if (!hasTotalBrackets && regEx.test(source.substring(i))) {
        if (current) {
          tokens.push(current)
          current = ''
        }
      } else {
        current += char
      }
    }
    if (current.length) tokens.push(current)
    return tokens
  }

  group(settings: AsemicGroup['settings']) {
    const group = new AsemicGroup(this, settings)
    if (group.settings.texture) {
      if (this.images[this.resolveName(group.settings.texture)]) {
        group.imageDatas = this.images[this.resolveName(group.settings.texture)]
        group.xy = this.evalPoint(group.settings.xy ?? '0,0')
        group.wh = this.evalPoint(group.settings.wh ?? '1,1')
      } else {
        this.error(`No texture available for ${group.settings.texture}`)
      }
    }
    this.groups.push(group)

    return this
  }

  end() {
    if (this.currentCurve.length === 0) return this
    if (this.currentCurve.length === 2) {
      this.progress.point = 0.5
      const p1 = this.currentCurve[0]
      const p2 = this.currentCurve[1]
      const interpolated = p1.clone().lerp(p2, 0.5)
      this.currentCurve.splice(1, 0, interpolated)
    }
    if (this.groups.length === 0) {
      this.groups.push(new AsemicGroup(this, { mode: 'line' }))
    }
    this.groups[this.groups.length - 1].addCurve(this.currentCurve)
    this.currentCurve = []
    this.progress.point = 0
    this.adding = 0
    return this
  }

  points(token: string) {
    const pointsTokens = this.tokenize(token)

    let totalLength =
      pointsTokens.filter(x => !x.startsWith('{')).length - 1 || 1

    const originalEnd = this.adding
    this.adding += totalLength
    pointsTokens.forEach((pointToken, i) => {
      if (pointToken.startsWith('{')) {
        this.to(pointToken.slice(1, -1))
        return
      } else {
        this.progress.point = (originalEnd + i) / this.adding

        const point = this.parsePoint(pointToken)

        this.currentCurve.push(point)
        return
      }
    })
    return this
  }

  line(...tokens: string[]) {
    for (let token of tokens) {
      this.points(token)
      this.end()
    }
    return this
  }

  or(value: number, ...callbacks: ((p: this) => void)[]) {
    const divisions = callbacks.length
    for (let i = 0; i < divisions; i++) {
      if (value <= i / divisions) {
        callbacks[i](this)
        return
      }
    }
    callbacks[divisions - 1](this)
  }

  def(key: string, definition: string) {
    if (this.reservedConstants.includes(key)) {
      throw new Error(`Reserved constant: ${key}`)
    }

    this.constants[key] = (...args) => this.expr(definition)

    return this
  }

  defStatic(key: string, definition: string) {
    if (this.reservedConstants.includes(key)) {
      throw new Error(`Reserved constant: ${key}`)
    }

    const solvedDefinition = this.expr(definition)

    this.constants[key] = () => solvedDefinition

    return this
  }

  font(sliced: string) {
    let chars: AsemicFont['characters'] = {}

    const [name, characterString] = splitString(sliced, /\s/)
    const characterMatches = this.tokenize(characterString, {
      separateObject: true
    })
    for (let charMatch of characterMatches) {
      const [name, matches] = splitString(charMatch, '=')
      chars[name] = () => this.parse(matches)
    }

    this.processFont(name, chars)

    return this
  }

  processFont(name: string, chars: AsemicFont['characters']) {
    this.currentFont = name
    if (chars) {
      if (!this.fonts[name]) {
        this.fonts[name] = new AsemicFont(this, chars as any)
      } else {
        this.fonts[name].parseCharacters(chars)
      }
    }
    return this
  }

  keys(index: Expr) {
    this.text(this.live.keys[Math.floor(this.expr(index))])
    return this
  }

  text(token: string, { add = false }: { add?: boolean } = {}) {
    // const formatSpace = (insert?: string) => {
    //   if (insert) return ` ${insert} `
    //   return ' '
    // }
    const font = this.fonts[this.currentFont]
    // Randomly select one character from each set of brackets for the text
    token = token.replace(
      /[^\\]\[([^\]]+[^\\])\](?:\{([^\}]+)\})?/g,
      (options, substring, count) => {
        if (count) {
          const numTimes = parseFloat(count)
          let newString = ''
          for (let i = 0; i < numTimes; i++) {
            this.progress.seed++
            newString += substring[Math.floor(this.hash(1) * substring.length)]
          }
          return newString
        } else {
          this.progress.seed++
          return substring[Math.floor(this.hash(1) * substring.length)]
        }
      }
    )

    if (font.characters['START'] && !add) {
      font.characters['START']()
    }

    for (let i = 0; i < token.length; i++) {
      if (token[i] === '\n') {
        if (font.characters['NEWLINE']) {
          ;(font.characters['NEWLINE'] as any)()
        }
      }
      if (token[i] === '{') {
        const start = i
        while (token[i] !== '}') {
          i++
          if (i >= token.length) {
            throw new Error('Missing } in text')
          }
        }
        const end = i
        this.to(token.substring(start + 1, end))
        continue
      }
      this.progress.letter = i / (token.length - 1)

      if (!font.characters[token[i]]) {
        continue
      }
      ;(font.characters[token[i]] as any)()
      if (font.characters['EACH']) {
        ;(font.characters['EACH'] as any)()
      }
    }
    if (font.characters['END'] && !add) {
      font.characters['END']()
    }

    return this
  }

  /**
   * Load multiple files into the image store
   * @param files - Dictionary of filename to ImageBitmap arrays
   */
  loadFiles(files: Partial<Parser['images']>) {
    Object.assign(this.images, files)
    return this
  }

  /**
   * Look up a pixel value from a loaded image
   * @param name - The name of the loaded image
   * @param x - X coordinate (0-1, will be mapped to image width)
   * @param y - Y coordinate (0-1, will be mapped to image height)
   * @param channel - Which channel to return: 'r', 'g', 'b', 'a', or 'brightness' (default)
   * @returns Normalized pixel value (0-1)
   */
  table(name: string, coord: string, channel: string = 'brightness'): number {
    const [x, y] = this.evalPoint(coord, { basic: true })

    // First try to get from images cache (ImageBitmap[])

    const bitmaps = this.images[this.resolveName(name)]
    if (!bitmaps) {
      this.error(`Data is not available for ${this.resolveName(name)}`)
      return 0
    }
    // Use progress or time to select frame for videos
    const frameIndex =
      bitmaps.length > 1
        ? Math.floor(this.progress.scrubTime * 60) % bitmaps.length
        : 0
    const bitmap = bitmaps[frameIndex]

    const normalizedX = Math.max(0, Math.min(1, x))
    const normalizedY = Math.max(0, Math.min(1, y))
    const pixelX = Math.floor(normalizedX * (bitmap.width - 1))
    const pixelY = Math.floor(normalizedY * (bitmap.height - 1))

    const start = pixelY * bitmap.width * 4 + pixelX * 4
    const [r, g, b, a] = bitmap.data
      .subarray(start, start + 4)
      .map(v => v / 255)
    switch (channel) {
      case 'r':
        return r
      case 'g':
        return g
      case 'b':
        return b
      case 'a':
        return a
      case 'brightness':
      default:
        return (0.299 * r + 0.587 * g + 0.114 * b) * a
    }
  }

  constructor(additionalConstants: Parser['constants'] = {}) {
    for (let key of Object.keys(additionalConstants)) {
      if (this.reservedConstants.includes(key)) {
        throw new Error(`Reserved constant: ${key}`)
      }
      this.constants[key] = additionalConstants[key]
    }
  }

  resolveName(name: string) {
    if (!this.settings.folder.endsWith('/')) this.settings.folder += '/'
    return this.settings.folder + name
  }

  file(filePath: string) {
    this.output.files.push(this.resolveName(filePath))
    return this
  }
}
