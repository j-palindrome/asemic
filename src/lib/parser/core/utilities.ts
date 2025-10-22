import { BasicPt } from '@/lib/blocks/AsemicPt'
import { splitString } from '@/lib/settings'
import { Parser } from '../Parser'

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

export const parserObject = (
  parser: Parser,
  args: string,
  typeConversions: Record<string, 'number' | 'boolean'>
) => {
  const obj: { [key: string]: any } = {}
  if (args.startsWith('{') && args.endsWith('}')) {
    args = args.substring(1, args.length - 1).trim()
  }
  for (let arg of parser.tokenize(args)) {
    if (arg.includes('=')) {
      let [key, value] = splitString(arg, '=')
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1)
      }
      obj[key] = value
    }
  }
  for (let key of Object.keys(typeConversions)) {
    switch (typeConversions[key]) {
      case 'number':
        if (obj[key] !== undefined) {
          obj[key] = parser.expr(obj[key])
        }
        break
      case 'boolean':
        if (obj[key] !== undefined) {
          obj[key] = obj[key] === 'true'
        }
        break
    }
  }
  return obj
}

export const getHeadingAt = (
  curve: BasicPt[],
  j: number,
  penulCache?: BasicPt
) => {
  return j === curve.length - 1
    ? curve[j]
        .clone()
        .subtract(penulCache ?? curve[j - 1])
        .angle0to1()
    : curve[j + 1].clone().subtract(curve[j]).angle0to1()
}
