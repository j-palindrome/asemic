import { AsemicPt } from '../../blocks/AsemicPt'
import { Parser } from '../Parser'

export class DrawingMethods {
  parser: Parser

  constructor(parser: any) {
    this.parser = parser
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

    const previousLength = this.parser.adding
    this.parser.adding += multiplyPoints.length + 2
    multiplyPoints = multiplyPoints.map((x, i) => {
      this.parser.progress.point = (previousLength + 1 + i) / this.parser.adding
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
      this.parser.applyTransform(x, { relative: false })
    })
    this.parser.currentCurve.push(
      ...(add ? mappedCurve.slice(0, -1) : mappedCurve)
    )

    if (!add) {
      this.parser.end()
    }
  }

  tri(argsStr: string, { add = false } = {}) {
    const args = this.parser.tokenize(argsStr)
    const [start, end, h] = this.parser.parseArgs(args)

    // Pre-allocate points array
    const points = [new AsemicPt(this.parser, 0.5, h * 2)]
    const basePoints = [new AsemicPt(this.parser, 0, 0)]

    this.mapCurve(points, basePoints, start, end, { add })
    return this.parser
  }

  squ(argsStr: string, { add = false } = {}) {
    const args = this.parser.tokenize(argsStr)
    const [start, end, h, w] = this.parser.parseArgs(args)

    // Pre-allocate and cache calculations
    const negW = -w
    const points = [
      new AsemicPt(this.parser, 0, h),
      new AsemicPt(this.parser, 1, h)
    ]
    const basePoints = [
      new AsemicPt(this.parser, negW, 0),
      new AsemicPt(this.parser, w, 0)
    ]

    this.mapCurve(points, basePoints, start, end, { add })
    return this.parser
  }

  pen(argsStr: string, { add = false } = {}) {
    const args = this.parser.tokenize(argsStr)
    const [start, end, h, w] = this.parser.parseArgs(args)

    // Cache calculations
    const h05 = h * 0.5
    const h11 = h * 1.1
    const w2 = w * 2
    const negW2 = -w2

    const points = [
      new AsemicPt(this.parser, 0, h05),
      new AsemicPt(this.parser, 0.5, h11),
      new AsemicPt(this.parser, 1, h05)
    ]
    const basePoints = [
      new AsemicPt(this.parser, negW2, 0),
      new AsemicPt(this.parser, 0, 0),
      new AsemicPt(this.parser, w2, 0)
    ]

    this.mapCurve(points, basePoints, start, end, { add })
    return this.parser
  }

  hex(argsStr: string) {
    const args = this.parser.tokenize(argsStr)
    const [start, end, h, w] = this.parser.parseArgs(args)

    // Cache negative width
    const negW = -w

    const points = [
      new AsemicPt(this.parser, 0, 0),
      new AsemicPt(this.parser, 0, h),
      new AsemicPt(this.parser, 1, h),
      new AsemicPt(this.parser, 1, 0)
    ]
    const basePoints = [
      new AsemicPt(this.parser, negW, 0),
      new AsemicPt(this.parser, negW, 0),
      new AsemicPt(this.parser, w, 0),
      new AsemicPt(this.parser, w, 0)
    ]

    this.mapCurve(points, basePoints, start, end)
    return this.parser
  }

  circle(argsStr: string) {
    const tokens = this.parser.tokenize(argsStr)
    const [centerStr, whStr] = tokens
    const lastTo = this.parser.cloneTransform(this.parser.currentTransform)
    const center = this.parser.evalPoint(centerStr)
    const [w, h] = this.parser.evalPoint(whStr)

    // Cache negative values
    const negW = -w
    const negH = -h

    this.parser.to(`+${center[0]},${center[1]}`)

    // Pre-allocate array with exact size and create points directly
    const points: AsemicPt[] = [
      this.parser.applyTransform(new AsemicPt(this.parser, w, 0)),
      this.parser.applyTransform(new AsemicPt(this.parser, w, h)),
      this.parser.applyTransform(new AsemicPt(this.parser, negW, h)),
      this.parser.applyTransform(new AsemicPt(this.parser, negW, negH)),
      this.parser.applyTransform(new AsemicPt(this.parser, w, negH)),
      this.parser.applyTransform(new AsemicPt(this.parser, w, 0))
    ]

    // Use for loop with cached length for maximum performance
    const pointsLength = points.length
    const lastIndex = pointsLength - 1
    const divisor = pointsLength - 2

    for (let i = 0; i < pointsLength; i++) {
      this.parser.progress.point = i === lastIndex ? 0 : i / divisor
      this.parser.currentCurve.push(points[i])
    }

    this.parser.lastPoint = points[lastIndex]
    this.parser.end()
    this.parser.currentTransform = lastTo
    return this.parser
  }

  seq(
    countA: string,
    expressionA: string,
    { closed = false, end = true }: { closed?: boolean; end?: boolean } = {}
  ) {
    this.parser.repeat(countA, () => {
      this.parser.points(expressionA)
    })
    if (closed) {
      this.parser.currentCurve.push(this.parser.currentCurve[0].clone())
    }
    if (end) {
      this.parser.end()
    }
    return this.parser
  }

  line(...tokens: string[]) {
    // Cache length to avoid repeated property access
    const tokensLength = tokens.length
    for (let i = 0; i < tokensLength; i++) {
      this.parser.points(tokens[i])
      this.parser.end()
    }
    return this.parser
  }
}
