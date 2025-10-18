import { BasicPt } from '@/lib/blocks/AsemicPt'

export function bezier(exprFade: number, exprPoints: BasicPt[]) {
  let index = (exprPoints.length - 2) * exprFade
  let start = Math.floor(index)

  const bezier = (
    point1: BasicPt,
    point2: BasicPt,
    point3: BasicPt,
    amount: number
  ) => {
    const t = amount % 1
    const u = 1 - t
    if (amount >= 1) {
      point1 = point1.clone().lerp(point2, 0.5)
    }
    if (amount < exprPoints.length - 3) {
      point3 = point3.clone().lerp(point2, 0.5)
    }

    return point1
      .clone()
      .scale([u ** 2, u ** 2])
      .add(
        point2
          .clone()
          .scale([2 * u * t, 2 * u * t])
          .add(point3.clone().scale([t ** 2, t ** 2]))
      )
  }

  return bezier(
    exprPoints[start],
    exprPoints[start + 1],
    exprPoints[start + 2],
    index
  )
}
