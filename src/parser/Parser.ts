import { range } from 'lodash'
import { AsemicPt, BasicPt } from '../blocks/AsemicPt'
import { AsemicFont, DefaultFont } from '../defaultFont'
import { InputSchema } from '../server/inputSchema'
import { defaultSettings, splitString } from '../settings'
import { AsemicData, Transform } from '../types'
import { defaultPreProcess, lerp } from '../utils'

// Core classes
import { AsemicGroup } from './core/AsemicGroup'
import { defaultOutput } from './core/Output'
import { cloneTransform, defaultTransform } from './core/Transform'

// Constants
import { ONE_FRAME } from './constants/Aliases'

// Method classes
import { DataMethods } from './methods/Data'
import { DrawingMethods } from './methods/Drawing'
import { ExpressionMethods } from './methods/Expressions'
import { OSCMethods } from './methods/OSC'
import { ParsingMethods } from './methods/Parsing'
import { SceneMethods } from './methods/Scenes'
import { TextMethods } from './methods/Text'
import { TransformMethods } from './methods/Transforms'
import { UtilityMethods } from './methods/Utilities'

type ExprFunc = (() => void) | string

export { AsemicGroup }

export class Parser {
  rawSource = ''
  presets: Record<string, InputSchema['params']> = {}
  mode = 'normal' as 'normal' | 'blank'
  adding = 0
  debugged = new Map<string, { errors: string[] }>()
  groups: AsemicGroup[] = []
  settings = defaultSettings()
  static defaultSettings = defaultSettings()
  currentCurve: AsemicPt[] = []
  currentTransform: Transform = defaultTransform()
  transformStack: Transform[] = []
  namedTransforms: Record<string, Transform> = {}
  totalLength = 0
  pausedAt: string[] = []
  pauseAt: string | false = false
  sceneList: {
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

  constants: Record<string, ((...args: string[]) => number) | (() => number)> =
    {
      N: (index = '1') => {
        if (!index) index = '1'
        return this.progress.countNums[this.expr(index, false) - 1]
      },
      I: (index = '1') => {
        if (!index) index = '1'
        return this.progress.indexes[this.expr(index, false) - 1]
      },
      i: (index = '1') => {
        if (!index) index = '1'
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
      '~': (speed = '1', ...freqs) => {
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
  reservedConstants = Object.keys(this.constants)
  fonts: Record<string, AsemicFont> = {
    default: new DefaultFont(this as any)
  }
  currentFont = 'default'
  lastPoint: AsemicPt
  noiseTable: ((x: number) => number)[] = []
  noiseValues: number[] = []
  noiseIndex = 0
  images: Record<string, ImageData[]> = {}
  output = defaultOutput()
  preProcessing = defaultPreProcess()

  // Method instances
  private expressions: ExpressionMethods
  private drawing: DrawingMethods
  private transformMethods: TransformMethods
  private textMethods: TextMethods
  private utilities: UtilityMethods
  private scenes: SceneMethods
  private oscMethods: OSCMethods
  private parsing: ParsingMethods
  private data: DataMethods

  constructor(additionalConstants: Parser['constants'] = {}) {
    for (let key of Object.keys(additionalConstants)) {
      if (this.reservedConstants.includes(key)) {
        throw new Error(`Reserved constant: ${key}`)
      }
      this.constants[key] = additionalConstants[key]
    }

    // Initialize method classes
    this.expressions = new ExpressionMethods(this)
    this.drawing = new DrawingMethods(this)
    this.transformMethods = new TransformMethods(this)
    this.textMethods = new TextMethods(this)
    this.utilities = new UtilityMethods(this)
    this.scenes = new SceneMethods(this)
    this.oscMethods = new OSCMethods(this)
    this.parsing = new ParsingMethods(this)
    this.data = new DataMethods(this)

    // Mix in methods to maintain backward compatibility
    this.mixinMethods()
  }

  private mixinMethods() {
    // Expression methods
    this.expr = this.expressions.expr.bind(this.expressions)
    this.exprEval = this.expressions.exprEval.bind(this.expressions)
    this.choose = this.expressions.choose.bind(this.expressions)
    this.def = this.expressions.def.bind(this.expressions)
    this.defStatic = this.expressions.defStatic.bind(this.expressions)

    // Drawing methods
    this.tri = this.drawing.tri.bind(this.drawing)
    this.squ = this.drawing.squ.bind(this.drawing)
    this.pen = this.drawing.pen.bind(this.drawing)
    this.hex = this.drawing.hex.bind(this.drawing)
    this.circle = this.drawing.circle.bind(this.drawing)
    this.seq = this.drawing.seq.bind(this.drawing)
    this.line = this.drawing.line.bind(this.drawing)

    // Transform methods
    this.to = this.transformMethods.to.bind(this.transformMethods)
    this.parseTransform = this.transformMethods.parseTransform.bind(
      this.transformMethods
    )
    this.applyTransform = this.transformMethods.applyTransform.bind(
      this.transformMethods
    )
    this.reverseTransform = this.transformMethods.reverseTransform.bind(
      this.transformMethods
    )

    // Text methods
    this.textMethod = this.textMethods.text.bind(this.textMethods)
    this.font = this.textMethods.font.bind(this.textMethods)
    this.processFont = this.textMethods.processFont.bind(this.textMethods)
    this.keys = this.textMethods.keys.bind(this.textMethods)
    this.regex = this.textMethods.regex.bind(this.textMethods)

    // Utility methods
    this.repeat = this.utilities.repeat.bind(this.utilities)
    this.within = this.utilities.within.bind(this.utilities)
    this.center = this.utilities.center.bind(this.utilities)
    this.each = this.utilities.each.bind(this.utilities)
    this.test = this.utilities.test.bind(this.utilities)
    this.or = this.utilities.or.bind(this.utilities)
    this.noise = this.utilities.noise.bind(this.utilities)

    // Scene methods
    this.scene = this.scenes.scene.bind(this.scenes)
    this.play = this.scenes.play.bind(this.scenes)
    this.param = this.scenes.param.bind(this.scenes)
    this.preset = this.scenes.preset.bind(this.scenes)
    this.toPreset = this.scenes.toPreset.bind(this.scenes)
    this.scrub = this.scenes.scrub.bind(this.scenes)

    // OSC methods
    this.oscMethod = this.oscMethods.osc.bind(this.oscMethods)
    this.sc = this.oscMethods.sc.bind(this.oscMethods)
    this.synth = this.oscMethods.synth.bind(this.oscMethods)
    this.file = this.oscMethods.file.bind(this.oscMethods)

    // Parsing methods
    this.parse = this.parsing.parse.bind(this.parsing)
    this.tokenize = this.parsing.tokenize.bind(this.parsing)
    this.parsePoint = this.parsing.parsePoint.bind(this.parsing)
    this.parseArgs = this.parsing.parseArgs.bind(this.parsing)
    this.evalPoint = this.parsing.evalPoint.bind(this.parsing)
    this.group = this.parsing.group.bind(this.parsing)
    this.end = this.parsing.end.bind(this.parsing)
    this.points = this.parsing.points.bind(this.parsing)

    // Data methods
    this.loadFiles = this.data.loadFiles.bind(this.data)
    this.table = this.data.table.bind(this.data)
    this.processMouse = this.data.processMouse.bind(this.data)
    this.resolveName = this.data.resolveName.bind(this.data)
  }

  // Method declarations for TypeScript compatibility
  expr!: (expr: string | number, replace?: boolean) => number
  exprEval!: (expr: string | number, replace?: boolean) => number
  choose!: (value0To1: string | number, ...callbacks: (() => void)[]) => this
  def!: (key: string, definition: string) => this
  defStatic!: (key: string, definition: string) => this

  tri!: (argsStr: string, options?: { add?: boolean }) => this
  squ!: (argsStr: string, options?: { add?: boolean }) => this
  pen!: (argsStr: string, options?: { add?: boolean }) => this
  hex!: (argsStr: string) => this
  circle!: (argsStr: string) => this
  seq!: (argsStr: string) => this
  line!: (...tokens: string[]) => this

  to!: (token: string) => this
  parseTransform!: (
    token: string,
    options?: { thisTransform?: Transform }
  ) => Transform
  applyTransform!: (point: AsemicPt, options?: any) => AsemicPt
  reverseTransform!: (point: AsemicPt, options?: any) => AsemicPt

  textMethod!: (token: string, options?: { add?: boolean }) => this
  font!: (sliced: string) => this
  processFont!: (name: string, chars: AsemicFont['characters']) => this
  keys!: (index: string | number) => this
  regex!: (regex: string, seed?: string | number) => this

  repeat!: (count: string, callback: (() => void) | string) => this
  within!: (
    coord0: string,
    coord1: string,
    callback: (() => void) | string
  ) => this
  center!: (coords: string, callback: () => void) => this
  each!: (makeCurves: () => void, callback: (pt: AsemicPt) => void) => this
  test!: (
    condition: string | number,
    callback?: () => void,
    callback2?: () => void
  ) => this
  or!: (value: number, ...callbacks: ((p: any) => void)[]) => void
  noise!: (value: number, frequencies: number[], phases?: number[]) => number

  scene!: (...scenes: any[]) => this
  play!: (play: AsemicData['play']) => void
  param!: (paramName: string, options: InputSchema['params'][string]) => this
  preset!: (presetName: string, values: string) => this
  toPreset!: (presetName: string, amount?: string | number) => this
  scrub!: (progress: number) => this

  oscMethod!: (args: string) => this
  sc!: (args: string) => this
  synth!: (name: string, code: string) => this
  file!: (filePath: string) => this

  parse!: (text: string, args?: string[]) => this
  tokenize!: (source: string, options?: any) => string[]
  parsePoint!: (notation: string | number, options?: any) => AsemicPt
  parseArgs!: (args: string[]) => [AsemicPt, AsemicPt, number, number]
  evalPoint!: <K extends boolean>(
    point: string,
    options?: { basic?: K }
  ) => K extends true ? BasicPt : AsemicPt
  group!: (settings: AsemicGroup['settings']) => this
  end!: () => this
  points!: (token: string) => this

  loadFiles!: (files: Partial<any>) => this
  table!: (name: string, coord: string, channel?: string) => number
  processMouse!: (mouse: NonNullable<any>) => AsemicPt
  resolveName!: (name: string) => string

  // Core methods that remain in the main class
  text(token: string, options?: { add?: boolean }) {
    return this.textMethod(token, options)
  }

  osc(args: string) {
    return this.oscMethod(args)
  }

  getDynamicValue(value: number | (() => number)) {
    return typeof value === 'function' ? value() : value
  }

  error(text: string) {
    if (!this.output.errors.includes(text)) {
      this.output.errors.push(text)
    }
  }

  reset({ newFrame = true } = {}) {
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
    this.transformStack = []
    this.lastPoint = new AsemicPt(this as any, 0, 0)
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

  debug(slice: number = 0) {
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

  set(settings: Partial<this['settings']>) {
    Object.assign(this.settings, settings)
    return this
  }

  getBounds(fromGroup: number, toGroup?: number) {
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

  evalExprFunc(callback: ExprFunc) {
    if (typeof callback === 'string') this.parse(callback)
    else callback()
  }

  setup(source: string) {
    this.progress.seed = Math.random()
    this.fonts = { default: new DefaultFont(this as any) }
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
    } catch (e: any) {
      this.output.errors.push(`Setup failed: ${e.message}`)
    }
  }

  hash = (n: number): number => {
    // Convert to string, multiply by a prime number, and take the fractional part
    const val = Math.sin(n) * (43758.5453123 + this.progress.seed)
    return Math.abs(val - Math.floor(val)) // Return the fractional part (0-1)
  }

  mapCurve(
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
    this.currentCurve.push(...(add ? mappedCurve.slice(0, -1) : mappedCurve))

    if (!add) {
      this.end()
    }
  }

  cloneTransform = cloneTransform

  get duration() {
    return this.totalLength
  }

  index() {}
}
