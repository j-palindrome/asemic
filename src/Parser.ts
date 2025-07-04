import _, { clamp, isUndefined, last, sortBy } from 'lodash'
import { createNoise2D } from 'simplex-noise'
import { defaultSettings, splitString } from './settings'
import { AsemicPt, BasicPt } from './blocks/AsemicPt'
import { AsemicFont, DefaultFont } from './defaultFont'
import { defaultPreProcess, lerp, stripComments } from './utils'
import { AsemicData, Transform } from './types'
import { InputSchema } from './server/constants'
import { log } from 'console'

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

const defaultOutput = () =>
  ({
    osc: [],
    curves: [],
    errors: [],
    pauseAt: false,
    eval: [],
    params: {}
  } as {
    osc: { path: string; args: (string | number | [number, number])[] }[]
    errors: string[]
    pauseAt: string | false
    eval: string[]
    params: InputSchema['params']
  })

export class Parser {
  rawSource = ''
  protected mode = 'normal' as 'normal' | 'blank'
  protected adding = 0
  protected debugged = new Map<string, { errors: string[] }>()
  curves: AsemicPt[][] = []
  settings = defaultSettings()
  static defaultSettings = defaultSettings()
  protected currentCurve: AsemicPt[] = []
  currentTransform: Transform = defaultTransform()
  protected transforms: Transform[] = []
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
    seed: 1,
    index: 0,
    countNum: 0,
    accums: [] as number[],
    accumIndex: 0,
    letter: 0,
    scrub: 0,
    scrubTime: 0,
    progress: 0
  }
  live = {
    keys: [''],
    text: ['']
  }
  protected constants: Record<
    string,
    ((args: string[]) => number) | (() => number)
  > = {
    N: () => this.progress.countNum,
    I: () => this.progress.index,
    T: () => this.progress.time,
    H: () => {
      const height = this.preProcessing.height / this.preProcessing.width
      return height
    },
    Sc: () => this.progress.scrub,
    S: () => this.progress.scrubTime,
    P: () => this.progress.point,
    C: () => this.progress.curve,
    L: () => this.progress.letter,
    px: () => {
      const pixels = this.preProcessing.width
      return 1 / pixels
    },

    sin: ([x]) => Math.sin(this.evalExpr(x, false) * Math.PI * 2) * 0.5 + 0.5,
    acc: ([x]) => {
      if (!this.progress.accums[this.progress.accumIndex])
        this.progress.accums.push(0)
      const value = this.evalExpr(x, false)
      // correct for 60fps
      this.progress.accums[this.progress.accumIndex] += value / 60
      const currentAccum = this.progress.accums[this.progress.accumIndex]
      this.progress.accumIndex++
      return currentAccum
    }
  }
  protected reservedConstants = Object.keys(this.constants)
  protected fonts: Record<string, AsemicFont> = {
    default: new DefaultFont()
  }
  protected currentFont = 'default'
  protected lastPoint: AsemicPt = new AsemicPt(this, 0, 0)
  protected noiseTable: ((x: number, y: number) => number)[] = []
  protected noiseIndex = 0
  protected noise = createNoise2D()
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

  protected reset() {
    this.curves = []
    this.transforms = []
    this.progress.time = performance.now() / 1000
    this.progress.progress += this.pauseAt !== false ? 0 : ONE_FRAME
    if (this.progress.progress >= this.totalLength - ONE_FRAME) {
      this.pausedAt = []
      this.progress.progress = 0
    }

    this.output = defaultOutput()
    this.output.pauseAt = this.pauseAt
    this.lastPoint = new AsemicPt(this, 0, 0)
    this.resetTransform()
  }

  protected resetTransform() {
    for (let font of Object.keys(this.fonts)) this.fonts[font].reset()
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

  prm(paramName: string, defaultValue: Expr, max: Expr, min: Expr) {
    this.params[paramName] = {
      type: 'number',
      value: defaultValue ? this.evalExpr(defaultValue) : 0,
      max: max ? this.evalExpr(max) : 1,
      min: min ? this.evalExpr(min) : 0
    }
    this.output.params[paramName] = this.params[paramName]
    this.constants[paramName] = () => this.params[paramName].value

    return this
  }

  scr(progress: number) {
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

  rpt(count: Expr, callback: (p: this) => void) {
    const countNum = this.evalExpr(count)

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
        this.resetTransform()
        this.progress.scrub =
          (this.progress.progress - object.start) / object.length
        this.progress.scrubTime = this.progress.progress - object.start

        object.callback(this)

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

  scn(
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

  setup(source: string) {
    // for (let replacement of Object.keys(this.preProcessing.replacements)) {
    //   source = source.replace(
    //     replacement,
    //     this.preProcessing.replacements[replacement]
    //   )
    // }
    this.fonts = { default: new DefaultFont() }
    this.params = {} as InputSchema['params']
    this.totalLength = 0

    this.settings = defaultSettings()
    this.scenes = []
    eval(source)
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
      h = this.evalExpr(hwParts[0])!
      w = hwParts.length > 1 ? this.evalExpr(hwParts[1])! : 0
    }

    return [startPoint, endPoint, h, w] as [AsemicPt, AsemicPt, number, number]
  }

  osc(argsStr: string) {
    const args = this.tokenize(argsStr)
    const [path, ...messages] = args
    this.output.osc.push({
      path,
      args: messages.map(x => {
        if (x.startsWith("'")) {
          return x.substring(1)
        } else if (x.startsWith('"')) {
          return x.substring(1, x.length - 1)
        } else if (x.includes(',')) {
          return [...this.evalPoint(x)] as [number, number]
        } else {
          const evaluated = this.evalExpr(x)
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
  cir(argsStr: string) {
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

  evalExpr(expr: Expr, replace = true): number {
    try {
      if (expr === undefined || expr === null) {
        throw new Error('undefined or null expression')
      }
      if (typeof expr === 'number') {
        return expr
      }
      if (expr.length === 0) throw new Error('Empty expression')

      this.progress.curve++

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

        return this.evalExpr(
          expr.substring(0, start) +
            this.evalExpr(expr.substring(start + 1, end)).toFixed(4) +
            expr.substring(end + 1)
        )
      }

      if (replace) {
        if (expr.includes('`')) {
          const matches = expr.matchAll(/`([^`]+)`/g)
          for (let match of matches) {
            const [original, expression] = match
            expr = expr.replace(original, eval(expression))
          }
        }
      }

      if (expr.match(/^\-?[0-9\.]+$/)) {
        return parseFloat(expr)
      }

      if (expr.includes('<')) {
        // 1.1<R>2.4
        let [firstPoint, fade, ...nextPoints] = expr.split(/[<>]/g).map(x => {
          return this.evalExpr(x, false)
        })
        fade = clamp(fade, 0, 1)
        const points = [firstPoint, ...nextPoints]
        let index = (points.length - 1) * fade
        if (index === points.length - 1) index -= 0.0001
        // if (
        //   lerp(
        //     points[Math.floor(index)]!,
        //     points[Math.floor(index) + 1]!,
        //     index % 1
        //   ) === 0
        // ) {
        //   debugger
        // }

        return lerp(
          points[Math.floor(index)]!,
          points[Math.floor(index) + 1]!,
          index % 1
        )
      }

      const operatorsList = ['_', '+', '-', '*', '/', '%', '^', '#', '~']
      for (let i = expr.length - 1; i >= 0; i--) {
        if (operatorsList.includes(expr[i])) {
          let operators: [number, number]
          switch (expr[i]) {
            case '^':
              operators = splitString(expr, '^').map(
                x => this.evalExpr(x, false)!
              ) as [number, number]
              return operators[0] ** operators[1]

            case '_':
              let [round, after] = splitString(expr, '_')
              if (!after) after = '1'
              const afterNum = this.evalExpr(after, false)
              return Math.floor(this.evalExpr(round) / afterNum) * afterNum

            case '+':
              operators = splitString(expr, '+').map(
                x => this.evalExpr(x, false)!
              ) as [number, number]
              return operators[0] + operators[1]

            case '-':
              operators = splitString(expr, '-').map(
                x => this.evalExpr(x, false)!
              ) as [number, number]
              return operators[0] - operators[1]

            case '*':
              const split = splitString(expr, '*')
              operators = split.map(x => this.evalExpr(x, false)!) as [
                number,
                number
              ]
              return operators[0] * operators[1]

            case '/':
              operators = splitString(expr, '/').map(
                x => this.evalExpr(x, false)!
              ) as [number, number]
              return operators[0] / operators[1]

            case '%':
              operators = splitString(expr, '%').map(
                x => this.evalExpr(x, false)!
              ) as [number, number]
              return operators[0] % operators[1]

            case '#':
              const exprHash = splitString(expr, '#')[0]
              if (!exprHash) {
                return Math.random()
              }
              return this.hash(this.evalExpr(exprHash, false))

            case '~':
              const speed = this.evalExpr(splitString(expr, '~')[0] || '1')

              let sampleIndex = this.noiseIndex
              while (sampleIndex > this.noiseTable.length - 1) {
                this.noiseTable.push(createNoise2D())
              }

              const noise =
                this.noiseTable[this.noiseIndex](
                  speed * this.progress.time,
                  this.noiseIndex
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
        const args = this.tokenize(expr.substring(functionCall.length))
        return this.constants[functionCall](args)
      }

      throw new Error(`Invalid expression`)
    } catch (e) {
      throw new Error(`Expression failed ${expr}:\n${e.message}`)
    }
  }

  protected evalPoint<K extends boolean>(
    point: string,
    {
      defaultValue = true,
      basic = false as any
    }: { defaultValue?: boolean | number; basic?: K } = {} as any
  ): K extends true ? BasicPt : AsemicPt {
    // match 1,1<0.5>2,2>3,3 but not 1,1<0.5>2
    if (/^[^<]+,[^<]+<[^>,]+\>[^>,]+,[^>,]+/.test(point)) {
      const [firstPoint, fade, ...nextPoints] = point
        .split(/[<>]/g)
        .map((x, i) => {
          return i === 1
            ? this.evalExpr(x)
            : this.evalPoint(x, { defaultValue })
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
    // else if (point.startsWith('(')) {
    //   let end = 0
    //   let evalPoint: string | undefined = undefined
    //   let endPoint: string | undefined = undefined
    //   let expression: string | undefined = undefined
    //   for (let i = 0; i < point.length; i++) {
    //     if (point[i] === '(') end++
    //     else if (point[i] === ')') {
    //       end--
    //       if (end === 0) {
    //         evalPoint = point.substring(1, i)
    //         endPoint = point.substring(i + 2)
    //         expression = point[i + 1]
    //         break
    //       }
    //     }
    //   }
    //   if (!evalPoint || !endPoint || !expression) {
    //     throw new Error(`Invalid parentheses: ${point}`)
    //   }
    //   const initialPoint = this.evalPoint(evalPoint, {
    //     defaultValue
    //   })
    //   const modifierPoint = this.evalPoint(endPoint, {
    //     defaultValue
    //   })
    //   switch (expression) {
    //     case '*':
    //       return initialPoint.scale(modifierPoint) as K extends true
    //         ? BasicPt
    //         : AsemicPt
    //     case '+':
    //       return initialPoint.add(modifierPoint) as K extends true
    //         ? BasicPt
    //         : AsemicPt
    //     case '-':
    //       return initialPoint.subtract(modifierPoint) as K extends true
    //         ? BasicPt
    //         : AsemicPt
    //     case '/':
    //       return initialPoint.divide(modifierPoint) as K extends true
    //         ? BasicPt
    //         : AsemicPt
    //     case '^':
    //       return initialPoint.exponent([
    //         modifierPoint.x,
    //         modifierPoint.y
    //       ]) as K extends true ? BasicPt : AsemicPt
    //   }
    // }
    const parts = point.split(',')
    if (parts.length === 1) {
      if (defaultValue === false) throw new Error(`Incomplete point: ${point}`)
      return new AsemicPt(
        this,
        this.evalExpr(parts[0])!,
        defaultValue === true ? this.evalExpr(parts[0])! : defaultValue
      )
    }
    return (
      basic
        ? new BasicPt(...parts.map(x => this.evalExpr(x)!))
        : new AsemicPt(this, ...parts.map(x => this.evalExpr(x)!))
    ) as K extends true ? BasicPt : AsemicPt
  }

  protected applyTransform = (
    point: AsemicPt,
    { relative = false, randomize = true } = {}
  ): AsemicPt => {
    point
      .scale(this.currentTransform.scale)
      .rotate(this.currentTransform.rotation)

    if (this.currentTransform.rotate !== undefined && randomize) {
      point.rotate(this.evalExpr(this.currentTransform.rotate))
    }
    if (this.currentTransform.add !== undefined && randomize) {
      point.add(
        this.parsePoint(this.currentTransform.add)
          .scale(this.currentTransform.scale)
          .rotate(this.currentTransform.rotation)
      )
    }
    point.add(relative ? this.lastPoint : this.currentTransform.translation)
    return point
  }

  protected reverseTransform = (
    point: AsemicPt,
    { randomize = true } = {}
  ): AsemicPt => {
    point.subtract(this.currentTransform.translation)
    if (this.currentTransform.add !== undefined && randomize) {
      const addPoint = this.evalPoint(this.currentTransform.add)
      addPoint.scale(this.currentTransform.scale)
      point.subtract(addPoint)
    }
    if (this.currentTransform.rotate !== undefined && randomize) {
      point.rotate(this.evalExpr(this.currentTransform.rotate) * -1)
    }
    point
      .divide(this.currentTransform.scale)
      .rotate(this.currentTransform.rotation * -1)
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

        let p = this.evalExpr(notation)
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
        const [theta, radius] = this.evalPoint(notation.substring(1), {
          defaultValue: false
        })

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

  tras(...tokens: string[]) {
    for (let token of tokens) {
      this.tra(token)
    }
    return this
  }

  tra(token: string) {
    token = token.trim()
    const transforms = this.tokenize(token)

    transforms.forEach(transform => {
      if (transform === '<') {
        Object.assign(this.currentTransform, this.transforms.pop()!)
      } else if (transform === '>') {
        this.transforms.push(this.cloneTransform(this.currentTransform))
      } else if (transform === '!') {
        // Reset all transformations
        this.currentTransform.scale.set([1, 1])
        this.currentTransform.rotation = 0
        this.currentTransform.translation.set([0, 0])
        delete this.currentTransform.add
        delete this.currentTransform.rotate
      } else if (transform.startsWith('*<')) {
        this.currentTransform.scale.set(last(this.transforms)?.scale ?? [1, 1])
      } else if (transform.startsWith('+<')) {
        this.currentTransform.translation.set(
          last(this.transforms)?.translation ?? [0, 0]
        )
      } else if (transform.startsWith('@<')) {
        this.currentTransform.rotation = last(this.transforms)?.rotation ?? 0
      } else if (transform.startsWith('*!')) {
        // Reset scale
        this.currentTransform.scale.set([1, 1])
      } else if (transform.startsWith('@!')) {
        // Reset rotation
        this.currentTransform.rotation = 0
      } else if (transform.startsWith('+!')) {
        // Reset translation
        this.currentTransform.translation.set([0, 0])
      } else if (transform.startsWith('+=>')) {
        this.currentTransform.add = transform.substring(3)
      } else if (transform.startsWith('@=>')) {
        this.currentTransform.rotate = transform.substring(3)
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
          this.currentTransform.scale.scale(this.evalPoint(match[2]))
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
          this.currentTransform.rotation += this.evalExpr(match[2])!
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
          this.currentTransform.translation.add(
            this.evalPoint(match[2])
              .scale(this.currentTransform.scale)
              .rotate(this.currentTransform.rotation)
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
              this.currentTransform.width = value
              break
            default:
              if (value.includes(',')) {
                this.currentTransform[key] = this.evalPoint(value, {
                  basic: true
                })
              } else {
                this.currentTransform[key] = value
              }
              break
          }
        }
      }
    })
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

  crvs(...tokens: string[]) {
    for (let token of tokens) {
      this.crv(token)
    }
    return this
  }

  crv(token: string, { add = false }: { add?: boolean } = {}) {
    const pointsTokens = this.tokenize(token)

    let totalLength =
      pointsTokens.filter(x => !x.startsWith('{')).length - 1 || 1

    const originalEnd = this.adding
    this.adding += totalLength
    pointsTokens.forEach((pointToken, i) => {
      if (pointToken.startsWith('{')) {
        this.tra(pointToken)
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
            const evaled = this.evalExpr(pointToken)
            if (evaled) {
              this.currentCurve.push(this.parsePoint(evaled))
            } else {
              throw new Error(`Function ${pointToken} doesn't return a point`)
            }
          }
        }
      }
    })
    if (!add) {
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

    this.constants[key] = () => this.evalExpr(definition)

    return this
  }

  fnt(name: string, chars?: AsemicFont['characters']) {
    this.currentFont = name
    if (chars) {
      if (!this.fonts[name]) {
        this.fonts[name] = new AsemicFont(chars as any)
      } else {
        this.fonts[name].parseCharacters(chars)
      }
    }

    return this
  }

  evl(script: string) {
    this.evl(script)
    return this
  }

  txt(token: string, { add = false }: { add?: boolean } = {}) {
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

    if (font.characters['\\^'] && !add) {
      font.characters['\\^'](this)
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
        this.tra(token.substring(start + 1, end))
        continue
      }
      this.progress.letter = i / (token.length - 1)

      if (!font.characters[token[i]]) {
        continue
      }
      ;(font.characters[token[i]] as any)(this)
      if (font.characters['\\.']) {
        ;(font.characters['\\.'] as any)(this)
      }
    }
    if (font.characters['\\$'] && !add) {
      font.characters['\\$'](this)
    }

    return this
  }

  // protected parseToken(token: string, { mode }: { mode?: 'blank' } = {}) {
  //   try {
  //     token = token.trim()
  //     this.adding = false

  //     if (token.startsWith('+')) {
  //       token = token.substring(1)
  //       this.adding = true
  //     }

  //     while (token.startsWith('(') && token.endsWith(')')) {
  //       token = token.substring(1, token.length - 1).trim()
  //     }

  //     if (token.includes('|')) {
  //       return
  //     }

  //     const constMatch = token.match(/^([a-zA-Z0-9]+)(\=\>?)(.+)/)

  //     if (constMatch) {
  //       const [_, key, type, value] = constMatch

  //       return
  //     }

  //     const functionCall = token.match(/^([a-zA-Z0-9]+)(?!\=)/)

  //     if (functionCall && this.constants[functionCall[1]]) {
  //       const returnText = this.evalFunction(token)

  //       if (returnText) {
  //         this.parse(returnText, { mode })
  //       }
  //       return
  //     }

  //     if (token.startsWith('{{') && token.endsWith('}}')) {

  //       parseFontSettings()
  //       return
  //     } else if (token.startsWith('{') && token.endsWith('}')) {
  //       this.transform(token)
  //       return
  //     } else if (token.startsWith('`')) {
  //       token = token.substring(1, token.length - 1)
  //       if (token.startsWith('client')) {
  //         const clientFunction = token.substring(6)
  //         this.output.eval.push(clientFunction)
  //       } else {
  //         const result = eval(`({ _ }) => {
  //             ${token}
  //           }`)({ _ })
  //         if (typeof result === 'string') {
  //           this.parse(result)
  //         }
  //       }

  //       return
  //     } else if (token.startsWith('"')) {
  //     }

  //     if (token.startsWith('[')) {

  //       return
  //     }
  //   } catch (e) {
  //     this.error(`Token failed ${token}:\n${e.message}`)
  //     return
  //   }
  // }

  // protected parse(
  //   source: string,
  //   { mode = undefined, last = false }: { mode?: 'blank'; last?: boolean } = {}
  // ) {
  //   const tokens = this.tokenize(source)

  //   if (tokens.length === 0) return

  //   for (let i = 0; i < tokens.length; i++) {
  //     this.parseToken(tokens[i])
  //   }

  //   if (this.settings.debug && !mode) {
  //     const flatCurves = this.curves.flat()

  //     if (
  //       !flatCurves.find(x => x[0] <= 1 && x[0] >= 0 && x[1] <= 1 && x[1] >= 0)
  //     ) {
  //       this.error('No points within [0,0] and [1,1]')
  //     }
  //   }

  //   if (last) {
  //     if (this.currentCurve.length > 0) {
  //       this.addCurve()
  //     }
  //   }
  // }

  constructor(additionalConstants: Parser['constants'] = {}) {
    for (let key of Object.keys(additionalConstants)) {
      if (this.reservedConstants.includes(key)) {
        throw new Error(`Reserved constant: ${key}`)
      }
      this.constants[key] = additionalConstants[key]
    }
  }
}
