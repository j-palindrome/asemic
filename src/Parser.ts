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

const TransformAliases = {
  scale: ['\\*', 'sca', 'scale'],
  rotation: ['\\@', 'rot', 'rotate'],
  translation: ['\\+', 'tra', 'translate'],
  width: ['w', 'wid', 'width']
}

const ONE_FRAME = 1 / 60

const defaultTransform: () => Transform = () => ({
  translation: new BasicPt(0, 0),
  scale: new BasicPt(1, 1),
  rotation: 0,
  width: '1',
  h: '0',
  s: '0',
  l: '1',
  a: '1'
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
  resetPresets: false
})

export class Parser {
  rawSource = ''
  presets: Record<string, InputSchema['params']> = {}
  protected mode = 'normal' as 'normal' | 'blank'
  protected adding = 0
  protected debugged = new Map<string, { errors: string[] }>()
  curves: AsemicPt[][] = []
  settings = defaultSettings()
  static defaultSettings = defaultSettings()
  protected currentCurve: AsemicPt[] = []
  currentTransform: Transform = defaultTransform()
  protected transforms: Transform[] = []
  protected namedTransforms: Record<string, Transform> = {}
  protected totalLength = 0
  protected pausedAt: string[] = []
  protected pauseAt: string | false = false
  protected scenes: {
    start: number
    length: number
    callback: (p: Parser) => void
    pause: false | number
    offset: number
  }[] = []
  params = {} as InputSchema['params']
  progress = {
    point: 0,
    time: performance.now() / 1000,
    curve: 0,
    seed: Math.random(),
    index: 0,
    countNum: 0,
    accums: [] as number[],
    accumIndex: 0,
    letter: 0,
    scrub: 0,
    scrubTime: 0,
    progress: 0,
    regexCache: {} as Record<string, string[]>
  }
  live = {
    keys: [''],
    text: ['']
  }

  constants: Record<string, ((args: string[]) => number) | (() => number)> = {
    N: () => this.progress.countNum,
    I: () => this.progress.index,
    T: () => this.progress.time,
    H: () => this.preProcessing.height / this.preProcessing.width,
    Hpx: () => this.preProcessing.height,
    Wpx: () => this.preProcessing.height,
    S: () => this.progress.scrubTime,
    C: () => this.progress.curve,
    L: () => this.progress.letter,
    P: () => this.progress.point,
    px: () => 1 / this.preProcessing.width,
    sin: ([x]) => Math.sin(this.expr(x, false) * Math.PI * 2) * 0.5 + 0.5,
    table: ([name, point, channel]) => {
      const imageName = typeof name === 'string' ? name : String(name)
      return this.table(imageName, point, channel)
    },
    acc: ([x]) => {
      if (!this.progress.accums[this.progress.accumIndex])
        this.progress.accums.push(0)
      const value = this.expr(x, false)
      // correct for 60fps
      this.progress.accums[this.progress.accumIndex] += value / 60
      const currentAccum = this.progress.accums[this.progress.accumIndex]
      this.progress.accumIndex++
      return currentAccum
    }
  }
  protected reservedConstants = Object.keys(this.constants)
  protected fonts: Record<string, AsemicFont> = {
    default: new DefaultFont(this)
  }
  protected currentFont = 'default'
  protected lastPoint: AsemicPt = new AsemicPt(this, 0, 0)
  protected noiseTable: ((x: number) => number)[] = []
  protected noiseValues: number[] = []
  protected noiseIndex = 0
  protected imageLookupTables: Map<string, ImageData> = new Map()
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
      this.curves = []
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
      if (!isUndefined(play.scene)) {
        this.reset()
        this.setup(this.rawSource)
        for (let i = 0; i < play.scene; i++) {
          // parse each scene until now to get OSC messages
          this.mode = 'blank'
          try {
            this.scenes[i].callback(this)
          } catch (e) {
            this.output.errors.push(`Error in scene ${i}: ${e.message}`)
          }
        }
        this.mode = 'normal'
        this.progress.progress =
          this.scenes[play.scene].start + this.scenes[play.scene].offset
        const fixedProgress = this.progress.progress.toFixed(5)
        this.pausedAt = this.pausedAt.filter(x => x <= fixedProgress)
        this.pauseAt = false
      }
    }
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

  repeat(count: Expr, callback: (p: this) => void) {
    const countNum = this.expr(count)

    const prevIndex = this.progress.index
    const prevCountNum = this.progress.countNum
    this.progress.countNum = countNum
    for (let i = 0; i < countNum; i++) {
      this.progress.index = i

      callback(this)
    }
    this.progress.index = prevIndex
    this.progress.countNum = prevCountNum
    return this
  }

  draw() {
    this.reset()

    for (let object of this.scenes) {
      if (
        this.progress.progress >= object.start &&
        this.progress.progress < object.start + object.length
      ) {
        this.reset({ newFrame: false })
        this.progress.scrub =
          (this.progress.progress - object.start) / object.length
        this.progress.scrubTime = this.progress.progress - object.start
        try {
          object.callback(this)
        } catch (e) {
          this.output.errors.push(e instanceof Error ? e.message : String(e))
        }

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
      if (str.endsWith('00')) {
        return String(Math.floor(x))
      } else {
        return str
      }
    }
    const c = this.curves
      .concat([this.currentCurve])
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
    callback: (p: this) => void,
    { length = 0.1, offset = 0, pause = 0 } = {}
  ) {
    this.scenes.push({
      callback,
      start: this.totalLength,
      length,
      offset,
      pause
    })
    this.totalLength += length - offset
    return this
  }

  set(settings: Partial<this['settings']>) {
    Object.assign(this.settings, settings)
    return this
  }

  protected getBounds(fromCurve: number, toCurve?: number) {
    let minX: number | undefined = undefined,
      minY: number | undefined = undefined,
      maxX: number | undefined = undefined,
      maxY: number | undefined = undefined
    for (let curve of this.curves.slice(fromCurve, toCurve)) {
      for (const point of curve) {
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

  within(coords: string, callback: () => void) {
    const points = this.tokenize(coords)
    const [x, y] = this.parsePoint(points[0])
    const [x2, y2] = this.parsePoint(points[1])
    const startCurve = this.curves.length
    callback()
    const [minX, minY, maxX, maxY] = this.getBounds(startCurve)
    const newWidth = x2 - x
    const newHeight = y2 - y
    const oldWidth = maxX! - minX!
    const oldHeight = maxY! - minY!
    const scaleX = newWidth / (oldWidth || 1)
    const scaleY = newHeight / (oldHeight || 1)

    for (let i = startCurve; i < this.curves.length; i++) {
      this.curves[i] = this.curves[i].map(pt => {
        pt[0] = x + (pt[0] - minX!) * scaleX
        pt[1] = y + (pt[1] - minY!) * scaleY
        return pt
      })
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
    const startCurve = this.curves.length

    callback()
    const addedCurves = this.curves.slice(startCurve)

    const [minX, minY, maxX, maxY] = this.getBounds(startCurve)

    const boundingCenterX = (minX! + maxX!) / 2
    const boundingCenterY = (minY! + maxY!) / 2

    const dx = centerX - boundingCenterX
    const dy = centerY - boundingCenterY
    const difference = new BasicPt(dx, dy)

    for (const curve of addedCurves) {
      for (const pt of curve) {
        pt.add(difference)
      }
    }

    return this
  }

  each(makeCurves: () => void, callback: (pt: AsemicPt) => void) {
    const start = this.curves.length
    const saveProgress = this.progress.curve
    makeCurves()
    const finalProgress = this.progress.curve
    this.progress.curve = saveProgress
    for (const curve of this.curves.slice(start)) {
      this.progress.point = 0
      for (const pt of curve) {
        this.progress.curve++
        this.progress.point += 1 / (curve.length - 1)
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
    this.scenes = []
    this.rawSource = source

    // Use Function constructor with 'this' bound to the Parser instance
    const setupFunction = new Function(
      'source',
      `
      with (this) {
        ${source}
      }
    `
    ).bind(this)

    this.output.resetParams = true
    this.output.resetPresets = true
    try {
      setupFunction(source)
    } catch (e) {
      this.output.errors.push(e.message)
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
      const hwParts = args[2].split(',')
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
  circle(argsStr: string) {
    const args = this.tokenize(argsStr)

    const center = this.parsePoint(args[0])
    const [w, h] = this.evalPoint(args[1])

    const points: AsemicPt[] = [
      new AsemicPt(this, w, 0),
      new AsemicPt(this, w, h),
      new AsemicPt(this, -w, h),
      new AsemicPt(this, -w, -h),
      new AsemicPt(this, w, -h),
      new AsemicPt(this, w, 0)
    ]

    // Apply transformations manually
    points.forEach(point => {
      point.scale(this.currentTransform.scale, [0, 0])
      point.add(center)
    })

    this.currentCurve.push(
      ...points.map((x, i) => {
        this.progress.point =
          i === points.length - 1 ? 0 : i / (points.length - 2)
        return x.clone()
      })
    )
    this.lastPoint = last(this.currentCurve)!
    this.end()
    return this
  }

  expr(expr: Expr, replace = true): number {
    try {
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
        const start = expr.indexOf('(')
        let end = start + 1
        for (; end < expr.length; end++) {
          if (expr[end] === '(') bracket++
          else if (expr[end] === ')') {
            bracket--
            if (bracket === 0) break
          }
        }

        return this.expr(
          expr.substring(0, start) +
            this.expr(expr.substring(start + 1, end)).toFixed(4) +
            expr.substring(end + 1)
        )
      }

      if (expr.match(/^\-?[0-9\.]+$/)) {
        return parseFloat(expr)
      }

      if (expr.includes('<')) {
        // 1.1<R>2.4
        let [firstPoint, fade, ...nextPoints] = expr.split(/[<>]/g).map(x => {
          return this.expr(x, false)
        })
        fade = clamp(fade, 0, 1)
        const points = [firstPoint, ...nextPoints]
        let index = (points.length - 1) * fade
        if (index === points.length - 1) index -= 0.0001

        return lerp(
          points[Math.floor(index)]!,
          points[Math.floor(index) + 1]!,
          (index % 1) ** 2
        )
      }

      if (expr.includes(':')) {
        // take averages
        let ratios = expr.split(':')
        const fundamental = this.expr(ratios[0])
        const finalRatios = ratios.map(x => {
          if (x.includes(',')) {
            const [freq, amp] = x.split(',').map(x => this.expr(x, false))
            return Math.cos(freq * fundamental) * amp
          }
          return this.expr(x, false)
        })
        return (
          Math.cos(fundamental) / finalRatios.length +
          sumBy(finalRatios.slice(1), x => Math.cos(x) / ratios.length)
        )
      }

      const operatorsList = ['_', '+', '-', '*', '/', '%', '^', '#', '~']
      for (let i = expr.length - 1; i >= 0; i--) {
        if (operatorsList.includes(expr[i])) {
          if (expr[i] === '-' && expr[i - 1] && '*+/%()'.includes(expr[i - 1]))
            continue
          let operators: [number, number] = splitStringAt(expr, i).map(
            x => this.expr(x, false)!
          ) as [number, number]
          switch (expr[i]) {
            case '^':
              return operators[0] ** operators[1]

            case '_':
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

            case '~':
              let sampleIndex = this.noiseIndex
              while (sampleIndex > this.noiseTable.length - 1) {
                const seed = Math.random()
                const add = Math.random() * Math.PI * 2
                this.noiseTable.push((x: number) => {
                  return Math.sin(x * 2 * Math.PI * seed + add)
                })
                this.noiseValues.push(0)
              }

              const [spd, val] = splitStringAt(expr, i)
              const speed = this.expr(spd || '1')

              const value = !val
                ? this.noiseValues[this.noiseIndex] + (speed * 1) / 60
                : this.expr(val) ||
                  this.noiseValues[this.noiseIndex] + (speed * 1) / 60
              this.noiseValues[this.noiseIndex] = value

              const noise =
                this.noiseTable[this.noiseIndex](
                  this.noiseValues[this.noiseIndex]
                ) *
                  0.5 +
                0.5
              this.noiseIndex++

              return noise
          }
        }
      }

      const functionCall = expr.match(/^[a-zA-Z0-9]+/)?.[0]

      if (functionCall && this.constants[functionCall]) {
        const args = this.tokenize(expr.substring(functionCall.length).trim())

        return this.constants[functionCall](args)
      }

      throw new Error(`Invalid expression`)
    } catch (e) {
      throw new Error(`Expression failed ${expr}:\n${e.message}`)
    }
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
    // match 1,1<0.5>2,2>3,3 but not 1,1<0.5>2
    if (/^[^<]+,[^<]+<[^>,]+\>[^>,]+,[^>,]+/.test(point)) {
      const [firstPoint, fade, ...nextPoints] = point
        .split(/[<>]/g)
        .map((x, i) => {
          return i === 1 ? this.expr(x) : this.evalPoint(x)
        })
      const fadeNm = fade as number
      const points = [firstPoint, ...nextPoints] as AsemicPt[]
      let index = (points.length - 1) * fadeNm
      if (index === points.length - 1) index -= 0.0001

      return points[Math.floor(index)].add(
        points[Math.floor(index) + 1]!.clone()
          .subtract(points[Math.floor(index)])
          .scale([index % 1, index % 1])
      )
    }

    if (point.startsWith('[')) {
      const end = point.indexOf(']')
      point = point
        .substring(1, end)
        .split(',')
        .map(x => x.trim() + point.substring(end + 1))
        .join(',')
    }
    const parts = point.split(',')
    if (parts.length === 1) {
      const x = this.expr(parts[0])!
      return new AsemicPt(this, x, parts[1] ? this.expr(parts[1])! : x)
    }
    return (
      basic
        ? new BasicPt(...parts.map(x => this.expr(x)!))
        : new AsemicPt(this, ...parts.map(x => this.expr(x)!))
    ) as K extends true ? BasicPt : AsemicPt
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
      point.add(
        this.parsePoint(transform.add)
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
    let prevCurve = this.curves[this.curves.length - 1]
    let point: AsemicPt
    if (typeof notation === 'number') {
      point = new AsemicPt(this, notation, notation)
    } else {
      notation = notation.trim()
      // Intersection point syntax: <p
      if (notation.startsWith('<')) {
        let count = 0
        while (notation.startsWith('<')) {
          notation = notation.substring(1)
          count++
        }
        prevCurve = this.curves[this.curves.length - count]
        if (!prevCurve || prevCurve.length < 2) {
          throw new Error('Intersection requires a previous curve')
        }

        let p = this.expr(notation)
        const idx = Math.floor(p * (prevCurve.length - 1))
        const frac = p * (prevCurve.length - 1) - idx

        if (idx >= prevCurve.length - 1) {
          return prevCurve[prevCurve.length - 1] as AsemicPt
        }

        const p1 = prevCurve[idx]
        const p2 = prevCurve[idx + 1]

        point = new AsemicPt(
          this,
          p1[0] + (p2[0] - p1[0]) * frac,
          p1[1] + (p2[1] - p1[1]) * frac
        )
      }

      // Polar coordinates: @t,r
      else if (notation.startsWith('@')) {
        const [theta, radius] = this.evalPoint(notation.substring(1))

        point = this.applyTransform(
          new AsemicPt(this, radius, 0).rotate(theta),
          {
            relative: true,
            randomize
          }
        )
      }

      // Relative coordinates: +x,y
      else if (notation.startsWith('+')) {
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

  protected tokenize(source: string): string[] {
    source = source + ' '

    // Predefined functions

    // Tokenize the source
    let tokens: string[] = []
    let current = ''
    let inBrackets = 0
    let inParentheses = 0
    let inBraces = 0
    let quote = false
    let evaling = false
    let functionCall = false
    let fontDefinition = false
    let or = false

    for (let i = 0; i < source.length; i++) {
      const char = source[i]

      if (char === '"' && source[i - 1] !== '\\') quote = !quote
      else if (char === '`' && source[i - 1] !== '\\') {
        evaling = !evaling
      } else if (char === '{' && source[i + 1] === '{') fontDefinition = true
      else if (char === '}' && source[i - 1] === '}') fontDefinition = false
      else if (!quote && !evaling && !functionCall && !fontDefinition) {
        if (char === '[') inBrackets++
        else if (char === ']') inBrackets--
        else if (char === '(') inParentheses++
        else if (char === ')') inParentheses--
        else if (char === '{') inBraces++
        else if (char === '}') inBraces--
      }

      const hasTotalBrackets = inBraces + inParentheses + inBrackets > 0

      if (
        !quote &&
        !evaling &&
        !functionCall &&
        !fontDefinition &&
        !hasTotalBrackets &&
        (char === ' ' || char === '\n')
      ) {
        if (current) {
          tokens.push(current)
          current = ''
        }
      } else {
        current += char
      }
    }
    return tokens
  }

  end() {
    if (this.currentCurve.length === 0) return
    if (this.currentCurve.length === 2) {
      this.progress.point = 0.5
      const p1 = this.currentCurve[0]
      const p2 = this.currentCurve[1]
      const interpolated = p1.clone().lerp(p2, 0.5)
      this.currentCurve.splice(1, 0, interpolated)
    }
    if (this.mode !== 'blank') {
      this.curves.push(this.currentCurve)
    }
    this.currentCurve = []
    this.progress.point = 0
    this.adding = 0
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
        try {
          this.progress.point = (originalEnd + i) / this.adding
          const point = this.parsePoint(pointToken)

          this.currentCurve.push(point)
          return
        } catch (e) {
          if (
            Object.keys(this.constants).find(x =>
              new RegExp(`^\\(?${x}`).test(pointToken)
            )
          ) {
            const evaled = this.expr(pointToken)
            if (evaled) {
              this.currentCurve.push(this.parsePoint(evaled))
            } else {
              throw new Error(`Function ${pointToken} doesn't return a point`)
            }
          }
        }
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

    this.constants[key] = () => this.expr(definition)

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

  font(name: string, chars?: AsemicFont['characters']) {
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
      ;(font.characters[token[i]] as any)(this)
      if (font.characters['EACH']) {
        ;(font.characters['EACH'] as any)(this)
      }
    }
    if (font.characters['END'] && !add) {
      font.characters['END']()
    }

    return this
  }

  /**
   * Load an image into a lookup table for pixel access
   * @param name - The name to store the image lookup table under
   * @param imageData - The ImageData object containing pixel data
   */
  loadImage(name: string, bitmap: ImageData) {
    this.imageLookupTables.set(name, bitmap)
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

    const imageData = this.imageLookupTables.get(name)
    if (!imageData) {
      this.error(`Image lookup table '${name}' not found`)
      return 0
    }
    // Clamp coordinates to 0-1 range
    const normalizedX = Math.max(0, Math.min(1, x))
    const normalizedY = Math.max(0, Math.min(1, y))
    // Map to pixel coordinates
    const pixelX = Math.floor(normalizedX * (imageData.width - 1))
    const pixelY = Math.floor(normalizedY * (imageData.height - 1))
    // Get pixel index (RGBA format)
    const index = (pixelY * imageData.width + pixelX) * 4

    if (index >= imageData.data.length) {
      return 0
    }

    const r = imageData.data[index] / 255
    const g = imageData.data[index + 1] / 255
    const b = imageData.data[index + 2] / 255
    const a = imageData.data[index + 3] / 255
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
        // Calculate brightness using standard luminance formula
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
}
