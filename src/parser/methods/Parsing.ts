import { AsemicPt, BasicPt } from '../../blocks/AsemicPt'
import { splitString } from '../../settings'
import { AsemicGroup } from '../core/AsemicGroup'

export class ParsingMethods {
  parser: any

  // Performance caches
  private tokenizeCache = new Map<string, string[]>()
  private regexCache = new Map<string, RegExp>()

  // Pre-compiled regex patterns
  private static readonly COMMENT_REGEX = /^\s*\/\/.*/gm
  private static readonly WHITESPACE_REGEX = /^\s/
  private static readonly COMMA_REGEX = /^\,/
  private static readonly UNDERSCORE_REGEX = /^\_/
  private static readonly SEMICOLON_REGEX = /^\;/

  // Object pool for BasicPt to reduce allocations
  private basicPtPool: BasicPt[] = []

  constructor(parser: any) {
    this.parser = parser
  }

  private getBasicPt(x: number, y: number): BasicPt {
    const pt = this.basicPtPool.pop() || new BasicPt(0, 0)
    pt.x = x
    pt.y = y
    return pt
  }

  private releaseBasicPt(pt: BasicPt): void {
    if (this.basicPtPool.length < 100) {
      // Limit pool size
      this.basicPtPool.push(pt)
    }
  }

  private getCachedRegex(pattern: string): RegExp {
    if (!this.regexCache.has(pattern)) {
      this.regexCache.set(pattern, new RegExp(pattern))
    }
    return this.regexCache.get(pattern)!
  }

  parse(text: string, args: string[] = []) {
    // Optimize argument replacement
    if (args.length > 0) {
      for (let i = 0; i < args.length; i++) {
        text = text.replaceAll(`$${i}`, args[i])
      }
    }

    text = text.replaceAll(ParsingMethods.COMMENT_REGEX, '').trim()

    // Use cached tokenization if available
    const cacheKey = `parse:${text}`
    let tokenization: string[]
    if (this.tokenizeCache.has(cacheKey)) {
      tokenization = this.tokenizeCache.get(cacheKey)!
    } else {
      tokenization = this.parser.tokenize(text)
      this.tokenizeCache.set(cacheKey, tokenization)
    }

    for (let token of tokenization) {
      let sliced = token.substring(1, token.length - 1)
      switch (token[0]) {
        case '/':
          this.parser.regex(sliced)
          break
        case '"':
          this.parser.text(sliced)
          break
        case '(':
          const [functionCall, funcArgs] = splitString(sliced, /\s/)
          if (!this.parser.curveConstants[functionCall]) {
            throw new Error(`Unknown function: ${functionCall}`)
          }
          this.parser.curveConstants[functionCall](funcArgs)
          break
        case '{':
          this.parser.to(sliced)
          break
        case '[':
          this.parser.line(sliced)
          break
      }
    }

    return this.parser
  }

  tokenize(
    source: string,
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

    let isEscaped = false
    const sourceLength = source.length
    for (let i = 0; i < sourceLength; i++) {
      const char = source[i]

      if (isEscaped) {
        isEscaped = false
        continue
      }
      switch (char) {
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
      const hasTotalBrackets = inBraces + inParentheses + inBrackets > 0
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
        point = this.parser.applyTransform(
          this.parser.evalPoint(notation.substring(1), { basic: false }),
          {
            relative: true,
            randomize
          }
        )
      } else {
        // Absolute coordinates: x,y
        point = this.parser.applyTransform(
          new AsemicPt(this.parser, ...this.parser.evalPoint(notation)),
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

    this.parser.reverseTransform(startPoint)
    this.parser.reverseTransform(endPoint)

    let h = 0,
      w = 0
    if (args.length >= 3) {
      const hwParts = this.parser.tokenize(args[2], { separatePoints: true })
      h = this.parser.expr(hwParts[0])!
      w = hwParts.length > 1 ? this.parser.expr(hwParts[1])! : 0
    }

    return [startPoint, endPoint, h, w] as [AsemicPt, AsemicPt, number, number]
  }

  evalPoint<K extends boolean>(
    point: string,
    { basic = false as any }: { basic?: K } = {} as any
  ): K extends true ? BasicPt : AsemicPt {
    let result: BasicPt | AsemicPt

    if (point.startsWith('(') && point.endsWith(')')) {
      const sliced = point.substring(1, point.length - 1)
      const tokens = this.parser.tokenize(sliced)
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
      const [theta, radius] = this.parser
        .tokenize(point.slice(1), {
          separatePoints: true
        })
        .map((X: string) => this.parser.expr(X))
      result = (
        basic
          ? this.getBasicPt(radius, 0).rotate(theta)
          : new AsemicPt(this.parser, radius, 0).rotate(theta)
      ) as K extends true ? BasicPt : AsemicPt
    } else if (point.startsWith('<')) {
      const groupIndex = this.parser.groups.length - 1
      let [pointN, thisN = -1] = this.parser.tokenize(point.slice(1), {
        separatePoints: true
      })
      const exprN = this.parser.expr(thisN)
      const lastCurve =
        this.parser.groups[groupIndex][
          exprN < 0 ? this.parser.groups[groupIndex].length + exprN : exprN
        ]
      const count = Math.floor(
        this.parser.expr(pointN) * (lastCurve.length - 1)
      )
      if (!lastCurve) throw new Error(`No curve at ${exprN}`)
      if (!lastCurve[count])
        throw new Error(
          `No point at curve ${lastCurve} point ${count} (${lastCurve.length} long)`
        )

      return this.parser.reverseTransform(lastCurve[count].clone())
    } else if (point.startsWith('[')) {
      const end = point.indexOf(']')
      point = this.parser
        .tokenize(point.substring(1, end), { separatePoints: true })
        .map((x: string) => x.trim() + point.substring(end + 1))
        .join(',')
    }

    if (!result!) {
      try {
        const parts = this.parser.tokenize(point, { separatePoints: true })
        if (parts.length === 1) {
          const coord = this.parser.expr(parts[0])!
          result = (
            basic
              ? this.getBasicPt(coord, coord)
              : new AsemicPt(this.parser, coord, coord)
          ) as K extends true ? BasicPt : AsemicPt
        } else {
          const coords = parts.map((x: string) => this.parser.expr(x)!)
          result = (
            basic
              ? this.getBasicPt(coords[0], coords[1])
              : new AsemicPt(this.parser, ...coords)
          ) as K extends true ? BasicPt : AsemicPt
        }
      } catch (e: any) {
        throw new Error(`Failed to evaluate point: ${point}\n${e.message}`)
      }
    }

    return result as K extends true ? BasicPt : AsemicPt
  }

  group(settings: AsemicGroup['settings']) {
    const group = new AsemicGroup(this.parser, settings)
    if (group.settings.texture) {
      if (this.parser.images[this.parser.resolveName(group.settings.texture)]) {
        group.imageDatas =
          this.parser.images[this.parser.resolveName(group.settings.texture)]
        group.xy = this.parser.evalPoint(group.settings.xy ?? '0,0')
        group.wh = this.parser.evalPoint(group.settings.wh ?? '1,1')
      } else {
        this.parser.error(`No texture available for ${group.settings.texture}`)
      }
    }
    this.parser.groups.push(group)

    return this.parser
  }

  end() {
    if (this.parser.currentCurve.length === 0) return this.parser
    if (this.parser.currentCurve.length === 2) {
      this.parser.progress.point = 0.5
      const p1 = this.parser.currentCurve[0]
      const p2 = this.parser.currentCurve[1]
      const interpolated = p1.clone().lerp(p2, 0.5)
      this.parser.currentCurve.splice(1, 0, interpolated)
    }
    if (this.parser.groups.length === 0) {
      this.parser.groups.push(new AsemicGroup(this.parser, { mode: 'line' }))
    }
    this.parser.groups[this.parser.groups.length - 1].addCurve(
      this.parser.currentCurve
    )
    this.parser.currentCurve = []
    this.parser.progress.point = 0
    this.parser.adding = 0
    return this.parser
  }

  points(token: string) {
    const pointsTokens = this.parser.tokenize(token)

    let totalLength =
      pointsTokens.filter((x: string) => !x.startsWith('{')).length - 1 || 1

    const originalEnd = this.parser.adding
    this.parser.adding += totalLength
    pointsTokens.forEach((pointToken: string, i: number) => {
      if (pointToken.startsWith('{')) {
        this.parser.to(pointToken.slice(1, -1))
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
    this.basicPtPool.length = 0
  }

  // Get cache statistics for monitoring
  getCacheStats() {
    return {
      tokenizeCache: this.tokenizeCache.size,
      regexCache: this.regexCache.size,
      basicPtPool: this.basicPtPool.length
    }
  }
}
