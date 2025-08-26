import { AsemicPt } from '../../blocks/AsemicPt'
import { Parser } from '../Parser'

export class DrawingMethods {
  parser: Parser

  constructor(parser: any) {
    this.parser = parser
  }

  tri(argsStr: string, { add = false } = {}) {
    const args = this.parser.tokenize(argsStr)
    const [start, end, h] = this.parser.parseArgs(args)
    this.parser.mapCurve(
      [new AsemicPt(this.parser, 0.5, h * 2)],
      [new AsemicPt(this.parser, 0, 0)],
      start,
      end,
      { add }
    )
    return this.parser
  }

  squ(argsStr: string, { add = false } = {}) {
    const args = this.parser.tokenize(argsStr)
    const [start, end, h, w] = this.parser.parseArgs(args)
    this.parser.mapCurve(
      [new AsemicPt(this.parser, 0, h), new AsemicPt(this.parser, 1, h)],
      [new AsemicPt(this.parser, -w, 0), new AsemicPt(this.parser, w, 0)],
      start,
      end,
      { add }
    )
    return this.parser
  }

  pen(argsStr: string, { add = false } = {}) {
    const args = this.parser.tokenize(argsStr)

    const [start, end, h, w] = this.parser.parseArgs(args)
    this.parser.mapCurve(
      [
        new AsemicPt(this.parser, 0, h * 0.5),
        new AsemicPt(this.parser, 0.5, h * 1.1),
        new AsemicPt(this.parser, 1, h * 0.5)
      ],
      [
        new AsemicPt(this.parser, -w * 2, 0),
        new AsemicPt(this.parser, 0, 0),
        new AsemicPt(this.parser, w * 2, 0)
      ],
      start,
      end,
      { add }
    )
    return this.parser
  }

  hex(argsStr: string) {
    const args = this.parser.tokenize(argsStr)
    const [start, end, h, w] = this.parser.parseArgs(args)
    this.parser.mapCurve(
      [
        new AsemicPt(this.parser, 0, 0),
        new AsemicPt(this.parser, 0, h),
        new AsemicPt(this.parser, 1, h),
        new AsemicPt(this.parser, 1, 0)
      ],
      [
        new AsemicPt(this.parser, -w, 0),
        new AsemicPt(this.parser, -w, 0),
        new AsemicPt(this.parser, w, 0),
        new AsemicPt(this.parser, w, 0)
      ],
      start,
      end
    )
    return this.parser
  }

  circle(argsStr: string) {
    const [centerStr, whStr] = this.parser.tokenize(argsStr)
    const lastTo = this.parser.cloneTransform(this.parser.currentTransform)
    const center = this.parser.evalPoint(centerStr)
    const [w, h] = this.parser.evalPoint(whStr)
    this.parser.to(`+${center[0]},${center[1]}`)

    // Pre-allocate array with known size
    const points: AsemicPt[] = new Array(6)

    // Create points directly without intermediate array
    points[0] = this.parser.applyTransform(new AsemicPt(this.parser, w, 0))
    points[1] = this.parser.applyTransform(new AsemicPt(this.parser, w, h))
    points[2] = this.parser.applyTransform(new AsemicPt(this.parser, -w, h))
    points[3] = this.parser.applyTransform(new AsemicPt(this.parser, -w, -h))
    points[4] = this.parser.applyTransform(new AsemicPt(this.parser, w, -h))
    points[5] = this.parser.applyTransform(new AsemicPt(this.parser, w, 0))

    // Avoid map() and use direct loop for better performance
    const pointsLength = points.length
    for (let i = 0; i < pointsLength; i++) {
      this.parser.progress.point =
        i === pointsLength - 1 ? 0 : i / (pointsLength - 2)
      this.parser.currentCurve.push(points[i])
    }

    this.parser.lastPoint = points[pointsLength - 1]
    this.parser.end()
    this.parser.currentTransform = lastTo
    return this.parser
  }

  seq(argsStr: string) {
    const args = this.parser.tokenize(argsStr)
    const count = this.parser.expr(args[0])
    const expression = args[1]

    const points: AsemicPt[] = []

    for (let i = 0; i < count; i++) {
      this.parser.progress.point = i / (count - 1 || 1)
      const value = this.parser.expr(expression)
      points.push(new AsemicPt(this.parser, value, value))
    }

    this.parser.currentCurve.push(...points)
    this.parser.end()
    return this.parser
  }

  line(...tokens: string[]) {
    for (let token of tokens) {
      this.parser.points(token)
      this.parser.end()
    }
    return this.parser
  }
}
