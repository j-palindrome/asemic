import _, { clamp, isUndefined, last, sortBy } from 'lodash'
import { createNoise2D } from 'simplex-noise'
import { defaultSettings, splitString } from './settings'
import { AsemicPt, BasicPt } from './AsemicPt'
import { AsemicFont, DefaultFont } from './defaultFont'
import { defaultPreProcess, lerp } from './utils'
import { AsemicData, Transform } from './types'

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

const defaultOutput = () =>
  ({ osc: [], curves: [], errors: [], pauseAt: false, eval: [] } as {
    osc: { path: string; args: (string | number | [number, number])[] }[]
    errors: string[]
    pauseAt: string | false
    eval: string[]
  })

const defaultFonts = () =>
  ({ default: new DefaultFont() } as Record<string, AsemicFont>)

export class Parser {
  rawSource = ''
  debugged = new Map<string, { errors: string[] }>()
  curves: AsemicPt[][] = []
  settings = defaultSettings()
  static defaultSettings = defaultSettings()
  currentCurve: AsemicPt[] = []
  transform: Transform = defaultTransform()
  transforms: Transform[] = []
  totalLength = 0
  pausedAt: string[] = []
  pauseAt: string | false = false
  scenes: {
    start: number
    length: number
    source: string
    pause: false | number
    offset: number
  }[] = []
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
  constants: Record<string, (args: string[]) => string | void> = {
    N: () => this.progress.countNum.toString(),
    I: () => this.progress.index.toString(),
    T: () => this.progress.time.toFixed(5),
    H: () => {
      const height = this.preProcessing.height / this.preProcessing.width
      return height.toFixed(5)
    },
    Sc: () => this.progress.scrub.toFixed(5),
    S: () => this.progress.scrubTime.toFixed(5),
    P: () => this.progress.point.toString(),
    C: () => this.progress.curve.toString(),
    L: () => this.progress.letter.toString(),
    px: () => {
      const pixels = this.preProcessing.width
      return (1 / pixels).toFixed(5)
    },
    log: args => {
      const slice = Number(args[0] || '0')
      const text = this.debug(slice)
      if (text.length > 0) this.output.errors.push(text)
      else this.output.errors.push('[empty]')
    },
    print: () => {
      const text = `text:\n${this.live.text.join(
        '\n'
      )}\n\nkeys:${this.live.keys.join('\n')}\n\ntransform:\n${JSON.stringify(
        this.transform
      )}`
      this.output.errors.push(text)
    },
    keys: args => {
      this.parse(`"${this.live.keys[args[0] ? parseInt(args[0]) : 0] ?? ''}"`)
    },
    text: args => {
      this.parse(`"${this.live.text[args[0] ? parseInt(args[0]) : 0] ?? ''}"`)
    },
    within: args => {
      const point0 = this.parsePoint(args[0])
      const point1 = this.parsePoint(args[1])
      const rest = args.slice(2).join(' ')
      const withinStart = this.curves.length

      this.parse(rest)

      // Calculate bounds manually from all curve points
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity
      this.curves.slice(withinStart).forEach(curve => {
        curve.forEach(point => {
          minX = Math.min(minX, point.x)
          minY = Math.min(minY, point.y)
          maxX = Math.max(maxX, point.x)
          maxY = Math.max(maxY, point.y)
        })
      })

      // Calculate scaling factor based on aspect ratio
      const scaleX = (point1.x - point0.x) / (maxX - minX)
      const scaleY = (point1.y - point0.y) / (maxY - minY)
      const scale = Math.min(scaleX, scaleY)
      this.curves.slice(withinStart).forEach(curve => {
        curve.forEach(point =>
          point.add([-minX, -minY]).scale([scale, scale]).add(point0)
        )
      })
    },
    osc: args => {
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
    },
    tri: args => {
      const [start, end, h] = this.parseArgs(args)
      this.mapCurve(
        [new AsemicPt(this, 0.5, h * 2)],
        [new AsemicPt(this, 0, 0)],
        start,
        end
      )
    },
    squ: args => {
      const [start, end, h, w] = this.parseArgs(args)
      this.mapCurve(
        [new AsemicPt(this, 0, h), new AsemicPt(this, 1, h)],
        [new AsemicPt(this, -w, 0), new AsemicPt(this, w, 0)],
        start,
        end
      )
    },
    pen: args => {
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
        end
      )
    },
    hex: args => {
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
    },
    cir: args => {
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
        point.scale(this.transform.scale, [0, 0])
        point.add(center)
      })

      this.currentCurve.push(
        ...points.map((x, i) => {
          this.progress.point =
            i === points.length - 1 ? 0 : i / (points.length - 2)
          return x
        })
      )
    },
    repeat: args => {
      const count = args[0]
      const countNum = this.evalExpr(count)

      const prevIndex = this.progress.index
      const prevCountNum = this.progress.countNum
      this.progress.countNum = countNum
      for (let i = 0; i < countNum; i++) {
        this.progress.index = i
        for (let i = 1; i < args.length; i++) {
          // console.log('parsing level', i)
          this.parseToken(args[i])
        }
      }
      this.progress.index = prevIndex
      this.progress.countNum = prevCountNum
    },
    sin: ([x]) =>
      (Math.sin(this.evalExpr(x, false) * Math.PI * 2) * 0.5 + 0.5).toFixed(4),
    acc: ([x]) => {
      if (!this.progress.accums[this.progress.accumIndex])
        this.progress.accums.push(0)
      const value = this.evalExpr(x, false)
      // correct for 60fps
      this.progress.accums[this.progress.accumIndex] += value / 60
      const currentAccum = this.progress.accums[this.progress.accumIndex]
      this.progress.accumIndex++
      return currentAccum.toFixed(4)
    }
  }
  reservedConstants = Object.keys(this.constants)
  fonts: Record<string, AsemicFont> = defaultFonts()
  currentFont = 'default'
  lastPoint: AsemicPt = new AsemicPt(this, 0, 0)
  noiseTable: ((x: number, y: number) => number)[] = []
  noiseIndex = 0
  noise = createNoise2D()
  output = defaultOutput()
  preProcessing = defaultPreProcess()

  getDynamicValue(value: number | (() => number)) {
    return typeof value === 'function' ? value() : value
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
    this.resetTransform()
  }

  protected resetTransform() {
    for (let font of Object.keys(this.fonts)) this.fonts[font].reset()
    this.transform = defaultTransform()
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
          this.parse(this.scenes[i].source, { mode: 'blank' })
        }
        this.progress.progress =
          this.scenes[play.scene].start + this.scenes[play.scene].offset
        const fixedProgress = this.progress.progress.toFixed(5)
        this.pausedAt = this.pausedAt.filter(x => x <= fixedProgress)
        this.pauseAt = false
      }
    }
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

        this.parse(object.source, { last: true })

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
    return this.curves
      .concat([this.currentCurve])
      .slice(slice)
      .map(
        curve =>
          `[${curve.map(x => `${toFixed(x[0])},${toFixed(x[1])}`).join(' ')}]`
      )
      .join('\n')
  }

  setup(source: string) {
    for (let replacement of Object.keys(this.preProcessing.replacements)) {
      source = source.replace(
        replacement,
        this.preProcessing.replacements[replacement]
      )
    }
    this.fonts = defaultFonts()
    const parseSetting = (token: string) => {
      if (!token) return
      if (token.startsWith('!')) {
        this.settings[token.substring(1)] = false
      } else if (token.includes('=')) {
        const [key, value] = token.split('=')
        if (key === 'h' && (value === 'window' || value === 'auto')) {
          this.settings[key] = value
        } else {
          this.settings[key] = this.evalExpr(value)
        }
      } else {
        this.settings[token] = true
      }
    }

    this.settings = {} as Parser['settings']

    const [settings, ...sceneList] = source.split('\n---')

    const [firstLine, settingsSource] = splitString(settings, '\n')
    for (let token of firstLine.split(/\s+/g)) {
      parseSetting(token.trim())
    }
    if (settingsSource && settingsSource.trim().length > 0) {
      this.parse(settingsSource, { last: true })
    }

    const scenes: Parser['scenes'] = []
    this.totalLength = 0
    for (let scene of sceneList) {
      let [firstLine, drawScene] = splitString(scene, '\n')

      const newScene = { source: drawScene } as (typeof scenes)[number]
      const settings = {
        length: 0.1,
        offset: 0,
        pause: false as false | number
      }
      for (let token of firstLine.split(' ')) {
        const [key, value] = token.split('=')
        settings[key] = parseFloat(value)
      }
      newScene.start = this.totalLength - settings.offset
      newScene.pause = settings.length === 0 ? 0 : settings.pause
      if (settings.length) {
        newScene.length = settings.length
        this.totalLength += settings.length - settings.offset
      }
      newScene.offset = settings.offset ?? 0

      scenes.push(newScene)
    }

    this.scenes = scenes
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
    end: AsemicPt
  ) {
    this.addCurve()

    const angle = end.clone().subtract(start).angle0to1()
    const distance = end.clone().subtract(start).magnitude()

    const mappedCurve = [
      start,
      ...multiplyPoints.map((x, i) => {
        this.progress.point = (i + 1) / (multiplyPoints.length + 1)
        return x
          .clone()
          .scale([distance, 1])
          .add(addPoints[i])
          .rotate(angle)
          .add(start)
      }),
      end
    ]
    mappedCurve.forEach((x, i) => {
      this.applyTransform(x, { relative: false })
    })
    this.currentCurve.push(...mappedCurve)
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

  evalExpr(expr: string, replace = true): number {
    try {
      if (!expr) {
        throw new Error('undefined expression')
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
            this.evalExpr(expr.substring(start + 1, end)) +
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

      const functionCall = expr.match(/^[a-zA-Z0-9]+/)?.[0]
      if (functionCall && this.constants[functionCall]) {
        const exprEval = this.evalFunction(expr)
        if (exprEval) return this.evalExpr(exprEval, false)
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

        return lerp(
          points[Math.floor(index)]!,
          points[Math.floor(index) + 1]!,
          index % 1
        )
      }

      const operations = expr.match(/.+?([\_\+\-\*\/\%\^])(?!.*[\_\+\*\/\%\^])/)

      if (operations) {
        let operators: [number, number]
        switch (operations[1]) {
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
        }
      }

      const startOperators = expr.match(/^[\#\~]/)
      if (startOperators) {
        switch (startOperators[0]) {
          case '#':
            if (expr.length === 1) {
              return Math.random()
            }
            return this.hash(this.evalExpr(expr.substring(1), false))

          case '~':
            let sampleIndex = this.noiseIndex
            while (sampleIndex > this.noiseTable.length - 1) {
              this.noiseTable.push(createNoise2D())
            }

            const noise =
              this.noiseTable[this.noiseIndex](
                (expr.length === 1
                  ? 1
                  : this.evalExpr(expr.substring(1), false)) *
                  this.progress.time,
                this.noiseIndex
              ) *
                0.5 +
              0.5
            this.noiseIndex++

            return noise
        }
      }

      throw new Error(`Invalid expression`)
    } catch (e) {
      throw new Error(`Failed to parse ${expr}: ${e}`)
    }
  }

  protected evalPoint(
    point: string,
    {
      defaultValue = true,
      basic = false
    }: { defaultValue?: boolean | number; basic?: boolean } = {}
  ): AsemicPt {
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
    const parts = point.split(',')
    if (parts.length === 1) {
      if (defaultValue === false) throw new Error(`Incomplete point: ${point}`)
      return new AsemicPt(
        this,
        this.evalExpr(parts[0])!,
        defaultValue === true ? this.evalExpr(parts[0])! : defaultValue
      )
    }
    return new AsemicPt(this, ...parts.map(x => this.evalExpr(x)!))
  }

  protected applyTransform = (
    point: AsemicPt,
    { relative = false, randomize = true } = {}
  ): AsemicPt => {
    point.scale(this.transform.scale).rotate(this.transform.rotation)

    if (this.transform.rotate !== undefined && randomize) {
      point.rotate(this.evalExpr(this.transform.rotate))
    }
    if (this.transform.add !== undefined && randomize) {
      point.add(
        this.evalPoint(this.transform.add)
          .scale(this.transform.scale)
          .rotate(this.transform.rotation)
      )
    }
    point.add(relative ? this.lastPoint : this.transform.translation)
    return point
  }

  protected reverseTransform = (
    point: AsemicPt,
    { randomize = true } = {}
  ): AsemicPt => {
    point.subtract(this.transform.translation)
    if (this.transform.add !== undefined && randomize) {
      const addPoint = this.evalPoint(this.transform.add)
      addPoint.scale(this.transform.scale)
      point.subtract(addPoint)
    }
    if (this.transform.rotate !== undefined && randomize) {
      point.rotate(this.evalExpr(this.transform.rotate) * -1)
    }
    point.divide(this.transform.scale).rotate(this.transform.rotation * -1)
    return point
  }

  // Parse point from string notation
  protected parsePoint(
    notation: string,
    { save = true, randomize = true } = {}
  ): AsemicPt {
    let prevCurve = this.curves[this.curves.length - 1]

    notation = notation.trim()

    let point: AsemicPt
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

      point = this.applyTransform(new AsemicPt(this, radius, 0).rotate(theta), {
        relative: true,
        randomize
      })
    }

    // Relative coordinates: +x,y
    else if (notation.startsWith('+')) {
      point = this.applyTransform(this.evalPoint(notation.substring(1)), {
        relative: true,
        randomize
      })
    } else {
      // Absolute coordinates: x,y
      point = this.applyTransform(
        new AsemicPt(this, ...this.evalPoint(notation)),
        { relative: false, randomize }
      )
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

  protected parseTransform(token: string) {
    const transformStr = token.trim().substring(1, token.length - 1)
    const transforms = this.tokenize(transformStr)

    transforms.forEach(transform => {
      if (transform === '<') {
        Object.assign(this.transform, this.transforms.pop()!)
      } else if (transform === '>') {
        this.transforms.push(this.cloneTransform(this.transform))
      } else if (transform === '!') {
        // Reset all transformations
        this.transform.scale.set([1, 1])
        this.transform.rotation = 0
        this.transform.translation.set([0, 0])
        delete this.transform.add
        delete this.transform.rotate
      } else if (transform.startsWith('*<')) {
        this.transform.scale.set(last(this.transforms)?.scale ?? [1, 1])
      } else if (transform.startsWith('+<')) {
        this.transform.translation.set(
          last(this.transforms)?.translation ?? [0, 0]
        )
      } else if (transform.startsWith('@<')) {
        this.transform.rotation = last(this.transforms)?.rotation ?? 0
      } else if (transform.startsWith('*!')) {
        // Reset scale
        this.transform.scale.set([1, 1])
      } else if (transform.startsWith('@!')) {
        // Reset rotation
        this.transform.rotation = 0
      } else if (transform.startsWith('+!')) {
        // Reset translation
        this.transform.translation.set([0, 0])
      } else if (transform.startsWith('+=>')) {
        this.transform.add = transform.substring(3)
      } else if (transform.startsWith('@=>')) {
        this.transform.rotate = transform.substring(3)
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
          this.transform.scale.scale(this.evalPoint(match[2]))
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
          this.transform.rotation += this.evalExpr(match[2])!
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
          this.transform.translation.add(
            this.evalPoint(match[2])
              .scale(this.transform.scale)
              .rotate(this.transform.rotation)
          )
        }
      } else {
        const keyCall = transform.match(/(\w+)\=(.+)/)
        if (keyCall) {
          const key = keyCall[1]
          const value = keyCall[2]
          switch (key) {
            case 'width':
            case 'w':
            case 'wid':
              this.transform.width = value
              break
            default:
              if (value.includes(',')) {
                this.transform[key] = this.evalPoint(value, { basic: true })
              } else {
                this.transform[key] = value
              }
              break
          }
        }
      }
    })
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

    const parsedString = source.replace(/\/\/(?:.|\n)*?\/\//g, '')
    for (let i = 0; i < parsedString.length; i++) {
      const char = parsedString[i]

      if (char === '"' && parsedString[i - 1] !== '\\') quote = !quote
      else if (char === '`' && parsedString[i - 1] !== '\\') {
        evaling = !evaling
      } else if (char === '{' && parsedString[i + 1] === '{')
        fontDefinition = true
      else if (char === '}' && parsedString[i - 1] === '}')
        fontDefinition = false
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

  protected evalFunction(token: string) {
    const functionCall = token.includes(' ')
      ? token.match(/^([a-zA-Z0-9]+)\s(.*)/)
      : ['', token, '']

    if (functionCall) {
      const functionName = functionCall[1]
      const argsStr = functionCall[2]

      // Parse function arguments
      if (!this.constants[functionName]) {
        return
        throw new Error(`Unknown function: ${functionName}`)
      }

      const args = this.tokenize(argsStr)

      let funcText = this.constants[functionName](args)

      if (typeof funcText === 'string') {
        for (let i = 0; i < args.length; i++) {
          funcText = funcText.replace(
            new RegExp(`\\$${i + 1}`, 'g'),
            `(${args[i]})`
          )
        }
        return funcText
      }
    } else {
      throw new Error(`Failed to match function name`)
    }
  }

  protected addCurve({ mode = 'normal' }: { mode?: string } = {}) {
    if (mode === 'blank' || this.currentCurve.length === 0) return
    if (this.currentCurve.length === 2) {
      this.progress.point = 0.5
      const p1 = this.currentCurve[0]
      const p2 = this.currentCurve[1]
      const interpolated = p1.clone().lerp(p2, 0.5)
      this.currentCurve.splice(1, 0, interpolated)
    }
    this.curves.push(this.currentCurve)
    this.currentCurve = []
    this.progress.point = 0
  }

  protected parseToken(token: string, { mode }: { mode?: 'blank' } = {}) {
    try {
      token = token.trim()
      let adding = false
      let hasParentheses = false

      if (token.startsWith('+')) {
        token = token.substring(1)
        adding = true
      }

      while (token.startsWith('(') && token.endsWith(')')) {
        hasParentheses = true
        token = token.substring(1, token.length - 1).trim()
      }

      if (token.includes('|')) {
        const [ifFalse, condition, ifTrue] = token.split('|')
        const evalCondition = this.evalExpr(condition)
        if (evalCondition > 0) {
          this.parse(ifTrue)
        } else {
          this.parse(ifFalse)
        }
        return
      }

      const constMatch = token.match(/^([a-zA-Z0-9]+)(\=\>?)(.+)/)

      if (constMatch) {
        const [_, key, type, value] = constMatch
        if (this.reservedConstants.includes(key)) {
          throw new Error(`Reserved constant: ${key}`)
        }

        if (type === '=>') {
          this.constants[key] = () => value
        } else {
          const evaled = this.evalExpr(value).toFixed(4)

          this.constants[key] = () => evaled
        }

        return
      }

      const functionCall = token.match(/^([a-zA-Z0-9]+)(?!\=)/)
      if (functionCall && this.constants[functionCall[1]]) {
        const returnText = this.evalFunction(token)
        if (returnText) {
          this.parse(returnText, { mode })
        }
        return
      }

      if (token.startsWith('{{') && token.endsWith('}}')) {
        const parseFontSettings = () => {
          token = token.substring(2, token.length - 2).trim()

          const fontName = token.match(/^([a-zA-Z0-9]+)/)
          if (fontName) {
            this.currentFont = fontName[1]
            token = token.replace(fontName[0], '')
          }
          if (!this.fonts[this.currentFont]) {
            this.fonts[this.currentFont] = new AsemicFont(token)
          } else {
            if (token === '!') {
              this.fonts[this.currentFont].reset()
            } else {
              this.fonts[this.currentFont].parseCharacters(token)
            }
          }
        }
        parseFontSettings()
        return
      } else if (token.startsWith('{') && token.endsWith('}')) {
        this.parseTransform(token)
        return
      } else if (token.startsWith('`')) {
        token = token.substring(1, token.length - 1)
        if (token.startsWith('client')) {
          const clientFunction = token.substring(6)
          this.output.eval.push(clientFunction)
        } else {
          const result = eval(`({ _ }) => {
              ${token}
            }`)({ _ })
          if (typeof result === 'string') {
            this.parse(result)
          }
        }

        return
      } else if (token.startsWith('"')) {
        const formatSpace = (insert?: string) => {
          if (insert) return ` ${insert} `
          return ' '
        }
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
                newString +=
                  substring[Math.floor(this.hash(1) * substring.length)]
              }
              return newString
            } else {
              this.progress.seed++
              return substring[Math.floor(this.hash(1) * substring.length)]
            }
          }
        )

        const chars = [
          !adding ? formatSpace(font.characters['\\^']) : undefined,
          token
            .split('')
            .map(x =>
              x === '\n'
                ? [
                    font.dynamicCharacters['\n'] ? '{<}' : undefined,
                    font.characters['\n'],
                    font.dynamicCharacters['\n']
                      ? '{>} ' + font.dynamicCharacters['\n']
                      : undefined
                  ]
                : [
                    font.dynamicCharacters['\\.']
                      ? '{>} ' + font.dynamicCharacters['\\.']
                      : undefined,
                    font.characters[x],
                    font.dynamicCharacters['\\.'] ? '{<}' : undefined,
                    formatSpace(font.characters['\\.'])
                  ]
            ),
          formatSpace(font.characters['\\$'])
        ]
          .flat(2)
          .filter(Boolean) as string[]

        for (let i = 0; i < chars.length; i++) {
          this.progress.letter = i / (chars.length - 1)
          this.parse(chars[i])
        }
        return
      }

      if (token.startsWith('[')) {
        if (!adding && this.currentCurve.length > 0) {
          this.addCurve({ mode })
        }
        const pointsStr = token.substring(1, token.length - 1)
        const pointsTokens = this.tokenize(pointsStr)

        pointsTokens.forEach((pointToken, i) => {
          if (pointToken.startsWith('{')) {
            this.parseTransform(token)
            return
          }
          if (pointToken.trim().length == 0) return
          this.progress.point = i / (pointsTokens.length - 1)
          const point = this.parsePoint(pointToken)

          this.currentCurve.push(point)
        })
        return
      }
    } catch (e) {
      this.output.errors.push(`Parsing failed: ${token}; ${e}`)
      console.error(`Parsing failed`, token, e)
      return
    }
  }

  protected parse(
    source: string,
    { mode = undefined, last = false }: { mode?: 'blank'; last?: boolean } = {}
  ) {
    const tokens = this.tokenize(source)

    if (tokens.length === 0) return

    for (let i = 0; i < tokens.length; i++) {
      this.parseToken(tokens[i])
    }

    if (this.settings.debug && !mode) {
      const flatCurves = this.curves.flat()

      if (
        !flatCurves.find(x => x[0] <= 1 && x[0] >= 0 && x[1] <= 1 && x[1] >= 0)
      ) {
        this.output.errors.push('No points within [0,0] and [1,1]')
      }
    }

    if (last) {
      if (this.currentCurve.length > 0) {
        this.addCurve()
      }
    }
  }

  constructor() {}
}
