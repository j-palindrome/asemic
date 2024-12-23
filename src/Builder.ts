import { lerp } from '../util/src/math'
import { last, max, min, range, sum } from 'lodash'
import {
  AnyPixelFormat,
  ClampToEdgeWrapping,
  Color,
  CurvePath,
  DataTexture,
  FloatType,
  LineCurve,
  NearestFilter,
  QuadraticBezierCurve,
  RedFormat,
  RGBAFormat,
  Vector2
} from 'three'
import invariant from 'tiny-invariant'
import { Jitter } from './Brush'
import { PointBuilder } from './PointBuilder'

const letters = 'abcdefghijklmnopqrstuvyxyz'.split('')
const twoLines = 'abdfhjpqrtxy'.split('')
const oneLine = 'clnos'.split('')
const SHAPES: Record<string, Coordinate[]> = {
  circle: [
    [1, 0],
    [1, 0.236],
    [0.707, 0.707],
    [0, 1],
    [-0.707, 0.707],
    [-1, 0],
    [-0.707, -0.707],
    [0, -1],
    [0.707, -0.707],
    [1, -0.236],
    [1, 0]
  ]
}

const v1 = new Vector2(),
  v2 = new Vector2()

type TargetInfo = [number, number] | number
export default class Builder {
  protected settings: {
    spacing: number
    defaults: Jitter
    recalculate: boolean | ((progress: number) => number)
    modifyPosition: string
    modifyColor: string
    modifyIncludes: string
  } & CoordinateSettings = {
    defaults: {
      size: [1, 1],
      hsl: [100, 100, 100],
      a: 100,
      position: [0, 0],
      rotation: 0
    },
    modifyPosition: `return position;`,
    modifyIncludes: ``,
    modifyColor: `return color;`,
    spacing: 1,
    recalculate: false,
    strength: 0,
    thickness: 1,
    color: [1, 1, 1],
    alpha: 1
  }
  protected transformData: TransformData = this.toTransform()
  protected transforms: TransformData[] = []
  protected keyframe: {
    groups: GroupData[]
    transform: TransformData
  } = this.defaultKeyframe()
  protected targetInfo: [number, number] = [0, 0]
  protected initialize: (t: Builder) => Builder | void

  protected defaultKeyframe() {
    return { groups: [], transform: this.toTransform(), settings: {} }
  }

  reset(clear = false) {
    this.transformData.scale = new PointBuilder([1, 1])
    this.transformData.rotate = 0
    this.transformData.translate = new PointBuilder()

    if (clear) this.transforms = []
  }

  protected target(groups?: TargetInfo) {
    const TargetInfo = (from: number, to?: number) => {
      if (from < 0) from += this.keyframe.groups.length
      if (to === undefined) to = from
      else if (to < 0) to += this.keyframe.groups.length
      this.targetInfo = [from, to]
      return this
    }
    if (typeof groups !== 'undefined') {
      if (typeof groups === 'number') TargetInfo(groups)
      else TargetInfo(groups[0], groups[1])
    }
  }

  getPoint(index: number = -1, curve: number = -1, group: number = -1) {
    if (group < 0) group += this.keyframe.groups.length
    if (curve < 0) curve += this.keyframe.groups[group].curves.length

    if (index < 0) index += this.keyframe.groups[group].curves[curve].length
    return this.fromPoint(this.keyframe.groups[group].curves[curve][index])
  }

  getIntersect(progress: number, curve: number = -1, group: number = -1) {
    if (group < 0) group += this.keyframe.groups.length
    if (curve < 0) curve += this.keyframe.groups[group].curves.length
    if (progress < 0) progress += 1

    const curvePath = this.makeCurvePath(
      this.keyframe.groups[group].curves[curve]
    )
    return this.fromPoint(curvePath.getPointAt(progress))
  }

  fromPoint(point: Vector2) {
    return this.applyTransform(point, this.transformData, true).toArray()
  }

  protected cloneTransform(transform: TransformData): TransformData {
    return {
      scale: transform.scale.clone(),
      rotate: transform.rotate,
      translate: transform.translate.clone()
    }
  }

  protected toTransform(transform?: CoordinateData): TransformData {
    if (!transform) {
      return {
        scale: new PointBuilder([1, 1]),
        rotate: 0,
        translate: new PointBuilder()
      }
    }
    return {
      scale:
        typeof transform.scale === 'number'
          ? new PointBuilder([transform.scale, transform.scale])
          : transform.scale instanceof Array
          ? new PointBuilder(transform.scale)
          : transform.scale ?? new PointBuilder([1, 1]),
      rotate: this.toRad(transform.rotate ?? 0),
      translate:
        transform.translate instanceof PointBuilder
          ? transform.translate
          : new PointBuilder(transform.translate)
    }
  }

  toPoints(...coordinates: (Coordinate | PointBuilder)[]) {
    return coordinates.map(x => this.toPoint(x))
  }

  getLastPoint(index: number = -1, curve: number = -1, group: number = -1) {
    if (group < 0) group += this.keyframe.groups.length
    if (curve < 0) curve += this.keyframe.groups[group].curves.length

    if (index < 0) {
      index += this.keyframe.groups[group].curves[curve].length
    }

    return this.keyframe.groups[group].curves[curve][index]
  }

  toPoint(coordinate: Coordinate | PointBuilder) {
    if (coordinate instanceof PointBuilder) return coordinate
    if (coordinate[2]) {
      this.transform(coordinate[2])
    }

    return this.applyTransform(
      new PointBuilder([coordinate[0], coordinate[1]], coordinate[2]),
      this.transformData
    )
  }

  protected interpolateCurve(
    curve: PointBuilder[],
    controlPointsCount: number
  ) {
    const newCurve = this.makeCurvePath(curve)

    const newCurvePoints: PointBuilder[] = []
    for (let i = 0; i < controlPointsCount; i++) {
      const u = i / (controlPointsCount - 1)
      newCurvePoints.push(
        new PointBuilder(newCurve.getPointAt(u).toArray() as [number, number])
      )

      curve.splice(0, curve.length, ...newCurvePoints)
    }
  }

  combineTransforms(
    transformData: TransformData,
    nextTransformData: TransformData,
    invert: boolean = false
  ) {
    if (invert) {
      transformData.translate.sub(
        nextTransformData.translate
          .divide(transformData.scale)
          .rotateAround({ x: 0, y: 0 }, -transformData.rotate)
      )
      transformData.rotate -= nextTransformData.rotate
      transformData.scale.divide(nextTransformData.scale)
    } else {
      transformData.translate.add(
        nextTransformData.translate
          .multiply(transformData.scale)
          .rotateAround({ x: 0, y: 0 }, transformData.rotate)
      )
      transformData.rotate += nextTransformData.rotate
      transformData.scale.multiply(nextTransformData.scale)
    }

    return transformData
  }

  applyTransform<T extends Vector2>(
    vector: T,
    transformData: TransformData,
    invert: boolean = false
  ): T {
    if (invert) {
      vector
        .sub(transformData.translate)
        .rotateAround({ x: 0, y: 0 }, -transformData.rotate)
        .divide(transformData.scale)
    } else {
      vector
        .multiply(transformData.scale)
        .rotateAround({ x: 0, y: 0 }, transformData.rotate)
        .add(transformData.translate)
    }

    return vector
  }

  protected colorToArray(
    color: CoordinateData['color']
  ): [number, number, number] {
    if (color instanceof Array) return color as [number, number, number]
    else if (color instanceof Color)
      return color.toArray() as [number, number, number]
    else return [1, 1, 1]
  }

  protected packToTexture(resolution: Vector2) {
    this.keyframe.groups = this.keyframe.groups
      .map(x => ({
        ...x,
        curves: x.curves
          .filter(x => x.length)
          .map(x => {
            if (x.length == 2) this.interpolateCurve(x, 3)
            return x
          })
      }))
      .filter(x => x.curves.length)
    const hypotenuse = resolution.length()

    this.reset(true)

    const width = max(
      this.keyframe.groups.flatMap(x => x.curves.flatMap(x => x.length))
    )!
    const height = sum(this.keyframe.groups.map(x => x.curves.length))
    const dimensions = new Vector2(width, height)
    let curveIndex = 0

    const groups = this.keyframe.groups.map((group, groupIndex) => {
      const curveEnds = new Float32Array(group.curves.length)
      const curveIndexes = new Float32Array(group.curves.length)
      const controlPointCounts = new Float32Array(group.curves.length)
      let totalCurveLength = 0
      group.curves.forEach((curve, i) => {
        // shortcut for Bezier lengths
        let curveLength = 0
        for (let i = 1; i < curve.length; i++) {
          curveLength += curve[i - 1].distanceTo(curve[i])
        }

        curveLength *=
          (hypotenuse / 1.414) * (group.transform.scale.length() / 1.414)
        totalCurveLength += curveLength
        curveEnds[i] = totalCurveLength
        curveIndexes[i] = curveIndex
        controlPointCounts[i] = curve.length
        curveIndex++
      })
      return {
        transform: this.keyframe.groups[groupIndex].transform,
        curveEnds,
        curveIndexes,
        controlPointCounts,
        totalCurveLength
      }
    })

    const createTexture = (array: Float32Array, format: AnyPixelFormat) => {
      const tex = new DataTexture(array, width, height)
      tex.format = format
      tex.type = FloatType
      tex.minFilter = tex.magFilter = NearestFilter
      tex.wrapS = tex.wrapT = ClampToEdgeWrapping
      tex.needsUpdate = true
      return tex
    }

    const keyframesTex = createTexture(
      new Float32Array(
        this.keyframe.groups.flatMap(x =>
          x.curves.flatMap(c =>
            range(width).flatMap(i => {
              return c[i]
                ? [c[i].x, c[i].y, c[i].strength ?? this.settings.strength, 1]
                : [0, 0, 0, 0]
            })
          )
        )
      ),
      RGBAFormat
    )

    const colorTex = createTexture(
      new Float32Array(
        this.keyframe.groups.flatMap(group =>
          group.curves.flatMap(c =>
            range(width).flatMap(i => {
              const point = c[i]

              return point
                ? [
                    ...this.colorToArray(point.color ?? this.settings.color),
                    point.alpha ?? this.settings.alpha
                  ]
                : [0, 0, 0, 0]
            })
          )
        )
      ),
      RGBAFormat
    )

    const thicknessTex = createTexture(
      new Float32Array(
        this.keyframe.groups.flatMap(group =>
          group.curves.flatMap(c =>
            range(width).flatMap(i => {
              const point = c[i]
              return point ? [point.thickness ?? this.settings.thickness] : [0]
            })
          )
        )
      ),
      RedFormat
    )

    const curveCounts = groups.map(x => x.curveIndexes.length)

    return {
      keyframesTex,
      colorTex,
      thicknessTex,
      transform: this.keyframe.transform,
      groups,
      dimensions,
      curveCounts,
      settings: this.settings
    }
  }

  protected getTransformAt(
    transforms: TransformData[],
    progress: number,
    loop: boolean = false
  ) {
    const { t, start } = {
      start: Math.floor(progress * (transforms.length - 1)),
      t: (progress * (transforms.length - 1)) % 1
    }

    const curveInterpolate = <T extends Vector2 | number>(
      groups: T[]
      // { isStart, isEnd }: { isStart: boolean; isEnd: boolean }
    ) => {
      // if (groups[0] instanceof Vector2) {
      //   invariant(groups[1] instanceof Vector2 && groups[2] instanceof Vector2)
      //   curveCache.v0.copy(groups[0])
      //   curveCache.v1.copy(groups[1])
      //   curveCache.v2.copy(groups[2])
      //   if (!isStart) curveCache.v0.lerp(curveCache.v1, 0.5)
      //   if (!isEnd) curveCache.v2.lerp(curveCache.v1, 0.5)
      //   return curveCache.getPoint(t)
      // } else if (typeof groups[0] === 'number') {
      //   curveCache.v0.set(0, groups[0])
      //   curveCache.v1.set(0, groups[1] as number)
      //   curveCache.v2.set(0, groups[2] as number)
      //   if (!isStart) curveCache.v0.lerp(curveCache.v1, 0.5)
      //   if (!isEnd) curveCache.v2.lerp(curveCache.v1, 0.5)
      //   return curveCache.getPoint(t).y
      // }
      if (groups[0] instanceof Vector2) {
        invariant(groups[1] instanceof Vector2)
        return groups[0].clone().lerp(groups[1], t)
      } else if (typeof groups[0] === 'number') {
        invariant(typeof groups[1] === 'number')
        return lerp(groups[0], groups[1], t)
      }
    }

    // const { t, start } = multiBezierProgressJS(
    //   progress,
    //   loop ? this.keyframes.length + 2 : this.keyframes.length
    // )

    const makeBezier = <T extends keyof TransformData>(key: T) => {
      // const groups = range(3).map(
      //   i => transforms[(start + i) % transforms.length][key]
      // )

      // return curveInterpolate(groups, t, {
      //   isStart: !loop && t === 0,
      //   isEnd: !loop && t === this.keyframes.length - 3
      // })

      const groups = range(2).map(
        i => transforms[(start + i) % transforms.length][key]
      )

      return curveInterpolate(groups)
    }

    const { rotate, translate, scale } = {
      rotate: makeBezier('rotate'),
      translate: makeBezier('translate'),
      scale: makeBezier('scale')
    }

    return { rotate, translate, scale } as TransformData
  }

  protected makeCurvePath(curve: PointBuilder[]): CurvePath<Vector2> {
    const path: CurvePath<Vector2> = new CurvePath()
    if (curve.length <= 1) {
      throw new Error(`Curve length is ${curve.length}`)
    }
    if (curve.length == 2) {
      path.add(new LineCurve(curve[0], curve[1]))
      return path
    }
    for (let i = 0; i < curve.length - 2; i++) {
      if ((curve[i + 1].strength ?? this.settings.strength) > 0.5) {
        path.add(
          new LineCurve(
            i === 0 ? curve[i] : curve[i].clone().lerp(curve[i + 1], 0.5),
            curve[i + 1]
          )
        )
        path.add(
          new LineCurve(
            curve[i + 1],
            i === curve.length - 3
              ? curve[i + 2]
              : curve[i + 1].clone().lerp(curve[i + 2], 0.5)
          )
        )
      } else {
        path.add(
          new QuadraticBezierCurve(
            i === 0 ? curve[i] : curve[i].clone().lerp(curve[i + 1], 0.5),
            curve[i + 1],
            i === curve.length - 3
              ? curve[i + 2]
              : curve[i + 1].clone().lerp(curve[i + 2], 0.5)
          )
        )
      }
    }
    return path
  }

  getBounds(points: PointBuilder[], transform?: TransformData) {
    const flatX = points.map(x => x.x)
    const flatY = points.map(y => y.y)
    const minCoord = new Vector2(min(flatX)!, min(flatY)!)
    const maxCoord = new Vector2(max(flatX)!, max(flatY)!)
    if (transform) {
      this.applyTransform(minCoord, transform)
      this.applyTransform(maxCoord, transform)
    }
    return {
      min: minCoord,
      max: maxCoord,
      size: new Vector2().subVectors(maxCoord, minCoord),
      center: new Vector2().lerpVectors(minCoord, maxCoord, 0.5)
    }
  }

  getRandomAlong(...curve: Coordinate[]) {
    const curvePoints = curve.map(x => this.toPoint(x))
    const curvePath = this.makeCurvePath(curvePoints)
    if (curve.length === 2) {
      return this.toPoint(curve[0]).lerp(this.toPoint(curve[1]), Math.random())
    }
    return new PointBuilder(0, 0).copy(curvePath.getPointAt(Math.random()))
  }

  getRandomWithin(origin: number, variation: number): number
  getRandomWithin(origin: Coordinate, variation: Coordinate): PointBuilder
  getRandomWithin(
    origin: number | Coordinate,
    variation: number | Coordinate
  ): number | PointBuilder {
    if (typeof origin === 'number' && typeof variation === 'number') {
      return origin + (Math.random() - 0.5) * 2 * variation
    } else {
      return this.toPoint(origin as Coordinate).add(
        new Vector2()
          .random()
          .subScalar(0.5)
          .multiplyScalar(2)
          .multiply(this.toPoint(variation as Coordinate))
      )
    }
  }

  debug(target?: TargetInfo) {
    this.target(target)
    console.log(
      this.keyframe.groups
        .slice(this.targetInfo[0], this.targetInfo[1] + 1)
        .map(
          g =>
            `*${g.transform.scale.toArray().map(x => x.toFixed(2))} @${
              g.transform.rotate / Math.PI / 2
            } +${g.transform.translate.toArray().map(x => x.toFixed(2))}
${g.curves
  .map(c =>
    c
      .map(
        p =>
          `${p
            .toArray()
            .map(p => p.toFixed(2))
            .join(',')}`
      )
      .join(' ')
  )
  .join('\n')}`
        )
        .join('\n\n')
    )
    return this
  }

  within(from: Coordinate, to: Coordinate) {
    const fromV = this.toPoint(from)
    const size = new Vector2().copy(this.toPoint(to)).sub(fromV)

    const curves = g.curves.flat()
    const bounds = this.getBounds(curves)
    curves.forEach(p => {
      p.sub(bounds.min).divide(bounds.size).multiply(size).add(fromV)
    })

    return this
  }

  length(copyCount: number) {
    return this.lastCurve(curve =>
      curve.push(...range(copyCount).map(() => curve[0].clone()))
    )
  }

  text(str: string) {
    let lineCount = 0

    for (let letter of str) {
      let pickedLetter = letter
      if (this.letters[letter]) {
        this.transform({ translate: [0.1, 0], push: true })
          .newGroup()
          .letter(pickedLetter)
      } else if (letter === '\n') {
        lineCount++

        this.transform({
          reset: true,
          translate: [0, -1.1 * lineCount]
        })
      }
    }

    const maxX = max(
      this.keyframe.groups.map(g => {
        return this.getBounds(g.curves.flat(), g.transform).max.x
      })
    )!
    this.reset(true)
    this.groups(
      group => {
        group.transform.translate.multiplyScalar(1 / maxX)
        group.transform.scale.multiplyScalar(1 / maxX)
      },
      [0, -1]
    )
    return this
  }

  transform(transform: CoordinateData) {
    if (transform.reset) {
      switch (transform.reset) {
        case 'pop':
          this.transformData = this.transforms.pop() ?? this.toTransform()
          break
        case 'last':
          this.transformData = this.cloneTransform(
            last(this.transforms) ?? this.toTransform()
          )
          break
        case 'group':
          this.transformData = this.cloneTransform(
            last(this.keyframe.groups)?.transform ?? this.toTransform()
          )
          break
        case true:
          this.reset()
          break
      }
    }

    this.transformData = this.combineTransforms(
      this.transformData,
      this.toTransform(transform)
    )

    if (transform.push) {
      this.transforms.push(this.cloneTransform(this.transformData))
    }

    return this
  }

  eval(func: (g: this, progress: number) => void, runCount = 1) {
    for (let i = 0; i < runCount; i++) {
      func(this, i)
    }

    return this
  }

  parse(value: string) {
    let parsed = value
    const matchString = (match: RegExp, string: string) => {
      const find = string.match(match)?.[1] ?? ''
      return find
    }

    const detectRange = <T extends number | Coordinate>(
      range: string,
      callback: (string: string) => T
    ): T => {
      if (range.includes('~')) {
        const p = range.split('~')
        let r = p.map(c => callback(c))
        if (r[0] instanceof Array) {
          invariant(r instanceof Array)
          const points = r.map(x => this.toPoint(x as Coordinate))
          if (points.length === 2) {
            return new Vector2()
              .lerpVectors(points[0], points[1], Math.random())
              .toArray() as T
          } else {
            return this.makeCurvePath(points)
              .getPoint(Math.random())
              .toArray() as T
          }
        } else if (typeof r[0] === 'number') {
          if (r.length === 2) {
            return lerp(r[0], r[1] as number, Math.random()) as T
          } else {
            return this.makeCurvePath(
              r.map(x => this.toPoint([x as number, 0]))
            ).getPoint(Math.random()).x as T
          }
        }
      }
      return callback(range)
    }

    const parseCoordinate = (
      c: string,
      defaultArg: 'same' | number = 'same'
    ): Coordinate | undefined => {
      if (!c) return undefined
      return detectRange(c, c => {
        if (!c.includes(',')) {
          return [
            parseNumber(c)!,
            defaultArg === 'same' ? parseNumber(c)! : defaultArg
          ] as [number, number]
        } else {
          // if (c[2]) {
          //   const translate = parseCoordinate(
          //     matchString(/\+([\-\d\.,\/~]+)/, c[2])
          //   )
          //   const scale = parseCoordinate(
          //     matchString(/\*([\-\d\.,\/~]+)/, c[2])
          //   )
          //   const rotate = parseNumber(matchString(/@([\-\d\.\/~]+)/, c[2]))
          // }
          return c.split(',', 2).map(x => parseNumber(x)) as [number, number]
        }
      })
    }

    const parseNumber = (coordinate: string): number | undefined => {
      if (!coordinate) return undefined
      return detectRange(coordinate, c => {
        if (c.includes('/')) {
          const split = c.split('/')
          return Number(split[0]) / Number(split[1])
        }
        return Number(c)
      })
    }

    const parseArgs = (name: string, argString: string) => {
      const args = argString.split(' ')
    }

    const parseCoordinateList = (
      argString: string,
      defaultArg: 'same' | number = 'same'
    ) =>
      !argString
        ? undefined
        : argString.split(' ').map(x => parseCoordinate(x, defaultArg)!)

    const text = matchString(/(.*?)( [\+\-*@]|$|\{)/, parsed)
    parsed = parsed.replace(text, '')
    this.text(text)

    const translate = parseCoordinate(
      matchString(/ \+([\-\d\.,\/~]+)/, parsed)
    ) as [number, number]
    const scale = parseCoordinate(
      matchString(/ \*([\-\d\.,\/~]+)/, parsed)
    ) as [number, number]
    const rotate = parseNumber(matchString(/ @([\-\d\.\/~]+)/, parsed))
    const thickness = parseNumber(
      matchString(/ (?:t|thickness):([\-\d\.\/~]+)/, parsed)
    )

    this.setWarp({ translate, scale, rotate, thickness }, -1)

    const groupTranslate = parseCoordinateList(
      matchString(/ \+\[([\-\d\.\/ ]+)\]/, parsed)
    )
    const groupScale = parseCoordinateList(
      matchString(/ \*\[([\-\d\.\/ ]+)\]/, parsed)
    )
    const groupRotate = parseCoordinateList(
      matchString(/ @\[([\-\d\.\/ ]+)\]/, parsed),
      0
    )

    if (groupTranslate || groupScale || groupRotate) {
      const translationPath = groupTranslate
        ? this.makeCurvePath(groupTranslate.map(x => this.toPoint(x)))
        : undefined
      const rotationPath = groupRotate
        ? this.makeCurvePath(
            groupRotate.map(x => new PointBuilder([this.toRad(x[0]), 0]))
          )
        : undefined
      const scalePath = groupScale
        ? this.makeCurvePath(groupScale.map(x => this.toPoint(x)))
        : undefined
      this.groups(
        (g, { groupProgress }) => {
          this.combineTransforms(g.transform, {
            translate: new PointBuilder().copy(
              translationPath?.getPoint(groupProgress) ?? new Vector2(0, 0)
            ),
            scale: new PointBuilder().copy(
              scalePath?.getPoint(groupProgress) ?? new Vector2(1, 1)
            ),
            rotate: rotationPath?.getPoint(groupProgress).x ?? 0
          })
        },
        [0, -1]
      )
    }

    const functionMatch = /\\(\w+) ([^\\]*?)/
    let thisCall = parsed.match(functionMatch)
    while (thisCall) {
      // TODO: create a function to parse arguments
      let name = thisCall[1]
      let args = thisCall[2]
      // if (!parseArgs[name]) throw new Error(`Unknown function ${name}`)
      parsed = parsed.replace(functionMatch, '')
      thisCall = parsed.match(functionMatch)
    }

    return this
  }

  set(settings) {
    Object.assign(this.settings, settings)
    return this
  }

  reInitialize(resolution: Vector2) {
    this.reset(true)
    this.target([0, 0])
    this.keyframe = this.defaultKeyframe()
    this.initialize(this)
    return this.packToTexture(resolution)
  }

  constructor(initialize: (builder: Builder) => Builder | void) {
    this.initialize = initialize
  }
}
