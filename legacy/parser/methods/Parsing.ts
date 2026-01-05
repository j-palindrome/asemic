import invariant from 'tiny-invariant'
import { AsemicPt, BasicPt } from '../../blocks/AsemicPt'
import { splitString } from '../../../src/lib/settings'
import { AsemicGroup } from '../core/AsemicGroup'
import { Parser } from '../Parser'
import { parserObject } from '../core/utilities'

export class ParsingMethods {
  parser: Parser

  // Performance caches
  private tokenizeCache = new Map<string, string[]>()
  private regexCache = new Map<string, RegExp>()

  // Pre-compiled regex patterns
  private static readonly COMMENT_REGEX = /^\s*\/\/.*/gm
  private static readonly WHITESPACE_REGEX = /^\s/
  private static readonly COMMA_REGEX = /^\,/
  private static readonly UNDERSCORE_REGEX = /^\_/
  private static readonly SEMICOLON_REGEX = /^\;/

  constructor(parser: Parser) {
    this.parser = parser
  }

  print(...args: string[]) {
    this.parser.error(
      args.map(x => this.parser.expressions.expr(x)!.toFixed(2)).join(' ')
    )
  }

  tokenize(
    source: string | number,
    {
      separatePoints = false,
      separateFragments = false,
      separateObject = false,
      regEx = ParsingMethods.WHITESPACE_REGEX,
      stopAt0 = false
    }: {
      separatePoints?: boolean
      separateFragments?: boolean
      regEx?: RegExp
      separateObject?: boolean
      stopAt0?: boolean
    } = {}
  ): string[] {
    if (typeof source === 'number') return [source.toString()]
    // Use pre-compiled regex patterns
    if (separatePoints) regEx = ParsingMethods.COMMA_REGEX
    else if (separateFragments) regEx = ParsingMethods.UNDERSCORE_REGEX
    else if (separateObject) regEx = ParsingMethods.SEMICOLON_REGEX

    // Check cache first
    const cacheKey = `${source}:${separatePoints}:${separateFragments}:${separateObject}:${stopAt0}`
    if (this.tokenizeCache.has(cacheKey)) {
      return this.tokenizeCache.get(cacheKey)!
    }

    // Tokenize the source
    let tokens: string[] = []
    let current = ''
    let inBrackets = 0
    let inParentheses = 0
    let inBraces = 0
    let callback = false

    let isEscaped = false
    const sourceLength = source.length
    for (let i = 0; i < sourceLength; i++) {
      const char = source[i]

      if (isEscaped) {
        isEscaped = false
        continue
      }
      switch (char) {
        case '|':
          if (inBrackets === 0 && inParentheses === 0 && inBraces === 0) {
            if (current.length) tokens.push(current)
            current = ''
            callback = true
            continue
          }
        case '[':
          inBrackets++
          break
        case ']':
          inBrackets--
          break
        case '(':
          inParentheses++
          break
        case ')':
          inParentheses--
          break
        case '{':
          inBraces++
          break
        case '}':
          inBraces--
          break
        case '\\':
          isEscaped = true
          continue
      }
      const hasTotalBrackets =
        inBraces + inParentheses + inBrackets > 0 || callback
      if (current === '' && !hasTotalBrackets) {
        switch (char) {
          case '"':
          case '/':
            current += source[i]
            i++
            while (i < sourceLength) {
              current += source[i]
              if (source[i] === '\\') i++
              if (source[i] === char) {
                break
              }
              i++
            }
            continue
        }
      }

      if (stopAt0 && i > 0 && !hasTotalBrackets) {
        const result = [current, source.slice(i + 1)]
        this.tokenizeCache.set(cacheKey, result)
        return result
      } else if (!hasTotalBrackets && regEx.test(source.substring(i))) {
        if (current) {
          tokens.push(current)
          current = ''
        }
      } else {
        current += char
      }
    }
    if (current.length) tokens.push(current)

    // Cache the result
    this.tokenizeCache.set(cacheKey, tokens)
    return tokens
  }

  parsePoint(
    notation: string | number,
    { save = true, randomize = true, forceRelative = false } = {}
  ): AsemicPt {
    let point: AsemicPt
    if (typeof notation === 'number') {
      point = new AsemicPt(this.parser, notation, notation)
    } else {
      // Relative coordinates: +x,y
      if (notation.startsWith('+')) {
        point = this.parser.transformMethods.applyTransform(
          this.parser.parsing.evalPoint(notation.substring(1), {
            basic: false
          }),
          {
            relative: true,
            randomize
          }
        )
      } else {
        // Absolute coordinates: x,y
        point = this.parser.transformMethods.applyTransform(
          new AsemicPt(this.parser, ...this.parser.parsing.evalPoint(notation)),
          { relative: forceRelative, randomize }
        )
      }
    }

    if (save) this.parser.lastPoint = point
    return point
  }

  parseArgs(args: string[]) {
    this.parser.progress.point = 0
    const startPoint = this.parsePoint(args[0], { randomize: true })
    this.parser.progress.point = 1
    const endPoint = this.parsePoint(args[1], { randomize: true })

    this.parser.transformMethods.reverseTransform(startPoint)
    this.parser.transformMethods.reverseTransform(endPoint)

    let h = 0,
      w = 0
    if (args.length >= 3) {
      const hwParts = this.parser.parsing.tokenize(args[2], {
        separatePoints: true
      })
      h = this.parser.expressions.expr(hwParts[0])!
      w = hwParts.length > 1 ? this.parser.expressions.expr(hwParts[1])! : 0
    }

    return [startPoint, endPoint, h, w] as [AsemicPt, AsemicPt, number, number]
  }

  evalPoint<K extends boolean>(
    thisPoint: string | BasicPt,
    {
      basic = false as any,
      defaultY = 0
    }: { basic?: K; defaultY?: number } = {} as any
  ): K extends true ? BasicPt : AsemicPt {
    let result: BasicPt | AsemicPt
    if (thisPoint instanceof BasicPt)
      return (
        basic ? thisPoint : new AsemicPt(this.parser, thisPoint.x, thisPoint.y)
      ) as K extends true ? BasicPt : AsemicPt
    let point = thisPoint as string

    if (point === '<') {
      return this.parser.transformMethods.reverseTransform(
        this.parser.lastPoint.clone(basic)
      ) as K extends true ? BasicPt : AsemicPt
    }
    if (point.startsWith('(') && point.endsWith(')')) {
      const sliced = point.substring(1, point.length - 1)
      const tokens = this.parser.parsing.tokenize(sliced)
      if (tokens.length > 1) {
        for (let key in this.parser.pointConstants) {
          if (tokens[0] === key) {
            result = (
              basic
                ? this.parser.pointConstants[tokens[0]](...tokens.slice(1))
                : new AsemicPt(
                    this.parser,
                    ...this.parser.pointConstants[tokens[0]](...tokens.slice(1))
                  )
            ) as K extends true ? BasicPt : AsemicPt
            break
          }
        }
      }
    } else if (point.startsWith('@')) {
      const [theta, radius] = this.parser.parsing
        .tokenize(point.slice(1), {
          separatePoints: true
        })
        .map((X: string) => this.parser.expressions.expr(X))
      result = (
        basic
          ? new BasicPt(radius, 0).rotate(theta)
          : new AsemicPt(this.parser, radius, 0).rotate(theta)
      ) as K extends true ? BasicPt : AsemicPt
    }
    if (point.includes('[')) {
      const start = point.indexOf('[') + 1
      const end = point.indexOf(']')
      const tokenized = this.parser.parsing
        .tokenize(point.substring(start, end), { separatePoints: true })
        .map(
          (x: string) =>
            point.substring(0, start - 1) + x + point.substring(end + 1)
        )
      point = tokenized.join(',')
    }

    if (!result!) {
      // try {
      const parts = this.parser.parsing.tokenize(point, {
        separatePoints: true
      })
      if (parts.length === 1) {
        const coord = this.parser.expressions.expr(parts[0])!
        result = (
          basic
            ? new BasicPt(coord, defaultY || coord)
            : new AsemicPt(this.parser, coord, defaultY || coord)
        ) as K extends true ? BasicPt : AsemicPt
      } else {
        const coords = parts.map(
          (x: string) => this.parser.expressions.expr(x)!
        )
        result = (
          basic
            ? new BasicPt(coords[0], coords[1])
            : new AsemicPt(this.parser, ...coords)
        ) as K extends true ? BasicPt : AsemicPt
      }
      // } catch (e: any) {
      //   throw new Error(`Failed to evaluate point: ${point}\n${e.message}`)
      // }
    }

    return result as K extends true ? BasicPt : AsemicPt
  }

  group(
    settings: AsemicGroup['settings'] | string = {
      mode: 'line',
      curve: 'true',
      vert: '0,0',
      count: 100,
      correction: 0,
      close: false
    }
  ) {
    if (typeof settings === 'string') {
      settings = parserObject(this.parser, settings, {
        curve: 'boolean',
        count: 'number',
        correction: 'number',
        close: 'boolean'
      }) as AsemicGroup['settings']
    }
    const group = new AsemicGroup(this.parser, settings)
    if (group.settings.texture) {
      if (
        this.parser.images[this.parser.data.resolveName(group.settings.texture)]
      ) {
        group.imageDatas =
          this.parser.images[
            this.parser.data.resolveName(group.settings.texture)
          ]
        group.xy = this.parser.parsing.evalPoint(group.settings.xy ?? '0,0')
        group.wh = this.parser.parsing.evalPoint(group.settings.wh ?? '1,1')
      } else {
        throw new Error(`No texture available for ${group.settings.texture}`)
      }
    }
    this.parser.groups.push(group)

    return this.parser
  }

  end({ close = false } = {}) {
    if (this.parser.currentCurve.length < 2)
      throw new Error('Cannot end a curve with less than 2 points')
    if (this.parser.groups.length === 0) {
      this.parser.groups.push(new AsemicGroup(this.parser, { mode: 'line' }))
    }
    if (close) {
      this.parser.currentCurve.push(this.parser.currentCurve[0].clone(true))
    }
    this.parser.groups[this.parser.groups.length - 1].addCurve(
      this.parser.currentCurve
    )
    this.parser.currentCurve = []
    this.parser.progress.point = 0
    this.parser.adding = 0
    return this.parser
  }

  points(token: string, { chopFirst = false } = {}) {
    const pointsTokens = this.parser.parsing.tokenize(token)

    let totalLength =
      pointsTokens.filter((x: string) => !x.startsWith('{') && x !== '<')
        .length - 1 || 1

    const originalEnd = this.parser.adding
    this.parser.adding += totalLength
    pointsTokens.forEach((pointToken: string, i: number) => {
      if (chopFirst && i === 0) {
        return
      }
      if (pointToken === '<') {
        return
      }
      if (pointToken.startsWith('{')) {
        this.parser.transformMethods.to(pointToken.slice(1, -1))
        return
      } else {
        this.parser.progress.point = (originalEnd + i) / this.parser.adding

        const point = this.parsePoint(pointToken)

        this.parser.currentCurve.push(point)
        return
      }
    })
    return this.parser
  }

  // Clear caches when needed (call this periodically or when memory is needed)
  clearCaches() {
    this.tokenizeCache.clear()
    this.regexCache.clear()
  }

  // Get cache statistics for monitoring
  getCacheStats() {
    return {
      tokenizeCache: this.tokenizeCache.size,
      regexCache: this.regexCache.size
    }
  }
}
