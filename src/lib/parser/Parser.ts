import { range } from 'lodash'
import { AsemicPt, BasicPt } from '../blocks/AsemicPt'
import { AsemicFont, DefaultFont } from '../defaultFont'
import { InputSchema } from '../../renderer/inputSchema'
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
    draw: () => void
    pause: false | number
    offset: number
    isSetup: boolean
    setup?: () => void
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
        const t = amount % 1
        const u = 1 - t
        if (amount >= 1) {
          point1 = point1.clone().lerp(point2, 0.5)
        }
        if (amount < points.length - 3) {
          point3 = point3.clone().lerp(point2, 0.5)
        }

        return point1
          .clone()
          .scale([u ** 2, u ** 2])
          .add(
            point2
              .clone()
              .scale([2 * u * t, 2 * u * t])
              .add(point3.clone().scale([t ** 2, t ** 2]))
          )
      }

      return bezier(
        exprPoints[start],
        exprPoints[start + 1],
        exprPoints[start + 2],
        index
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
      C: () => this.groups[this.groups.length - 1].length,
      L: () => this.progress.letter,
      P: () => this.progress.point,
      px: () => 1 / this.preProcessing.width,
      sin: x => {
        const result = Math.sin(this.expr(x, false) * Math.PI * 2)
        return result
      },
      table: (name, point, channel) => {
        const imageName = typeof name === 'string' ? name : String(name)
        return this.table(imageName, point, channel)
      },
      or: (...args) => {
        const [condition, trueValue, falseValue] = args.map(x =>
          this.expr(x, false)
        )
        return condition > 0 ? trueValue : falseValue
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
      },
      tangent: (progress, curve) => {
        let lastCurve: AsemicPt[]
        if (!curve) {
          lastCurve = this.currentCurve
        } else {
          const exprN = this.expr(curve)
          lastCurve =
            this.groups[this.groups.length - 1][
              exprN < 0
                ? this.groups[this.groups.length - 1].length + exprN
                : exprN
            ]
        }

        if (!lastCurve || lastCurve.length < 3) {
          return 0
        }

        let exprFade = this.expr(progress)
        if (exprFade >= 1) exprFade = 0.999
        else if (exprFade < 0) exprFade = 0

        let index = (lastCurve.length - 2) * exprFade
        let start = Math.floor(index)
        const localT = index % 1

        // Get control points for this segment
        const p0 = lastCurve[start]
        const p1 = lastCurve[start + 1]
        const p2 = lastCurve[start + 2]

        // Quadratic Bezier tangent: derivative of B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
        // B'(t) = 2(1-t)(P₁ - P₀) + 2t(P₂ - P₁)
        const tangentX =
          2 * (1 - localT) * (p1.x - p0.x) + 2 * localT * (p2.x - p1.x)
        const tangentY =
          2 * (1 - localT) * (p1.y - p0.y) + 2 * localT * (p2.y - p1.y)

        // Normalize the tangent vector
        const magnitude = Math.sqrt(tangentX * tangentX + tangentY * tangentY)
        if (magnitude === 0) {
          return 0
        }

        const normalizedTangentX = tangentX / magnitude
        const normalizedTangentY = tangentY / magnitude

        // Calculate angle in radians and normalize to 0-1
        const angle = Math.atan2(normalizedTangentY, normalizedTangentX)
        const normalizedAngle = (angle + Math.PI) / (2 * Math.PI)

        return normalizedAngle
      },
      hash: x => {
        const val = Math.sin(
          this.expr(x || 'C') * (43758.5453123 + this.progress.seed)
        )
        const hash = (val + 1) / 2
        return hash
      }
    }

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
    // Procedurally bind all methods from method classes
    const methodClasses = [
      {
        instance: this.expressions,
        methods: ['expr', 'choose', 'def', 'defStatic', 'defCollect']
      },
      {
        instance: this.drawing,
        methods: ['tri', 'squ', 'pen', 'hex', 'circle', 'seq', 'line']
      },
      {
        instance: this.transformMethods,
        methods: ['to', 'parseTransform', 'applyTransform', 'reverseTransform']
      },
      {
        instance: this.textMethods,
        methods: [
          'text',
          'font',
          'resetFont',
          'keys',
          'regex',
          'parse',
          'linden'
        ]
      },
      {
        instance: this.utilities,
        methods: [
          'repeat',
          'within',
          'center',
          'each',
          'test',
          'or',
          'noise',
          'getBounds'
        ]
      },
      {
        instance: this.scenes,
        methods: ['scene', 'play', 'param', 'preset', 'toPreset', 'scrub']
      },
      {
        instance: this.oscMethods,
        methods: ['osc', 'sc', 'synth', 'file']
      },
      {
        instance: this.parsing,
        methods: [
          'tokenize',
          'parsePoint',
          'parseArgs',
          'evalPoint',
          'group',
          'end',
          'points'
        ]
      },
      {
        instance: this.data,
        methods: ['loadFiles', 'table', 'resolveName']
      }
    ]

    methodClasses.forEach(({ instance, methods }) => {
      methods.forEach(method => {
        ;(this as any)[method] = (instance as any)[method].bind(instance)
      })
    })
  }

  // Method declarations for TypeScript compatibility
  expr!: ExpressionMethods['expr']
  choose!: ExpressionMethods['choose']
  def!: ExpressionMethods['def']
  defStatic!: ExpressionMethods['defStatic']
  defCollect!: ExpressionMethods['defCollect']

  tri!: DrawingMethods['tri']
  squ!: DrawingMethods['squ']
  pen!: DrawingMethods['pen']
  hex!: DrawingMethods['hex']
  circle!: DrawingMethods['circle']
  seq!: DrawingMethods['seq']
  line!: DrawingMethods['line']

  to!: TransformMethods['to']
  parseTransform!: TransformMethods['parseTransform']
  applyTransform!: TransformMethods['applyTransform']
  reverseTransform!: TransformMethods['reverseTransform']

  text!: TextMethods['text']
  font!: TextMethods['font']
  parse!: TextMethods['parse']
  resetFont!: TextMethods['resetFont']
  keys!: TextMethods['keys']
  regex!: TextMethods['regex']
  linden!: TextMethods['linden']

  repeat!: UtilityMethods['repeat']
  within!: UtilityMethods['within']
  center!: UtilityMethods['center']
  each!: UtilityMethods['each']
  test!: UtilityMethods['test']

  or!: UtilityMethods['or']
  noise!: UtilityMethods['noise']
  getBounds!: UtilityMethods['getBounds']

  scene!: SceneMethods['scene']
  play!: SceneMethods['play']
  param!: SceneMethods['param']
  preset!: SceneMethods['preset']
  toPreset!: SceneMethods['toPreset']
  scrub!: SceneMethods['scrub']

  oscMethod!: OSCMethods['osc']
  sc!: OSCMethods['sc']
  synth!: OSCMethods['synth']
  file!: OSCMethods['file']

  tokenize!: ParsingMethods['tokenize']
  parsePoint!: ParsingMethods['parsePoint']
  parseArgs!: ParsingMethods['parseArgs']
  evalPoint!: ParsingMethods['evalPoint']
  group!: ParsingMethods['group']
  end!: ParsingMethods['end']
  points!: ParsingMethods['points']

  loadFiles!: DataMethods['loadFiles']
  table!: DataMethods['table']
  resolveName!: DataMethods['resolveName']

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
          if (!object.isSetup) {
            object.setup?.()
            object.isSetup = true
          }
          object.draw()
        } catch (e) {
          this.error(
            `Scene ${i} failed: ${e instanceof Error ? e.message : String(e)} ${
              e.stack.split('\n')[1]
            }`
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

  log(label: string, callback: () => any) {
    console.log(label, callback())
    return this
  }

  set(settings: Partial<this['settings']>) {
    Object.assign(this.settings, settings)
    return this
  }

  setup(source: string) {
    this.progress.seed = Math.random()
    this.fonts = { default: new DefaultFont(this as any) }
    this.totalLength = 0

    this.settings = defaultSettings()
    this.sceneList = []
    this.rawSource = source
    for (let font in this.fonts) this.resetFont(font)

    this.output.resetParams = true
    this.output.resetPresets = true
    try {
      // debugger
      this.parse(source)
    } catch (e: any) {
      console.error(e)
      this.output.errors.push(`Setup failed: ${e.message}`)
    }
  }

  hash = (n: number): number => {
    // Convert to string, multiply by a prime number, and take the fractional part
    const val = Math.sin(n) * (43758.5453123 + this.progress.seed)
    return Math.abs(val - Math.floor(val)) // Return the fractional part (0-1)
  }

  seed(seed: number | string) {
    const newSeed = seed ? this.expr(seed) : Math.random()
    this.progress.seed = newSeed
    return this
  }

  cloneTransform = cloneTransform

  get duration() {
    return this.totalLength
  }
}
