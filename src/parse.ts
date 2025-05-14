import _, { clamp, isUndefined, last, sortBy } from 'lodash'
import { Group, Pt } from 'pts'
import { createNoise2D } from 'simplex-noise'
import { defaultSettings, splitString } from './settings'
import { AsemicGroup, AsemicPt } from './AsemicPt'
import { AsemicFont, DefaultFont } from './defaultFont'
import { defaultPreProcess, lerp, splitArgs } from './utils'
import { AsemicData, Transform } from './types'

const TransformAliases = {
  scale: ['\\*', 'sca', 'scale'],
  rotation: ['\\@', 'rot', 'rotate'],
  translation: ['\\+', 'tra', 'translate'],
  width: ['w', 'wid', 'width']
}

const defaultTransform = () => ({
  translation: new Pt([0, 0]),
  scale: new Pt([1, 1]),
  width: 1,
  rotation: 0,
  length: undefined
})

const defaultOutput = () =>
  ({ osc: [], curves: [], errors: [], pauseAt: false, eval: [] } as {
    curves: any[]
    osc: { path: string; args: (string | number | [number, number])[] }[]
    errors: string[]
    pauseAt: string | false
    eval: string[]
  })

export class Parser {
  rawSource = ''
  debugged = new Map<string, { errors: string[] }>()
  curves: AsemicGroup[] = []
  settings = defaultSettings()
  currentCurve: AsemicGroup = new AsemicGroup()
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
    height: 0,
    width: 0,
    seed: 1,
    index: 0,
    countNum: 0,
    accums: [] as number[],
    accumIndex: 0,
    letter: 0,
    isAdding: false,
    scrub: 0,
    scrubTime: 0,
    progress: 0
  }
  live = {
    keys: [''],
    text: ['']
  }
  constants = {
    N: () => this.progress.countNum.toString(),
    I: () => this.progress.index.toString(),
    T: () => this.progress.time.toFixed(3),
    H: () => {
      const height = this.progress.height / this.progress.width
      return '*' + height.toFixed(4)
    },
    Sc: () => this.progress.scrub.toFixed(4),
    S: () => this.progress.scrubTime.toFixed(3),
    P: () => this.progress.point.toString(),
    C: () => this.progress.curve.toString(),
    L: () => this.progress.letter.toString(),
    px: () => {
      const pixels = this.progress.width
      return '*' + (1 / pixels).toFixed(5)
    }
  }
  reservedConstants = Object.keys(this.constants)
  fonts: Record<string, AsemicFont> = { default: new DefaultFont() }
  currentFont = 'default'
  lastPoint: AsemicPt = new AsemicPt(this, 0, 0)
  noiseTable: ((x: number, y: number) => number)[] = []
  noiseIndex = 0
  noise = createNoise2D()
  output = defaultOutput()
  preProcessing = defaultPreProcess()
  protected functions: Record<string, (args: string) => void> = {
    log: args => {
      const slice = Number(args[0] || '0')
      const text = this.log(slice)
      this.output.errors.push(text)
    },
    '#': args => {
      this.progress.seed = args ? this.evalExpr(args) : 1
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
      this.parse(`"${this.live.keys[args ? parseInt(args) : 0] ?? ''}"`, {
        silent: true
      })
    },
    within: argsStr => {
      const args = splitArgs(argsStr)
      const point0 = this.parsePoint(args[0])
      const point1 = this.parsePoint(args[1])
      const rest = argsStr.substring(args[0].length + args[1].length + 2)
      const withinStart = this.curves.length

      this.parse(rest, { silent: true })

      const bounds = new AsemicGroup(
        ...(this.curves.slice(withinStart).flat() as AsemicPt[])
      ).boundingBox()

      // Calculate scaling factor based on aspect ratio
      const scaleX = (point1.x - point0.x) / (bounds[1].x - bounds[0].x)
      const scaleY = (point1.y - point0.y) / (bounds[1].y - bounds[0].y)
      const scale = Math.min(scaleX, scaleY)
      // Calculate center offset to properly position the curves
      const sourceBoundsCenter = bounds[0].$add(bounds[1]).divide(2)
      const targetBoundsCenter = point0.$add(point1).divide(2)
      const centerDifference = targetBoundsCenter.$subtract(
        sourceBoundsCenter.scale(scale, point0)
      )
      this.curves.slice(withinStart).forEach(curve => {
        curve.subtract(bounds[0]).scale(scale, [0, 0]).add(point0)
        // .add(centerDifference)
      })
    },
    osc: argsStr => {
      const args = splitArgs(argsStr)
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
    '3': argsStr => {
      const args = splitArgs(argsStr)
      const [start, end, h] = this.parseArgs(args)
      this.mapCurve(
        Group.fromArray([[0.5, h * 2]]),
        Group.fromArray([[0, 0]]),
        start,
        end
      )
    },
    '4': argsStr => {
      const args = splitArgs(argsStr)
      const [start, end, h, w] = this.parseArgs(args)
      this.mapCurve(
        Group.fromArray([
          [0, h],
          [1, h]
        ]),
        Group.fromArray([
          [-w, 0],
          [w, 0]
        ]),
        start,
        end
      )
    },
    '5': argsStr => {
      const args = splitArgs(argsStr)
      const [start, end, h, w] = this.parseArgs(args)
      this.mapCurve(
        Group.fromArray([
          [0, h * 0.5],
          [0.5, h * 1.1],
          [1, h * 0.5]
        ]),
        Group.fromArray([
          [-w * 2, 0],
          [0, 0],
          [w * 2, 0]
        ]),
        start,
        end
      )
    },
    '6': argsStr => {
      const args = splitArgs(argsStr)
      const [start, end, h, w] = this.parseArgs(args)
      this.mapCurve(
        Group.fromArray([
          [0, 0],
          [0, h],
          [1, h],
          [1, 0]
        ]),
        Group.fromArray([
          [-w, 0],
          [-w, 0],
          [w, 0],
          [w, 0]
        ]),
        start,
        end
      )
    },
    circle: argsStr => {
      const args = splitArgs(argsStr)
      const center = this.parsePoint(args[0])
      const [w, h] = this.evalPoint(args[1])
      const points = Group.fromArray([
        [w, 0],
        [w, h],
        [-w, h],
        [-w, -h],
        [w, -h],
        [w, 0]
      ])
        .scale(this.transform.scale, [0, 0])
        .rotate2D(this.transform.rotation * Math.PI * 2, [0, 0])
        .add(center)
      this.currentCurve.push(
        ...points.map((x, i) => {
          this.progress.point =
            i === points.length - 1 ? 0 : i / (points.length - 2)
          return new AsemicPt(this, x)
        })
      )
    },
    repeat: argsStr => {
      const [count, content] = splitString(argsStr, ' ')
      const countNum = this.evalExpr(count)

      const prevIndex = this.progress.index
      const prevCountNum = this.progress.countNum
      this.progress.countNum = prevCountNum
      for (let i = 0; i < countNum; i++) {
        this.progress.index = i
        this.parse(content, { silent: true })
      }
      this.progress.index = prevIndex
      this.progress.countNum = prevCountNum
    }
  }

  getDynamicValue(value: number | (() => number)) {
    return typeof value === 'function' ? value() : value
  }

  protected reset() {
    this.curves = []
    this.progress.time = performance.now() / 1000
    this.progress.progress += this.pauseAt !== false ? 0 : 1 / 60
    if (this.progress.progress > this.totalLength) {
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
    this.currentCurve = new AsemicGroup()
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
        this.preProcess(this.rawSource)
        for (let i = 0; i < play.scene; i++) {
          // parse each scene until now to get OSC messages
          this.parse(this.scenes[i].source, { mode: 'blank', silent: true })
          console.log('output:', this.output.osc)
        }
        this.progress.progress =
          this.scenes[play.scene].start + this.scenes[play.scene].offset
        const fixedProgress = this.progress.progress.toFixed(2)
        this.pausedAt = this.pausedAt.filter(x => x <= fixedProgress)
        this.pauseAt = false
      }
    }
  }

  frame() {
    this.reset()

    for (let object of this.scenes) {
      if (
        this.progress.progress > object.start &&
        this.progress.progress < object.start + object.length
      ) {
        this.resetTransform()
        this.progress.scrub =
          (this.progress.progress - object.start) / object.length
        this.progress.scrubTime = this.progress.progress - object.start

        this.parse(object.source)
        if (
          this.pauseAt === false &&
          object.pause !== false &&
          this.progress.progress >= object.start + (object.pause - 0.02)
        ) {
          const pause = (object.start + object.pause).toFixed(2)
          if (!this.pausedAt.includes(pause)) {
            this.pauseAt = pause
            break
          }
        }
      }
    }

    this.format()
  }

  protected log(slice: number = 0) {
    const toFixed = (x: number) => {
      const str = x.toFixed(2)
      if (str.endsWith('00')) {
        return String(Math.floor(x))
      } else {
        return str
      }
    }
    return this.curves
      .slice(slice)
      .map(
        curve =>
          `[${curve.map(x => `${toFixed(x[0])},${toFixed(x[1])}`).join(' ')}]`
      )
      .join('\n')
  }

  protected format() {
    const w = this.progress.width
    let newCurves: [number, number][][] = []
    for (let curve of this.curves) {
      // fake it with a gradient
      const newCurve: [number, number][] = []
      let index = 0
      const push = ([x, y]: [number, number]) => {
        // newCurve.set([x, y], index)
        newCurve.push([x, y])
        index += 2
      }
      const preTangent = curve
        .at(0)
        .$subtract(curve.at(1))
        .unit()
        .scale(curve.at(0).width / 2 / w)
      curve.at(0).add(preTangent)
      const postTangent = curve
        .at(curve.length - 1)
        .$subtract(curve.at(curve.length - 2))
        .unit()
        .scale(curve.at(curve.length - 1).width / 2 / w)
      curve.at(curve.length - 1).add(postTangent)

      if (curve.length == 1) {
      } else if (curve.length == 2) {
        const normal = curve
          .at(1)
          .$subtract(curve[0])
          .rotate2D(0.25 * Math.PI * 2)
          .unit()
          .scale(curve.at(1).width / 2 / w)

        const p0 = curve.at(0).clone()
        p0.add(normal)

        push([p0.x, p0.y])

        const p1 = curve.at(1).clone()
        p1.add(normal)
        push([p1.x, p1.y])
        p1.subtract(normal.clone().scale(2))
        push([p1.x, p1.y])
        p0.subtract(normal.clone().scale(2))
        push([p0.x, p0.y])
      } else {
        const p0 = curve.at(0).clone()
        const n0 = curve
          .at(1)
          .$subtract(curve.at(0))
          .rotate2D(0.25 * Math.PI * 2)
          .unit()
          .scale(curve.at(0).width / 2 / w)
        p0.add(n0)
        push([p0.x, p0.y])
        // push([...curve.at(0).clone()])

        const drawCurve = (curve: AsemicGroup, i: number) => {
          const p2 =
            i === curve.length - 3
              ? curve.at(i + 2).clone()
              : curve
                  .at(i + 1)
                  .$add(curve.at(i + 2))
                  .divide(2)
          const n2 = curve
            .at(i + 2)
            .$subtract(curve.at(i + 1))
            .rotate2D(0.25 * Math.PI * 2)
            .unit()
            .scale(
              (i === curve.length - 3
                ? curve.at(i + 2).width
                : (curve.at(i + 1).width + curve.at(i + 2).width) / 2) /
                2 /
                w
            )
          p2.add(n2)
          const p1 = curve.at(i + 1).clone()
          const n1 = curve
            .at(i + 2)
            .$subtract(curve.at(i))
            .rotate2D(0.25 * Math.PI * 2)
            .unit()
            .scale(curve.at(i + 1).width / 2 / w)
          p1.add(n1)

          // The curve is given in [x,y] points with quadratic curves drawn between them. For each pair [p1 p2], the first control point is p1, and the second control point is (p1 + p2) / 2.
          // Given a thickness t, find the 2 edges of the curve from the second control point.
          push([p1.x, p1.y])
          push([p2.x, p2.y])
        }
        for (let i = 0; i <= curve.length - 3; i++) {
          drawCurve(curve, i)
        }
        const reversedCurve = new AsemicGroup(...curve.reverse())
        const pEnd = reversedCurve.at(0).clone()
        const nEnd = reversedCurve
          .at(1)
          .$subtract(reversedCurve.at(0))
          .rotate2D(0.25 * Math.PI * 2)
          .unit()
          .scale(reversedCurve.at(0).width / 2 / w)
        pEnd.add(nEnd)
        push([pEnd.x, pEnd.y])
        for (let i = 0; i <= curve.length - 3; i++) {
          drawCurve(reversedCurve, i)
        }
      }
      newCurves.push(newCurve)
    }

    this.output.curves = newCurves
  }

  preProcess(source: string) {
    for (let replacement of Object.keys(this.preProcessing.replacements)) {
      source = source.replace(
        replacement,
        this.preProcessing.replacements[replacement]
      )
    }
    const parseSetting = (token: string) => {
      if (!token) return
      if (token.startsWith('!')) {
        this.settings[token.substring(1)] = false
      } else if (token.includes(':')) {
        const [key, value] = token.split(':')
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

    for (let token of settings.trim().split(/\s+/g)) {
      parseSetting(token.trim())
    }

    const scenes: Parser['scenes'] = []
    for (let scene of sceneList) {
      let [firstLine, drawScene] = splitString(scene, '\n')

      const newScene = { source: drawScene } as (typeof scenes)[number]
      const settings = {
        length: 0.1,
        offset: 0,
        pause: false as false | number
      }
      for (let token of firstLine.split(' ')) {
        const [key, value] = token.split(':')
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
    multiplyPoints: Group,
    addPoints: Group,
    start: AsemicPt,
    end: AsemicPt
  ) {
    let usedEnd =
      end[0] === start[0] && end[1] === start[1] ? start.$add(1, 0) : end

    const angle = usedEnd.$subtract(start).angle()
    const distance = usedEnd.$subtract(start).magnitude()

    // instead of the curve by default being UP, it's whatever the rotation is and THEN up
    // Check the angle to determine if we need to flip the points vertically
    // let fixedAngle =
    //   (angle - this.transform.rotation * Math.PI * 2) % (Math.PI * 2)
    // // Round fixedAngle to the nearest 1/360 increment
    // const backwards =
    //   (this.transform.scale.x < 0 && this.transform.scale.y > 0) ||
    //   (this.transform.scale.y < 0 && this.transform.scale.x >= 0)
    // fixedAngle =
    //   (backwards ? Math.ceil(fixedAngle * 360) : Math.floor(fixedAngle * 360)) /
    //   360
    // if (fixedAngle < 0) fixedAngle += Math.PI * 2
    // let needsFlip = backwards
    //   ? fixedAngle >= Math.PI / 2 && fixedAngle < (3 * Math.PI) / 2
    //   : fixedAngle > Math.PI / 2 && fixedAngle <= (3 * Math.PI) / 2
    // if (this.transform.scale.y < 0) needsFlip = !needsFlip
    // const fixedMultiplyPoints = needsFlip
    //   ? multiplyPoints.map(pt => pt.$multiply([1, -1]))
    //   : multiplyPoints
    // const fixedAddPoints = needsFlip
    //   ? addPoints.map(pt => pt.$multiply([1, -1]))
    //   : addPoints

    // if (this.progress.isAdding) {
    //   const mappedCurve = [
    //     // start,
    //     ...multiplyPoints.map((x, i) => {
    //       x.scale([distance, 1], [0, 0])
    //         .add(addPoints[i])
    //         .rotate2D(angle, [0, 0])
    //         .add(start)
    //       this.progress.point = (i + 1) / (multiplyPoints.length + 1)
    //       return new AsemicPt(this, x)
    //     }),
    //     end
    //   ]
    //   mappedCurve.forEach((x, i) => {
    //     this.applyTransform(x)
    //   })
    //   this.currentCurve.push(...mappedCurve)
    // } else {
    const mappedCurve = [
      start,
      ...multiplyPoints.map((x, i) => {
        x.scale([distance, 1], [0, 0])
          .add(addPoints[i])
          .rotate2D(angle, [0, 0])
          .add(start)
        this.progress.point = (i + 1) / (multiplyPoints.length + 1)
        return new AsemicPt(this, x)
      }),
      end
    ]
    mappedCurve.forEach((x, i) => {
      this.applyTransform(x)
    })
    this.currentCurve.push(...mappedCurve)
    // }
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

  protected evalExpr(expr: string, replace = true): number {
    try {
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
        for (let key of sortBy(
          Object.keys(this.constants),
          x => x.length * -1
        )) {
          if (!expr.includes(key)) continue
          const regex = new RegExp(key, 'g')
          expr = expr.replace(regex, () => this.constants[key]())
        }
      }

      const functions: Record<string, (x: string) => number> = {
        sin: x => Math.sin(this.evalExpr(x, false) * Math.PI * 2) * 0.5 + 0.5,
        acc: x => {
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

        let stringStart = expr.substring(0, start)
        for (let key of Object.keys(functions)) {
          if (stringStart.endsWith(key)) {
            return this.evalExpr(
              stringStart.slice(0, stringStart.length - key.length) +
                functions[key](expr.substring(start + 1, end)).toString() +
                expr.substring(end + 1)
            )
          }
        }

        return this.evalExpr(
          stringStart +
            this.evalExpr(expr.substring(start + 1, end), false) +
            expr.substring(end + 1)
        )
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
            const afterNum = this.evalExpr(after)
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
            return this.hash(this.evalExpr(expr.substring(1)))

          case '~':
            let sampleIndex = this.noiseIndex
            while (sampleIndex > this.noiseTable.length - 1) {
              this.noiseTable.push(createNoise2D())
            }

            const noise =
              this.noiseTable[this.noiseIndex](
                (expr.length === 1 ? 1 : this.evalExpr(expr.substring(1))) *
                  this.progress.time,
                0
              ) *
                0.5 +
              0.5
            this.noiseIndex++

            return noise
        }
      }

      return parseFloat(expr)
    } catch (e) {
      throw new Error(`Failed to parse ${expr}: ${e}`)
    }
  }

  protected evalPoint(
    point: string,
    { defaultValue = true }: { defaultValue?: boolean | number } = {}
  ): Pt {
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
      const points = [firstPoint, ...nextPoints] as Pt[]
      let index = (points.length - 1) * fadeNm
      if (index === points.length - 1) index -= 0.0001

      return points[Math.floor(index)].add(
        points[Math.floor(index) + 1]!.$subtract(
          points[Math.floor(index)]
        ).scale(index % 1)
      )
    }
    const parts = point.split(',')
    if (parts.length === 1) {
      if (defaultValue === false) throw new Error(`Incomplete point: ${point}`)
      return new Pt([
        this.evalExpr(parts[0])!,
        defaultValue === true ? this.evalExpr(parts[0])! : defaultValue
      ])
    }
    return new AsemicPt(
      this,
      this.evalExpr(parts[0])!,
      this.evalExpr(parts[1])!
    )
  }

  protected applyTransform = (
    point: AsemicPt,
    { relative = false, randomize = true } = {}
  ): AsemicPt => {
    point
      .scale(this.transform.scale, !relative ? [0, 0] : this.lastPoint)
      .rotate2D(
        this.transform.rotation * Math.PI * 2,
        !relative ? [0, 0] : this.lastPoint
      )

    if (this.transform.rotate !== undefined && randomize) {
      point.rotate2D(
        this.evalExpr(this.transform.rotate) * Math.PI * 2,
        !relative ? [0, 0] : this.lastPoint
      )
    }
    if (this.transform.add !== undefined && randomize) {
      point.add(
        this.evalPoint(this.transform.add)
          .scale(this.transform.scale, [0, 0])
          .rotate2D(this.transform.rotation * Math.PI * 2, [0, 0])
      )
    }
    if (!relative) point.add(this.transform.translation)
    return point
  }

  protected reverseTransform = (
    point: AsemicPt,
    { randomize = true } = {}
  ): AsemicPt => {
    point.subtract(this.transform.translation)
    if (this.transform.add !== undefined && randomize) {
      point.subtract(
        this.evalPoint(this.transform.add)
          .scale(this.transform.scale, [0, 0])
          .rotate2D(this.transform.rotation * Math.PI * 2, [0, 0])
      )
    }
    if (this.transform.rotate !== undefined && randomize) {
      point.rotate2D(
        -this.evalExpr(this.transform.rotate) * Math.PI * 2,
        [0, 0]
      )
    }
    point
      .rotate2D(-this.transform.rotation * Math.PI * 2, [0, 0])
      .scale(new Pt(1, 1).divide(this.transform.scale), [0, 0])
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
      const thetaRad = theta * Math.PI * 2 // Convert 0-1 to radians

      point = this.applyTransform(
        this.lastPoint.$add(radius, 0).rotate2D(thetaRad, this.lastPoint),
        { relative: true, randomize }
      )
    }

    // Relative coordinates: +x,y
    else if (notation.startsWith('+')) {
      point = this.applyTransform(
        this.lastPoint.$add(this.evalPoint(notation.substring(1))),
        { relative: true, randomize }
      )
    } else {
      // Absolute coordinates: x,y
      point = this.applyTransform(
        new AsemicPt(this, this.evalPoint(notation)),
        { relative: false, randomize }
      )
    }
    if (save) this.lastPoint = point
    return point
  }

  protected cloneTransform(transform: Transform): Transform {
    const newTransform = {} as Transform
    for (let key of Object.keys(transform)) {
      if (transform[key] instanceof Pt) {
        newTransform[key] = transform[key].clone()
      } else {
        newTransform[key] = transform[key]
      }
    }
    return newTransform
  }

  protected parseTransform(token: string) {
    // { ...transforms }
    const transformStr = token.trim().substring(1, token.length - 1)
    const transforms = transformStr.split(' ')

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
          this.transform.scale.multiply(this.evalPoint(match[2]))
        }
      } else if (
        transform.match(
          new RegExp(`^(${TransformAliases.rotation.join('|')})(.+)`)
        )
      ) {
        // Rotation
        const match = transform.match(
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
              .rotate2D(this.transform.rotation * Math.PI * 2)
          )
        }
      } else {
        const keyCall = transform.match(/(\w+)(\:|\=>)(.+)/)
        if (keyCall) {
          const key = keyCall[1]
          const equation = keyCall[2]
          const value = keyCall[3]
          switch (key) {
            case 'width':
            case 'w':
            case 'wid':
              this.transform.width =
                equation === ':'
                  ? this.evalExpr(value)
                  : () => {
                      return this.evalExpr(value)
                    }
              break
            default:
              if (value.includes(',')) {
                const list = value.split(',')
                if (list.length > 2) {
                  this.transform[key] = new AsemicPt(
                    this,
                    value.split(',').map(x => this.evalExpr(x)!)
                  )
                } else {
                  this.transform[key] = this.evalPoint(value)
                }
              } else {
                this.transform[key] = this.evalExpr(value)
              }
              break
          }
        }
      }
    })
  }

  parse(
    source: string,
    {
      mode = undefined,
      silent = false
    }: { mode?: 'blank'; silent?: boolean } = {}
  ) {
    const addCurve = () => {
      if (mode === 'blank') return
      if (this.currentCurve.length === 2) {
        this.progress.point = 0.5
        this.currentCurve.splice(1, 0, this.currentCurve.interpolate(0.5))
      }
      this.curves.push(this.currentCurve)
      this.currentCurve = new AsemicGroup()
      this.progress.point = 0
    }

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

    for (let i = 0; i < tokens.length; i++) {
      try {
        let token = tokens[i].trim()
        this.progress.isAdding = false
        if (token.startsWith('+')) {
          token = token.substring(1)
          this.progress.isAdding = true
        } else {
          if (this.currentCurve.length > 0) {
            addCurve()
          }
        }

        if (token.includes('|')) {
          const [ifFalse, condition, ifTrue] = token.split('|')
          const evalCondition = this.evalExpr(condition)
          if (evalCondition > 0) {
            this.parse(ifTrue)
          } else {
            this.parse(ifFalse)
          }
          continue
        }

        if (token.startsWith('{{') && token.endsWith('}}')) {
          const parseFontSettings = () => {
            token = token.substring(2, token.length - 2).trim()

            const fontName = token.match(/^([a-zA-Z0-9]+)\s/)
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
          continue
        }
        if (token.startsWith('((')) {
          const functionName = token.substring(2, token.indexOf(' '))
          const text = token.substring(token.indexOf(' ') + 1, token.length - 2)
          this.functions[functionName] = (args: string) => {
            const parseArgs = splitArgs(args)
            let newText = text
            for (let i = 0; i < parseArgs.length; i++) {
              newText = newText.replace(
                new RegExp(`\\$${i + 1}`, 'g'),
                parseArgs[i]
              )
            }

            this.parse(newText, { silent: true })
          }
          continue
        } else if (token.startsWith('{') && token.endsWith('}')) {
          this.parseTransform(token)
          continue
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
              this.parse(result, { silent: true })
            }
          }

          continue
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
            !this.progress.isAdding
              ? formatSpace(font.characters['\\^'])
              : undefined,
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
            this.parse(chars[i], { silent: true })
          }
          continue
        }

        const constMatch = token.match(/([\w]+?)\=(.*)/)
        if (constMatch) {
          const [_, key, value] = constMatch
          if (this.reservedConstants.includes(key)) {
            throw new Error(`Reserved constant: ${key}`)
          }
          const variable = this.evalExpr(value).toFixed(3)
          this.constants[key] = () => variable
          continue
        }

        if (token.startsWith('[')) {
          const pointsStr = token.substring(1, token.length - 1)
          const pointsTokens = pointsStr.split(' ')

          pointsTokens.forEach((pointToken, i) => {
            if (pointToken.startsWith('{')) {
              this.parseTransform(token)
              return
            }
            if (!pointToken.trim()) return
            this.progress.point = i / (pointsTokens.length - 1)
            const point = this.parsePoint(pointToken)
            this.currentCurve.push(point)
          })
          continue
        } else {
          // Parse function call
          const functionCall = token.trim().match(/^([^\(]+)\(((?:.|\n)*?)\)$/)

          if (functionCall) {
            const functionName = functionCall[1]
            const argsStr = functionCall[2]

            // Parse function arguments
            if (!this.functions[functionName])
              throw new Error(
                `unknown function: ${functionName} with args ${argsStr}`
              )
            this.functions[functionName](argsStr)
            continue
          }
        }
      } catch (e) {
        this.output.errors.push(`Parsing failed: ${tokens[i]}; ${e}`)
        continue
      }
    }

    if (this.currentCurve.length > 0) {
      addCurve()
    }

    // error detection
    if (this.settings.debug && !mode) {
      const flatCurves = this.curves.flat()

      if (
        !flatCurves.find(x => x[0] <= 1 && x[0] >= 0 && x[1] <= 1 && x[1] >= 0)
      ) {
        this.output.errors.push('No points within [0,0] and [1,1]')
      }
    }
  }

  constructor() {}
}
