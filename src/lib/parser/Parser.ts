import { range, sum, sumBy } from 'lodash'
import { AsemicPt, BasicPt } from '../blocks/AsemicPt'
import { InputSchema } from '../../renderer/inputSchema'
import { defaultSettings, splitString } from '../settings'
import { AsemicData, Transform } from '../types'
import { defaultPreProcess, lerp, parseFromFunction } from '../utils'
import defaultFont from '@/lib/defaultFont.asemic?raw'
const ONE_FRAME = 1 / 60

// Core classes
import { AsemicGroup } from './core/AsemicGroup'
import { defaultOutput } from './core/Output'

// Method classes
import { DataMethods } from './methods/Data'
import { DrawingMethods } from './methods/Drawing'
import { ExpressionMethods } from './methods/Expressions'
import { ParsingMethods } from './methods/Parsing'
import { TextMethods } from './methods/Text'
import { TransformMethods } from './methods/Transforms'
import { UtilityMethods } from './methods/Utilities'
import { bezier } from './core/utilities'
import { AsemicFont } from '../AsemicFont'

export { AsemicGroup }
const PHI = 1.6180339887

export interface Scene {
  code: string
  length?: number
  offset?: number
  pause?: number | false
  params?: Record<string, number[]>
  // Runtime-only properties (not persisted):
  // scrub?: number - Current playback position within scene (calculated from global progress)
  [key: string]: any
}

export class Parser {
  mode = 'normal' as 'normal' | 'blank'
  adding = 0
  debugged = new Map<string, { errors: string[] }>()
  groups: AsemicGroup[] = []
  settings = defaultSettings()
  static defaultSettings = defaultSettings()
  currentCurve: AsemicPt[] = []
  currentTransform: Transform
  transformStack: Transform[] = []
  namedTransforms: Record<string, Transform> = {}
  pausedAt: string[] = []
  pauseAt: string | false = false
  progress = {
    currentLine: '',
    noiseIndex: 0,
    point: 0,
    curve: 0,
    seeds: range(100).map(x => Math.random()),
    indexes: range(3).map(x => 0),
    countNums: range(3).map(x => 0),
    accums: [] as number[],
    accumIndex: 0,
    letter: 0,
    scrub: 0,
    scrubTime: 0,
    progress: 0,
    scene: 0 // Current scene index for noise table isolation
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
        const exprN = this.expressions.expr(thisN)
        lastCurve =
          this.groups[groupIndex][
            exprN < 0 ? this.groups[groupIndex].length + exprN : exprN
          ]
        if (!lastCurve) throw new Error(`No curve at ${thisN} - ${exprN}`)
      }
      return this.transformMethods.reverseTransform(
        this.pointConstants['>'](pointN as any, ...(lastCurve as any[]))
      )
    },
    '>': (progress, ...points) => {
      const exprPoints = points.map(x =>
        this.parsing.evalPoint(x, { basic: true })
      )
      let exprFade = this.expressions.expr(progress)
      if (exprFade >= 1) exprFade = 0.999
      else if (exprFade < 0) exprFade = 0
      if (exprPoints.length === 2) {
        return exprPoints[0].clone().lerp(exprPoints[1], exprFade)
      } else return bezier(exprFade, exprPoints)
    }
  }

  constants: Record<string, ((...args: string[]) => number) | (() => number)> =
    {
      h: x => parseFromFunction(this.currentTransform.h),
      w: x => parseFromFunction(this.currentTransform.w),
      a: x => parseFromFunction(this.currentTransform.a),
      s: x => parseFromFunction(this.currentTransform.s),
      l: x => parseFromFunction(this.currentTransform.l),
      '-': x => -1 * this.expressions.expr(x),
      N: (index = '0') => {
        if (!index) index = '0'
        return this.progress.countNums[this.expressions.expr(index)]
      },
      I: index => {
        if (!index) index = '0'
        return this.progress.indexes[this.expressions.expr(index)]
      },
      i: index => {
        if (!index) index = '0'
        const solveIndex = Math.floor(this.expressions.expr(index))
        // if (this.progress.scene === 12) debugger
        return (
          this.progress.indexes[solveIndex] /
          (this.progress.countNums[solveIndex] - 1 || 1)
        )
      },
      T: x => {
        return (performance.now() / 1000) * (x ? this.expressions.expr(x) : 1)
      },
      '!': continuing => {
        const continuingSolved = this.expressions.expr(continuing)
        return continuingSolved ? 0 : 1
      },
      H: number =>
        (this.preProcessing.height / this.preProcessing.width) *
        (number ? this.expressions.expr(number) : 1),
      S: () => this.progress.scrub,
      C: () => this.progress.curve,
      L: () => this.progress.letter,
      P: () => this.progress.point,
      px: i => (1 / this.preProcessing.width) * this.expressions.expr(i || 1),
      sin: x => {
        const result = Math.sin(this.expressions.expr(x) * Math.PI * 2)
        return result
      },
      PHI: x => {
        const result = Math.pow(1.6180339887, this.expressions.expr(x || '1'))
        return result
      },
      table: (name, point, channel) => {
        const imageName = typeof name === 'string' ? name : String(name)
        return this.data.table(imageName, point as string, channel as string)
      },
      '?': (...args) => {
        const [condition, trueValue, falseValue] = args.map(x =>
          this.expressions.expr(x || '0')
        )
        return condition > 0 ? trueValue : falseValue ?? 0
      },
      '>': (...args) => {
        let exprFade = this.expressions.expr(args[0])
        if (exprFade >= 1) exprFade = 0.999
        else if (exprFade < 0) exprFade = 0
        const exprPoints = [...args.slice(1)].map(x => this.expressions.expr(x))

        let index = (exprPoints.length - 1) * exprFade

        return lerp(
          exprPoints[Math.floor(index)]!,
          exprPoints[Math.floor(index) + 1]!,
          index % 1
        )
      },
      '<>': (...args) => {
        const progress = this.expressions.expr(args[0])
        const spread = this.expressions.expr(args[1] || '1')
        const center = this.expressions.expr(args[2] || '0')
        const max = center + spread / 2
        const min = center - spread / 2
        return progress * (max - min) + min
      },
      choose: (...args) => {
        const index = Math.floor(this.expressions.expr(args[0]))
        const savedArgs = args.slice(1)
        if (index < 0 || index >= savedArgs.length) {
          throw new Error(
            `Choose index out of range for args, ${args.join(' ')}: ${index}`
          )
        }
        return this.expressions.expr(savedArgs[Math.floor(index)])
      },
      fib: x => {
        const n = Math.floor(this.expressions.expr(x))
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
        return sumBy(args.map(x => this.expressions.expr(x))) / args.length
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
        const val1e = this.expressions.expr(val1)
        const val2e = this.expressions.expr(val2)
        return this.noiseTable[currentValue].noise(val1e, val2e)
      },
      '~': (...fms) => {
        const currentValue = `${this.progress.scene}:${this.progress.noiseIndex}`

        if (!this.noiseTable[currentValue]) {
          if (!fms[0]) fms[0] = '1+#,#'
          const fmCurve = fms.map((token, i) => {
            return this.parsing.evalPoint(token, {
              basic: true,
              defaultY: i === 0 ? Math.random() : 1
            })
          })
          const freq = fmCurve[0][0] * Math.PI * 2
          const phase = fmCurve[0][1] * Math.PI * 2
          let freqPhases = fmCurve.map(() => Math.random() * Math.PI * 2)
          this.noiseTable[currentValue] = {
            value: 0,
            noise: t => {
              t = t + phase
              let globalSpeed = this.expressions.expr(freq)
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

        const noise = this.noiseTable[currentValue].noise(
          performance.now() / 1000
        )
        return noise
      },
      bell: (range0to1, sign) => {
        const x = this.expressions.expr(range0to1)
        const hash = this.expressions.expr(
          sign || this.constants['#'](range0to1)
        )
        // debugger
        return (hash > 0.5 ? 1 : -1) * x * 0.5 + 0.5
      },
      tangent: (progress, curve) => {
        let lastCurve: AsemicPt[]
        if (!curve) {
          lastCurve = this.currentCurve
        } else {
          const exprN = this.expressions.expr(curve)
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

        let exprFade = this.expressions.expr(progress)
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
        const val =
          (this.expressions.expr(x || 'C') *
            (43758.5453123 + this.progress.seeds[this.progress.curve % 100])) %
          1
        // const hash = (val + 1) / 2
        return val
      },
      abs: value => Math.abs(this.expressions.expr(value)),
      peaks: (position, ...peaks) => {
        const values = peaks.map(p =>
          this.parsing.evalPoint(p, { basic: true, defaultY: 1 })
        )
        const pos = this.expressions.expr(position)
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
  expressions: ExpressionMethods
  drawing: DrawingMethods
  transformMethods: TransformMethods
  textMethods: TextMethods
  utilities: UtilityMethods
  parsing: ParsingMethods
  data: DataMethods

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
    this.parsing = new ParsingMethods(this)
    this.data = new DataMethods(this)
    this.setup()
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
      this.progress.progress += this.pauseAt !== false ? 0 : ONE_FRAME
      // Remove totalLength comparison
      if (this.pauseAt === false) {
        this.pausedAt = []
      }

      this.output = defaultOutput()
      this.output.pauseAt = this.pauseAt
      this.currentFont = 'default'
    }
    this.transformStack = []
    this.currentTransform = this.transformMethods.defaultTransform()
    this.lastPoint = new AsemicPt(this as any, 0, 0)
    this.currentCurve = []
    this.currentFont = 'default'
    this.progress.point = 0
    this.progress.curve = 0
    this.progress.noiseIndex = 0
    this.progress.letter = 0

    for (let i = 0; i < 3; i++) {
      this.progress.indexes[i] = 0
      this.progress.countNums[i] = 0
    }
    this.progress.accumIndex = 0
  }

  draw(scene: Scene) {
    try {
      this.reset()
    } catch (e) {
      this.error(`Error at reset: ${(e as Error).message}`)
    }

    this.progress.scrub = scene.scrub || 0
    this.progress.scrubTime = scene.scrub * (scene.length || 0.1) || 0
    for (let param in scene.params) {
      this.constants[param] = (index: string) =>
        scene.params![param][Math.floor(this.expressions.expr(index)) || 0]
    }

    // Execute the scene's code
    try {
      this.textMethods.text(scene.code)
    } catch (e) {
      this.error(
        `Error at ${this.progress.currentLine}: ${(e as Error).message}`
      )
    }

    this.output.progress = this.progress.progress
    this.output.pauseAt = this.pauseAt
  }

  debug(slice: number = 0) {
    const toFixed = (x: number) => {
      const str = x.toFixed(2)
      return str
    }
    const allCurves = this.groups.flat()
    const c = allCurves
      .slice(slice)
      .map(
        curve =>
          `[${curve.map(x => `${toFixed(x[0])},${toFixed(x[1])}`).join(' ')}]`
      )
      .join('\n')
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

  setup() {
    this.progress.seeds = range(100).map(x => Math.random())
    this.fonts = {}
    this.textMethods.text(defaultFont)

    this.settings = defaultSettings()
    for (let font in this.fonts) this.textMethods.resetFont(font)

    this.output.resetPresets = true
    this.noiseTable = {}

    return this
  }
}
