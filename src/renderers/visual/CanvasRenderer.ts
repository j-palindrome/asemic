import { AsemicPt } from '../../blocks/AsemicPt'
import AsemicRenderer from '../AsemicRenderer'
import Renderer from '../AsemicRenderer'
import AsemicVisual from '../AsemicVisual'

export default class CanvasRenderer extends AsemicVisual {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  protected format(curves: AsemicPt[][]) {
    const w = this.ctx.canvas.width
    let newCurves: [number, number][][] = []
    for (let curve of curves) {
      // fake it with a gradient
      const newCurve: [number, number][] = []
      let index = 0
      const push = ([x, y]: [number, number]) => {
        // newCurve.set([x, y], index)
        newCurve.push([x, y])
        index += 2
      }
      const preTangent = curve[0]
        .clone()
        .subtract(curve[1])
        .unit()
        .scale(curve[0].width / 2 / w)
      curve[0].add(preTangent)
      const postTangent = curve
        .at(curve.length - 1)
        .clone()
        .subtract(curve.at(curve.length - 2))
        .unit()
        .scale(curve.at(curve.length - 1).width / 2 / w)
      curve.at(curve.length - 1).add(postTangent)

      if (curve.length == 1) {
      } else if (curve.length == 2) {
        const normal = curve[1]
          .clone()
          .subtract(curve[0])
          .rotate2D(0.25 * Math.PI * 2)
          .unit()
          .scale(curve[1].width / 2 / w)

        const p0 = curve[0].clone()
        p0.add(normal)

        push([p0.x, p0.y])

        const p1 = curve[1].clone()
        p1.add(normal)
        push([p1.x, p1.y])
        p1.subtract(normal.clone().scale(2))
        push([p1.x, p1.y])
        p0.subtract(normal.clone().scale(2))
        push([p0.x, p0.y])
      } else {
        const p0 = curve[0].clone()
        const n0 = curve[1]
          .clone()
          .subtract(curve[0])
          .rotate2D(0.25 * Math.PI * 2)
          .unit()
          .scale(curve[0].width / 2 / w)
        p0.add(n0)
        push([p0.x, p0.y])
        // push([...curve[0].clone()])

        const drawCurve = (curve: AsemicPt[], i: number) => {
          const p2 =
            i === curve.length - 3
              ? curve.at(i + 2).clone()
              : curve
                  .at(i + 1)
                  .$add(curve.at(i + 2))
                  .divide(2)
          const n2 = curve
            .at(i + 2)
            .clone()
            .subtract(curve.at(i + 1))
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
            .clone()
            .subtract(curve.at(i))
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
        const pEnd = reversedCurve[0].clone()
        const nEnd = reversedCurve[1]
          .clone()
          .subtract(reversedCurve[0])
          .rotate2D(0.25 * Math.PI * 2)
          .unit()
          .scale(reversedCurve[0].width / 2 / w)
        pEnd.add(nEnd)
        push([pEnd.x, pEnd.y])
        for (let i = 0; i <= curve.length - 3; i++) {
          drawCurve(reversedCurve, i)
        }
      }
      newCurves.push(newCurve)
    }

    return newCurves
  }
  render(curves: AsemicPt[][], { clear = true } = {}) {
    let { ctx } = this

    ctx.resetTransform()
    ctx.globalAlpha = 1
    if (clear) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    }
    ctx.scale(ctx.canvas.width, ctx.canvas.width)
    ctx.fillStyle = 'white'
    for (let curve of this.format(curves)) {
      if (curve.length === 0) continue
      ctx.beginPath()
      ctx.moveTo(curve[0][0], curve[0][1])
      if (curve.length === 4) {
        for (let i = 1; i < curve.length; i++) {
          ctx.lineTo(curve[i][0], curve[i][1])
        }
      } else {
        let i = 1
        for (; i < curve.length / 2; i += 2) {
          ctx.quadraticCurveTo(
            curve[i][0],
            curve[i][1],
            curve[i + 1][0],
            curve[i + 1][1]
          )
        }
        ctx.lineTo(curve[i][0], curve[i][1])
        i++
        for (; i < curve.length; i += 2) {
          ctx.quadraticCurveTo(
            curve[i][0],
            curve[i][1],
            curve[i + 1][0],
            curve[i + 1][1]
          )
        }
      }
      ctx.fill()
    }
    ctx.resetTransform()
  }

  constructor(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ) {
    super()
    this.ctx = ctx
  }
}
