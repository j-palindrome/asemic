import { CurvePath, LineCurve, QuadraticBezierCurve, Vector2 } from 'three'
import invariant from 'tiny-invariant'
import { PtBuilder } from './PtBuilder'
import { GroupBuilder } from './GroupBuilder'

export default class Parser {
  protected makeCurvePath(curve: GroupBuilder): CurvePath<Vector2> {
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

  detectRange = <T extends number | Coordinate>(
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

  parseCoordinate = (
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
        return c.split(',', 2).map(x => this.parseNumber(x)) as [number, number]
      }
    })
  }

  parseNumber = (coordinate: string): number | undefined => {
    if (!coordinate) return undefined
    return this.detectRange(coordinate, c => {
      if (c.includes('/')) {
        const split = c.split('/')
        return Number(split[0]) / Number(split[1])
      }
      return Number(c)
    })
  }

  parseArgs = (name: string, argString: string) => {
    const args = argString.split(' ')
  }

  parseCoordinateList = (
    argString: string,
    defaultArg: 'same' | number = 'same'
  ) =>
    !argString
      ? undefined
      : argString.split(' ').map(x => parseCoordinate(x, defaultArg)!)

  parse(value: string) {
    let parsed = value
    const matchString = (match: RegExp, string: string) => {
      const find = string.match(match)?.[1] ?? ''
      return find
    }

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
}
