import { splitString } from '@/lib/settings'
import { AsemicPt, BasicPt } from '../../blocks/AsemicPt'
import { CACHED } from '../constants/ExpressionConstants'
import { Parser } from '../Parser'
import { getHeadingAt } from '../core/utilities'

export class UtilityMethods {
  parser: Parser

  constructor(parser: Parser) {
    this.parser = parser
  }

  getBounds(fromCurve: number, toCurve?: number) {
    let minX: number | undefined = undefined,
      minY: number | undefined = undefined,
      maxX: number | undefined = undefined,
      maxY: number | undefined = undefined
    for (let group of this.parser.groups[this.parser.groups.length - 1].slice(
      fromCurve,
      toCurve
    )) {
      for (const point of group) {
        if (minX === undefined || point[0] < minX) {
          minX = point[0]
        }
        if (maxX === undefined || point[0] > maxX) {
          maxX = point[0]
        }
        if (minY === undefined || point[1] < minY) {
          minY = point[1]
        }
        if (maxY === undefined || point[1] > maxY) {
          maxY = point[1]
        }
      }
    }
    return [minX!, minY!, maxX!, maxY!]
  }

  bepeat(count, ...callbacks: ((() => void) | string)[]) {
    this.repeatUtil(count, { backwards: true }, ...callbacks)
  }

  repeat(count, ...callbacks: ((() => void) | string)[]) {
    this.repeatUtil(count, { backwards: false }, ...callbacks)
  }

  protected repeatUtil(
    count: string,
    { backwards = true },
    ...callbacks: ((() => void) | string)[]
  ) {
    const counts = this.parser
      .tokenize(count, { separatePoints: true })
      .map((x: string) => this.parser.expr(x))

    if (callbacks.length > counts.length)
      throw new Error(
        `Too many callbacks: ${callbacks.length} for repeat ${count}, which has ${counts.length} counts`
      )

    const savedCountNums = this.parser.progress.countNums.slice()
    const savedIndexes = this.parser.progress.indexes.slice()
    const iterate = (index: number) => {
      this.parser.progress.countNums[index] = counts[index]
      for (let i = 0; i < this.parser.progress.countNums[index]; i++) {
        this.parser.progress.indexes[index] = i
        if (typeof callbacks[index] === 'function') {
          callbacks[index]()
        } else if (typeof callbacks[index] === 'string') {
          this.parser.text(callbacks[index])
        }

        if (index + 1 < counts.length) {
          iterate(index + 1)
        }
      }
    }
    iterate(0)

    this.parser.progress.countNums = savedCountNums
    this.parser.progress.indexes = savedIndexes

    return this.parser
  }

  ripple(count: string, veer: string, callback: (() => void) | string) {
    if (!this.parser.groups.length) this.parser.group()
    const activeGroup = this.parser.groups[this.parser.groups.length - 1]
    const currentLength = activeGroup.length
    const countNum = this.parser.expr(count)
    if (typeof callback === 'function') {
      callback()
    } else {
      this.parser.text(callback)
    }
    for (let i = currentLength; i < activeGroup.length; i++) {
      const curve = activeGroup[i]
      const currentLength = curve.length

      for (let j = 1; j < curve.length; j += countNum + 1) {
        const pt0 = curve[j - 1]
        const pt1 = curve[j]
        const heading = getHeadingAt(curve, j)

        if (j === 1) {
          this.parser.progress.point = 0
          // debugger
          pt0.add(
            this.parser
              .evalPoint(veer)
              .scale(this.parser.currentTransform['*'])
              .rotate(heading - 0.25)
          )
        }

        for (let k = 0; k < countNum; k++) {
          this.parser.progress.point =
            (j + k) / (currentLength + countNum * j - 1 || 1)
          const t = (k + 1) / (countNum + 1)
          const newPoint = pt0
            .clone(true)
            .lerp(pt1, t)
            .add(
              this.parser
                .evalPoint(veer)
                .scale(this.parser.currentTransform['*'])
                .rotate(heading - 0.25)
            )
          curve.splice(j + k, 0, newPoint)
        }

        this.parser.progress.point =
          (j + 1) / countNum / (currentLength - 1 || 1)

        pt1.add(
          this.parser
            .evalPoint(veer)
            .scale(this.parser.currentTransform['*'])
            .rotate(heading - 0.25)
        )
      }
    }
  }

  if(value: string, ifTrue?: string, ifFalse?: string) {
    const exprValue = this.parser.expr(value)
    if (exprValue && ifTrue) {
      this.parser.text(ifTrue)
    } else if (ifFalse) {
      this.parser.text(ifFalse)
    }
  }

  cinterp(count: string, callback: (() => void) | string) {
    if (!this.parser.groups.length) this.parser.group()
    const activeGroup = this.parser.groups[this.parser.groups.length - 1]
    const currentLength = activeGroup.length
    const countNum = this.parser.expr(count)
    if (typeof callback === 'function') {
      callback()
    } else {
      this.parser.text(callback)
    }
    for (let i = currentLength; i < activeGroup.length; i++) {
      const curve = activeGroup[i]

      for (let j = 1; j < curve.length; j += countNum + 1) {
        const pt0 = curve[j - 1]
        const pt1 = curve[j]
        for (let k = 0; k < countNum; k++) {
          const t = (k + 1) / (countNum + 1)
          curve.splice(j + k, 0, pt0.clone().lerp(pt1, t))
        }
      }
    }
  }

  within(coord0, coord1, callback: (() => void) | string) {
    const [x, y] = this.parser.parsePoint(coord0)
    const [x2, y2] = this.parser.parsePoint(coord1)
    const startGroup = this.parser.groups.length
    if (typeof callback === 'function') callback()
    else this.parser.text(callback)
    const [minX, minY, maxX, maxY] = this.parser.getBounds(startGroup)
    const newWidth = x2 - x
    const newHeight = y2 - y
    const oldWidth = maxX! - minX!
    const oldHeight = maxY! - minY!
    const scaleX = newWidth / (oldWidth || 1)
    const scaleY = newHeight / (oldHeight || 1)

    for (let i = startGroup; i < this.parser.groups.length; i++) {
      for (let curve of this.parser.groups[i]) {
        for (let pt of curve) {
          pt[0] = x + (pt[0] - minX!) * scaleX
          pt[1] = y + (pt[1] - minY!) * scaleY
        }
      }
    }

    if (this.parser.currentCurve.length) {
      this.parser.currentCurve = this.parser.currentCurve.map(
        (pt: AsemicPt) => {
          pt[0] = x + (pt[0] - minX!) * scaleX
          pt[1] = y + (pt[1] - minY!) * scaleY
          return pt
        }
      )
    }
    return this.parser
  }

  alignX(
    coords: string,
    type: string,
    ...callbacks: (string | (() => void))[]
  ) {
    const centerX = this.parser.expr(coords)
    const alignX = this.parser.expr(type)
    let lastGroup = this.parser.groups[this.parser.groups.length - 1]
    if (!lastGroup) {
      this.parser.group()
      lastGroup = this.parser.groups[this.parser.groups.length - 1]
    }

    for (let callback of callbacks) {
      const startCurve = lastGroup.length
      if (typeof callback === 'string') this.parser.text(callback)
      else callback()
      const addedGroups = lastGroup.slice(startCurve)
      const [minX, minY, maxX, maxY] = this.parser.getBounds(startCurve)
      const change = new BasicPt(maxX - minX, 0).scale([alignX, 1])
      for (const group of addedGroups) {
        for (const pt of group.flat()) {
          pt.subtract([minX, 0]).add([centerX, 0]).subtract(change)
        }
      }
    }
    return this.parser
  }

  align(coords: string, type: string, callback: string | (() => void)) {
    const [centerX, centerY] = this.parser.parsePoint(coords)
    const [alignX, alignY] = this.parser.evalPoint(type)
    let lastGroup = this.parser.groups[this.parser.groups.length - 1]
    if (!lastGroup) {
      this.parser.group()
      lastGroup = this.parser.groups[this.parser.groups.length - 1]
    }
    const startCurve = lastGroup.length

    if (typeof callback === 'string') this.parser.text(callback)
    else callback()

    const addedGroups = lastGroup.slice(startCurve)

    const [minX, minY, maxX, maxY] = this.parser.getBounds(startCurve)
    const change = new BasicPt(maxX - minX, maxY - minY).scale([alignX, alignY])

    for (const group of addedGroups) {
      for (const pt of group.flat()) {
        pt.subtract([minX, minY]).add([centerX, centerY]).subtract(change)
      }
    }

    return this.parser
  }

  add(point: string, callback: string | (() => void)) {
    if (!this.parser.groups.length) this.parser.group()
    const activeGroup = this.parser.groups[this.parser.groups.length - 1]
    const currentLength = activeGroup.length
    if (typeof callback === 'function') {
      callback()
    } else {
      this.parser.text(callback)
    }
    // this.parser.progress.countNums[1] = activeGroup.length - currentLength
    for (let i = currentLength; i < activeGroup.length; i++) {
      const curve = activeGroup[i]

      const penulCache = curve[curve.length - 2].clone()
      this.parser.progress.point = i - currentLength
      // this.parser.progress.countNums[0] = curve.length
      for (let j = 0; j < curve.length; j++) {
        this.parser.progress.point = j / (curve.length - 1 || 1)
        const addPt = this.parser.evalPoint(point)
        const heading = getHeadingAt(curve, j, penulCache)
        curve[j].add(addPt.rotate(heading + 0.25))
      }
    }
    return this.parser
  }

  test(
    condition: string | number,
    callback?: () => void,
    callback2?: () => void
  ) {
    const exprCondition = this.parser.expr(condition)
    if (exprCondition) {
      callback && callback()
    } else {
      callback2 && callback2()
    }
    return this.parser
  }
}
