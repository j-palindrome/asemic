import { last } from 'lodash'
import { Parser, Transform } from '../../../src/lib/types'
import { cloneTransform } from '../core/Transform'
import { BasicPt } from '@/lib/blocks/AsemicPt'

export class TransformMethods {
  parser: Parser

  // Performance caches
  private regexCache = new Map<string, RegExp>()
  private static readonly KEY_CALL_REGEX = /^([a-zA-Z0-9_]+)(\|?\=[\>\|]?)(.+)/

  constructor(parser: Parser) {
    this.parser = parser
  }

  defaultTransform: () => Transform = () => ({
    '+': new BasicPt(0, 0),
    '*': new BasicPt(1, 1),
    '@': 0,
    w: this.parser.expressions.expr('px1'),
    h: 0,
    s: 0,
    l: 1,
    a: 1
  })

  to(token: string) {
    this.parseTransform(token, { thisTransform: this.parser.currentTransform })
    return this.parser
  }

  remap(origin: string, x1y0: string, targetHeight: string | number) {
    const p0 = this.parser.parsing.parsePoint(origin)
    const p1 = this.parser.parsing.parsePoint(x1y0)
    const rotation = p1.clone().subtract(p0).angle0to1()
    const scale = p1.clone().subtract(p0).magnitude()
    const position = p0.clone()
    this.parser.currentTransform['@'] = rotation
    this.parser.currentTransform['*'].set([
      scale,
      targetHeight
        ? this.parser.expressions.expr(targetHeight) *
          this.parser.currentTransform['*'][0]
        : scale
    ])
    this.parser.currentTransform['+'].set([position.x, position.y])
    return this.parser
  }

  parseTransform(
    token: string,
    { thisTransform = this.defaultTransform() } = {}
  ) {
    token = token.trim()
    const transforms = this.parser.parsing.tokenize(token)

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
                const newTransform = this.defaultTransform()
                // Reset all transformations
                thisTransform['*'].set([1, 1])
                thisTransform['+'].set([0, 0])
                thisTransform['@'] = 0
                thisTransform.a = 1
                thisTransform.h = 0
                thisTransform.s = 0
                thisTransform.l = 1
                thisTransform.w = this.parser.expressions.expr('px1')
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
                    this.parser.parsing.evalPoint(transform.slice(1))
                  )
                } else if (transform.startsWith('@')) {
                  // Rotation - use pre-compiled regex

                  thisTransform['@'] += this.parser.expressions.expr(
                    transform.slice(1)
                  )!
                } else if (transform.startsWith('+')) {
                  // Translation - use pre-compiled regex
                  thisTransform['+'].add(
                    this.parser.parsing
                      .evalPoint(transform.slice(1))
                      .scale(thisTransform['*'])
                      .rotate(thisTransform['@'])
                  )
                } else {
                  const keyCall = transform.match(
                    TransformMethods.KEY_CALL_REGEX
                  )
                  if (keyCall) {
                    const key = keyCall[1]
                    const value = keyCall[3]
                    const expression = keyCall[2] // '=', '=>', '|=', '|=>'

                    if (['h', 's', 'l', 'a', 'w'].includes(key)) {
                      if (expression.includes('>')) {
                        thisTransform[key] = () =>
                          this.parser.expressions.expr(value)
                      } else {
                        thisTransform[key] = this.parser.expressions.expr(value)
                      }
                    } else {
                      const isStatic = !expression.includes('>')
                      if (this.parser.reservedConstants.includes(key)) {
                        throw new Error(`Reserved constant: ${key}`)
                      }

                      const values = this.parser.parsing.tokenize(value, {
                        separatePoints: true
                      })
                      if (values.length > 1) {
                        if (isStatic) {
                          const solvedValues = values.map(x =>
                            this.parser.expressions.expr(x)
                          )
                          this.parser.constants[key] = i =>
                            solvedValues[
                              Math.floor(this.parser.expressions.expr(i))
                            ]
                        } else {
                          // Capture values array in closure
                          const capturedValues = [...values]
                          this.parser.constants[key] = i =>
                            this.parser.expressions.expr(
                              capturedValues[
                                Math.floor(this.parser.expressions.expr(i))
                              ]
                            )
                        }
                      } else {
                        if (isStatic) {
                          const solvedDefinition =
                            this.parser.expressions.expr(value)
                          this.parser.constants[key] = () => solvedDefinition
                        } else {
                          // Capture value in closure
                          const capturedValue = value
                          this.parser.constants[key] = () =>
                            this.parser.expressions.expr(capturedValue)
                        }
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
      point.rotate(this.parser.expressions.expr(transform.rotate))
    }
    if (transform.add !== undefined && randomize) {
      point.add(
        this.parser.parsing
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
      const addPoint = this.parser.parsing.evalPoint(transform.add)
      addPoint.scale(transform['*'])
      point.subtract(addPoint)
    }
    if (transform.rotate !== undefined && randomize) {
      point.rotate(this.parser.expressions.expr(transform.rotate) * -1)
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
