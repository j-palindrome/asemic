import { splitString } from '@/lib/settings'
import { AsemicPt, BasicPt } from '../../blocks/AsemicPt'
import { CACHED } from '../constants/ExpressionConstants'
import { Parser } from '../Parser'

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

  repeat(count: string, callback: (() => void) | string) {
    const counts = this.parser
      .tokenize(count, { separatePoints: true })
      .map((x: string) => this.parser.expr(x))

    const iterate = (index: number) => {
      const prevIndex = this.parser.progress.indexes[index]
      const prevCountNum = this.parser.progress.countNums[index]
      this.parser.progress.countNums[index] = counts[index]
      for (let i = 0; i < this.parser.progress.countNums[index]; i++) {
        this.parser.progress.indexes[index] = i
        if (typeof callback === 'function') {
          callback()
        } else {
          this.parser.text(callback)
        }
        if (counts[index + 1]) {
          iterate(index + 1)
        }
      }
      this.parser.progress.indexes[index] = prevIndex
      this.parser.progress.countNums[index] = prevCountNum
    }
    iterate(0)

    return this.parser
  }

  within(points: string, callback: () => void) {
    const [coord0, coord1] = this.parser.tokenize(points)
    const [x, y] = this.parser.parsePoint(coord0)
    const [x2, y2] = this.parser.parsePoint(coord1)
    const startGroup = this.parser.groups.length
    callback()
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
      this.parser.group({
        mode: 'line',
        curve: 'true',
        vert: '0,0',
        count: 100,
        correction: 0
      })
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
      this.parser.group({
        mode: 'line',
        curve: 'true',
        vert: '0,0',
        count: 100,
        correction: 0
      })
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

  add(callback: string, makeCurves: string | (() => void)) {
    const saveProgress = this.parser.progress.curve
    if (typeof makeCurves === 'function') makeCurves()
    else this.parser.text(makeCurves)
    const finalProgress = this.parser.progress.curve
    this.parser.progress.curve = saveProgress
    for (const group of this.parser.groups) {
      this.parser.progress.point = 0
      for (const pt of group.flat()) {
        this.parser.progress.curve++
        this.parser.progress.point += 1 / (group.flat().length - 1)
        const addPoint = this.parser.evalPoint(
          callback.replace('$0', `${pt[0]}`).replace('$1', `${pt[1]}`)
        )
        pt.add(addPoint)
      }
    }
    return this.parser
  }

  test(
    condition: string | number,
    callback?: () => void,
    callback2?: () => void
  ) {
    const exprCondition = this.parser.expr(condition, false)
    if (exprCondition) {
      callback && callback()
    } else {
      callback2 && callback2()
    }
    return this.parser
  }
}
