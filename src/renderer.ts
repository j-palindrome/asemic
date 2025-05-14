export default class Renderer {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  render(curves: [number, number][][]) {
    let { ctx } = this
    ctx.resetTransform()
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.scale(ctx.canvas.width, ctx.canvas.width)
    ctx.fillStyle = 'white'
    if (curves.length === 0 || !curves[0]) return
    for (let curve of curves) {
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
  }

  constructor(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ) {
    this.ctx = ctx
  }
}
