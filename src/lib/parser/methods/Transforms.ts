import { last } from 'lodash'
import { Parser, Transform } from '../../types'
import { defaultTransform, cloneTransform } from '../core/Transform'

export class TransformMethods {
  parser: Parser

  // Performance caches
  private regexCache = new Map<string, RegExp>()
  private static readonly KEY_CALL_REGEX = /^([a-zA-Z0-9_]+)(\=[\>\|]?)(.+)/

  constructor(parser: Parser) {
    this.parser = parser
  }

  to(token: string) {
    this.parseTransform(token, { thisTransform: this.parser.currentTransform })
    return this.parser
  }

  parseTransform(token: string, { thisTransform = defaultTransform() } = {}) {
    token = token.trim()
    const transforms = this.parser.tokenize(token)

    for (let transform of transforms) {
      // Check for special character prefixes first
      const firstChar = transform[0]
      const restOfTransform = transform.slice(1)

      switch (firstChar) {
        case '<':
          if (restOfTransform) {
            Object.assign(
              thisTransform,
              this.parser.namedTransforms[restOfTransform]
            )
          } else {
            Object.assign(thisTransform, this.parser.transformStack.pop())
          }
          break

        case '>':
          if (restOfTransform) {
            this.parser.namedTransforms[restOfTransform] =
              cloneTransform(thisTransform)
          } else {
            this.parser.transformStack.push(cloneTransform(thisTransform))
          }
          break

        default:
          if (transform.match(/^[\*\+@w]</)) {
            const [preTransform, namedTransform] = transform.split('<')
            const targetTransform = namedTransform
              ? this.parser.namedTransforms[namedTransform]
              : last(this.parser.transformStack)
            if (!targetTransform) {
              throw new Error(
                `No transform found for reference: ${namedTransform}`
              )
            }
            switch (preTransform) {
              case '*':
                thisTransform['*'].set(targetTransform['*'] ?? [1, 1])
                break

              case '+':
                thisTransform['+'].set(targetTransform['+'] ?? [0, 0])
                break

              case '@':
                thisTransform['@'] = targetTransform['@'] ?? 0
                break

              case 'w':
                thisTransform.w = targetTransform.w ?? 1
                break

              default:
                thisTransform[preTransform] = targetTransform[preTransform]
                break
            }
          } else {
            // Handle multi-character tokens and regex matches
            switch (transform) {
              case '!':
                // Reset all transformations
                thisTransform['*'].set([1, 1])
                thisTransform['+'].set([0, 0])
                thisTransform['@'] = 0
                thisTransform.a = 1
                thisTransform.h = 0
                thisTransform.s = 0
                thisTransform.l = 1
                thisTransform.w = 1
                thisTransform.add = undefined
                thisTransform.rotate = undefined
                break

              case '*!':
                // Reset scale
                thisTransform['*'].set([1, 1])
                break

              case '@!':
                // Reset rotation
                thisTransform['@'] = 0
                break

              case '+!':
                // Reset translation
                thisTransform['+'].set([0, 0])
                break

              default:
                // Handle regex patterns and key-value pairs
                if (transform.startsWith('+=>')) {
                  thisTransform.add = transform.substring(3)
                } else if (transform.startsWith('@=>')) {
                  thisTransform.rotate = transform.substring(3)
                } else if (transform.startsWith('*')) {
                  // Scale - use pre-compiled regex

                  thisTransform['*'].scale(
                    this.parser.evalPoint(transform.slice(1))
                  )
                } else if (transform.startsWith('@')) {
                  // Rotation - use pre-compiled regex

                  thisTransform['@'] += this.parser.expr(transform.slice(1))!
                } else if (transform.startsWith('+')) {
                  // Translation - use pre-compiled regex
                  thisTransform['+'].add(
                    this.parser
                      .evalPoint(transform.slice(1))
                      .scale(thisTransform['*'])
                      .rotate(thisTransform['@'])
                  )
                } else {
                  const keyCall = transform.match(
                    TransformMethods.KEY_CALL_REGEX
                  )
                  if (keyCall) {
                    let key = keyCall[1]
                    const value = keyCall[3]
                    const expression = keyCall[2] // '=' or '=>'
                    if (['h', 's', 'l', 'a', 'w'].includes(key)) {
                      if (expression.includes('>')) {
                        thisTransform[key] = () => this.parser.expr(value)
                      } else {
                        thisTransform[key] = this.parser.expr(value)
                      }
                    } else {
                      switch (expression) {
                        case '=':
                          this.parser.def(key, value, { isStatic: true })
                          break
                        case '=>':
                          this.parser.def(key, value)
                          break
                      }
                    }
                  }
                }
                break
            }
          }

          break
      }
    }

    return thisTransform
  }

  applyTransform = (
    point: any,
    {
      relative = false,
      randomize = true,
      transform = this.parser.currentTransform
    } = {}
  ): any => {
    point.scale(transform['*']).rotate(transform['@'])

    if (transform.rotate !== undefined && randomize) {
      point.rotate(this.parser.expr(transform.rotate))
    }
    if (transform.add !== undefined && randomize) {
      point.add(
        this.parser
          .evalPoint(transform.add)
          .scale(transform['*'])
          .rotate(transform['@'])
      )
    }
    point.add(relative ? this.parser.lastPoint : transform['+'])
    return point
  }

  reverseTransform = (
    point: any,
    { randomize = true, transform = this.parser.currentTransform } = {}
  ): any => {
    point.subtract(transform['+'])
    if (transform.add !== undefined && randomize) {
      const addPoint = this.parser.evalPoint(transform.add)
      addPoint.scale(transform['*'])
      point.subtract(addPoint)
    }
    if (transform.rotate !== undefined && randomize) {
      point.rotate(this.parser.expr(transform.rotate) * -1)
    }
    point.divide(transform['*']).rotate(transform['@'] * -1)
    return point
  }

  // Clear caches when needed
  clearCaches() {
    this.regexCache.clear()
  }

  // Get cache statistics for monitoring
  getCacheStats() {
    return {
      regexCache: this.regexCache.size
    }
  }
}
