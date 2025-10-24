import Asemic from '@/lib/Asemic'
import { AsemicPt, BasicPt } from '../../blocks/AsemicPt'
import { parserObject } from '../core/utilities'
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

  protected parseCurve(args: string[], points: string) {
    this.parser.to('>')
    this.parser.remap(args[0], args[1], args[2])
    this.parser.points(points.replaceAll('$W', args[3] ?? '0'))
    if (!args[4]) this.parser.end()

    this.parser.to('<')
  }

  c3(...args) {
    this.parseCurve(args, '0,0 .5,1 1,0')
  }

  c4(...args) {
    this.parseCurve(args, '0,0 -$W,1 1+$W,1 1,0')
  }

  c5(...args) {
    this.parseCurve(args, '0,0 -$W,0.5 .5,1 1+$W,.5 1,0')
  }

  c6(...args) {
    this.parseCurve(args, '0,0 -$W,0 -$W,1 1+$W,1 1+$W,0 1,0')
  }

  circle(...args) {
    const [centerStr, whStr] = args
    this.parser.to(`> +${centerStr} *${whStr}`)
    this.parser.text('[-1,0 -1,-1 1,-1 1,1 -1,1]<')
    this.parser.to('<')
  }
}
