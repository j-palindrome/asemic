import { range, sum, sumBy } from 'lodash'
import { AsemicPt, BasicPt } from '../blocks/AsemicPt'
import { InputSchema } from '../../renderer/inputSchema'
import { defaultSettings, splitString } from '../settings'
import { AsemicData, Transform } from '../types'
import { defaultPreProcess, lerp } from '../utils'
import defaultFont from '@/lib/defaultFont.asemic?raw'

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
import { bezier } from './core/utilities'
import { AsemicFont } from '../AsemicFont'

export { AsemicGroup }
const PHI = 1.6180339887
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
    currentLine: '',
    noiseIndex: 0,
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
    scene: 0,
    regexCache: {} as Record<string, string[]>
  }
  live = {
    keys: ['']
  }

  pointConstants: Record<string, (...args: string[]) => BasicPt> = {
    '<': (pointN, thisN) => {
      const groupIndex = this.groups.length - 1
      let lastCurve: AsemicPt[]
      if (thisN === undefined) {
        lastCurve = this.currentCurve
      } else {
        const exprN = this.expr(thisN)
        lastCurve =
          this.groups[groupIndex][
            exprN < 0 ? this.groups[groupIndex].length + exprN : exprN
          ]
        if (!lastCurve) throw new Error(`No curve at ${thisN} - ${exprN}`)
      }
      return this.reverseTransform(
        this.pointConstants['>'](pointN as any, ...(lastCurve as any[]))
      )
    },
    '>': (progress, ...points) => {
      const exprPoints = points.map(x => this.evalPoint(x, { basic: true }))
      let exprFade = this.expr(progress)
      if (exprFade >= 1) exprFade = 0.999
      else if (exprFade < 0) exprFade = 0
      if (exprPoints.length === 2) {
        return exprPoints[0].clone().lerp(exprPoints[1], exprFade)
      } else return bezier(exprFade, exprPoints)
    }
  }

  constants: Record<string, ((...args: string[]) => number) | (() => number)> =
    {
      '-': x => -1 * this.expr(x),
      N: (index = '0') => {
        if (!index) index = '0'
        return this.progress.countNums[this.expr(index)]
      },
      I: index => {
        if (!index) index = '0'
        return this.progress.indexes[this.expr(index)]
      },
      i: index => {
        if (!index) index = '0'
        const solveIndex = this.expr(index)
        return (
          this.progress.indexes[solveIndex] /
          (this.progress.countNums[solveIndex] - 1 || 1)
        )
      },
      T: x => {
        return this.progress.time * (x ? this.expr(x) : 1)
      },
      '!': continuing => {
        const continuingSolved = this.expr(continuing)
        return continuingSolved ? 0 : 1
      },
      H: number =>
        (this.preProcessing.height / this.preProcessing.width) *
        (number ? this.expr(number) : 1),
      S: () => this.progress.scrub,
      C: () => this.progress.curve,
      L: () => this.progress.letter,
      P: () => this.progress.point,
      px: (i = 1) => (1 / this.preProcessing.width) * this.expr(i),
      sin: x => {
        const result = Math.sin(this.expr(x) * Math.PI * 2)
        return result
      },
      PHI: x => {
        const result = Math.pow(1.6180339887, this.expr(x || '1'))
        return result
      },
      table: (name, point, channel) => {
        const imageName = typeof name === 'string' ? name : String(name)
        return this.table(imageName, point, channel)
      },
      '?': (...args) => {
        const [condition, trueValue, falseValue] = args.map(x =>
          this.expr(x || '0')
        )
        return condition > 0 ? trueValue : falseValue ?? 0
      },
      '>': (...args) => {
        let exprFade = this.expr(args[0])
        if (exprFade >= 1) exprFade = 0.999
        else if (exprFade < 0) exprFade = 0
        const exprPoints = [...args.slice(1)].map(x => this.expr(x))

        let index = (exprPoints.length - 1) * exprFade

        return lerp(
          exprPoints[Math.floor(index)]!,
          exprPoints[Math.floor(index) + 1]!,
          index % 1
        )
      },
      choose: (...args) => {
        const index = Math.floor(this.expr(args[0]))
        const savedArgs = args.slice(1)
        if (index < 0 || index >= savedArgs.length) {
          throw new Error(
            `Choose index out of range for args, ${args.join(' ')}: ${index}`
          )
        }
        return this.expr(savedArgs[Math.floor(index)])
      },
      fib: x => {
        const n = Math.floor(this.expr(x))
        if (n <= 0) return 0
        if (n === 1) return 1
        let a = 0,
          b = 1,
          temp
        for (let i = 2; i <= n; i++) {
          temp = a + b
          a = b
          b = temp
        }
        return b
      },
      mix: (...args) => {
        return sumBy(args.map(x => this.expr(x))) / args.length
      },
      sah: (val1, val2) => {
        const currentValue = `${this.progress.scene}:${this.progress.noiseIndex}`

        if (!this.noiseTable[currentValue]) {
          this.noiseTable[currentValue] = {
            value: 0,
            sampling: false,
            noise: (val1, val2) => {
              const sampling = this.noiseTable[currentValue].sampling
              if (val2 > 0.5 && !sampling) {
                this.noiseTable[currentValue].sampling = true
                this.noiseTable[currentValue].value = val1
              } else if (val2 <= 0.5) {
                this.noiseTable[currentValue].sampling = false
              }
              return this.noiseTable[currentValue].value
            }
          }
        }
        this.progress.noiseIndex++
        const val1e = this.expr(val1)
        const val2e = this.expr(val2)
        return this.noiseTable[currentValue].noise(val1e, val2e)
      },
      '~': (...fms) => {
        const currentValue = `${this.progress.scene}:${this.progress.noiseIndex}`
        if (!this.noiseTable[currentValue]) {
          if (!fms[0]) fms[0] = '1+#,#'
          const fmCurve = fms.map((token, i) => {
            return this.evalPoint(token, {
              basic: true,
              defaultY: i === 0 ? Math.random() : 1
            })
          })
          // if (this.progress.scene === 5) debugger
          const freq = fmCurve[0][0] * Math.PI * 2
          const phase = fmCurve[0][1] * Math.PI * 2
          let freqPhases = fmCurve.map(() => Math.random() * Math.PI * 2)
          this.noiseTable[currentValue] = {
            value: 0,
            noise: t => {
              t = t + phase
              let globalSpeed = this.expr(freq)
              let frequ = globalSpeed * t
              for (let i = 1; i < fmCurve.length; i++) {
                const [freqMod, mod] = fmCurve[i]
                frequ +=
                  Math.sin(t * globalSpeed * freqMod + freqPhases[i]) * mod
              }
              return Math.sin(frequ) * 0.5 + 0.5
            }
          }
        }
        this.progress.noiseIndex++

        const noise = this.noiseTable[currentValue].noise(this.progress.time)
        return noise
      },
      bell: (range0to1, closeness) => {
        const x = this.expr(range0to1)
        if (!closeness) closeness = '1'
        return (this.hash(x) > 0.5 ? 1 : -1) * x ** this.expr(closeness)
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
      '#': x => {
        const val = Math.sin(
          this.expr(x || 'C') * (43758.5453123 + this.progress.seed)
        )
        const hash = (val + 1) / 2
        return hash
      },
      abs: value => Math.abs(this.expr(value)),
      peaks: (position, ...peaks) => {
        const values = peaks.map(p =>
          this.evalPoint(p, { basic: true, defaultY: 1 })
        )
        const pos = this.expr(position)
        for (let value of values) {
          if (Math.abs(pos - value[0]) < value[1])
            return 1 - Math.abs(pos - value[0]) / value[1]
        }
        return 0
      }
    }

  reservedConstants = Object.keys(this.constants)
  fonts: Record<string, AsemicFont> = {}
  currentFont = 'default'
  lastPoint: AsemicPt
  noiseTable: Record<
    string,
    { noise: (...values: number[]) => number; value: number } & Record<
      string,
      any
    >
  > = {}
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
        methods: ['expr', 'choose', 'def', 'remap', 'defCollect']
      },
      {
        instance: this.drawing,
        methods: ['c3', 'c4', 'c5', 'c6', 'circle']
      },
      {
        instance: this.transformMethods,
        methods: ['to', 'parseTransform', 'applyTransform', 'reverseTransform']
      },
      {
        instance: this.textMethods,
        methods: ['text', 'resetFont', 'keys', 'regex', 'parse', 'linden']
      },
      {
        instance: this.utilities,
        methods: [
          'interp',
          'repeat',
          'bepeat',
          'within',
          'align',
          'alignX',
          'add',
          'getBounds',
          'if'
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
  remap!: ExpressionMethods['remap']
  defCollect!: ExpressionMethods['defCollect']

  to!: TransformMethods['to']
  parseTransform!: TransformMethods['parseTransform']
  applyTransform!: TransformMethods['applyTransform']
  reverseTransform!: TransformMethods['reverseTransform']

  text!: TextMethods['text']
  parse!: TextMethods['parse']
  resetFont!: TextMethods['resetFont']
  keys!: TextMethods['keys']
  regex!: TextMethods['regex']
  linden!: TextMethods['linden']

  repeat!: UtilityMethods['repeat']
  bepeat!: UtilityMethods['bepeat']
  within!: UtilityMethods['within']
  align!: UtilityMethods['align']
  alignX!: UtilityMethods['alignX']
  add!: UtilityMethods['add']
  getBounds!: UtilityMethods['getBounds']
  if!: UtilityMethods['if']

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
    this.progress.accumIndex = 0
    this.progress.seed = 1
  }

  draw() {
    try {
      this.reset()
    } catch (e) {
      this.error(`Error at reset: ${(e as Error).message}`)
    }
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
        this.progress.scene = i
        this.progress.noiseIndex = 0

        if (!object.isSetup) {
          object.setup?.()
          object.isSetup = true
        }

        if (
          this.pauseAt === false &&
          object.pause !== false &&
          this.progress.progress >= object.start + object.pause
        ) {
          const pause = (object.start + object.pause).toFixed(5)
          if (!this.pausedAt.includes(pause)) {
            this.pauseAt = pause
            break
          }
        }
        object.draw()
        // try {
        //   object.draw()
        // } catch (e) {
        //   this.error(
        //     `Error at ${this.progress.currentLine}: ${(e as Error).message}`
        //   )
        // }
      }
      i++
    }
    this.output.progress = this.progress.progress
    this.output.pauseAt = this.pauseAt
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
    this.fonts = {}
    this.totalLength = 0
    this.text(defaultFont)

    this.settings = defaultSettings()
    this.sceneList = []
    this.rawSource = source
    for (let font in this.fonts) this.resetFont(font)

    this.output.resetParams = true
    this.output.resetPresets = true
    // try {
    this.parse(source)
    // } catch (e: any) {
    //   console.error(e)
    // }

    this.noiseTable = {}

    return this
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
