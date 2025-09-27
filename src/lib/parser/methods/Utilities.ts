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
    return [minX, minY, maxX, maxY]
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

  center(coords: string, type: string, callback: string | (() => void)) {
    const [centerX, centerY] = this.parser.parsePoint(coords)
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

    const boundingCenterX = (minX! + maxX!) / 2
    const boundingCenterY = (minY! + maxY!) / 2

    const dx = centerX - boundingCenterX
    const dy = centerY - boundingCenterY
    const difference = new BasicPt(
      type.includes('x') ? dx : 0,
      type.includes('y') ? dy : 0
    )

    for (const group of addedGroups) {
      for (const pt of group.flat()) {
        pt.add(difference)
      }
    }

    return this.parser
  }

  each(makeCurves: () => void, callback: (pt: AsemicPt) => void) {
    const start = this.parser.groups.length
    const saveProgress = this.parser.progress.curve
    makeCurves()
    const finalProgress = this.parser.progress.curve
    this.parser.progress.curve = saveProgress
    for (const group of this.parser.groups.slice(start)) {
      this.parser.progress.point = 0
      for (const pt of group.flat()) {
        this.parser.progress.curve++
        this.parser.progress.point += 1 / (group.flat().length - 1)
        callback(pt)
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

  noise(value: number, frequencies: number[], phases: number[] = []) {
    let sum = 0
    for (let i = 0; i < frequencies.length; i++) {
      sum +=
        Math.cos(
          frequencies[i] *
            (i + 1) *
            (value + (phases[i] || this.parser.hash(i + 10)))
        ) /
        (i + 1)
    }
    return sum / CACHED[frequencies.length]
  }
}
