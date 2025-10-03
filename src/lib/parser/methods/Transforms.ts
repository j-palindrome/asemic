import { last } from 'lodash'
import { Parser, Transform } from '../../types'
import { TransformAliases } from '../constants/Aliases'
import { defaultTransform, cloneTransform } from '../core/Transform'

export class TransformMethods {
  parser: Parser

  // Performance caches
  private regexCache = new Map<string, RegExp>()

  // Pre-compiled regex patterns for common transform operations
  private static readonly SCALE_REGEX = new RegExp(
    `^(${TransformAliases.scale.join('|')})(.+)`
  )
  private static readonly ROTATION_REGEX = new RegExp(
    `^(${TransformAliases.rotation.join('|')})(.+)`
  )
  private static readonly TRANSLATION_REGEX = new RegExp(
    `^(${TransformAliases.translation.join('|')})(.+)`
  )
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
          // Handle multi-character tokens and regex matches
          switch (transform) {
            case '!':
              // Reset all transformations
              thisTransform.scale.set([1, 1])
              thisTransform.translation.set([0, 0])
              thisTransform.rotation = 0
              thisTransform.a = 1
              thisTransform.h = 0
              thisTransform.s = 0
              thisTransform.l = 1
              thisTransform.width = 1
              thisTransform.add = undefined
              thisTransform.rotate = undefined
              break

            case '*<':
              const lastTransformScale = last(this.parser.transformStack) as
                | Transform
                | undefined
              thisTransform.scale.set(lastTransformScale?.scale ?? [1, 1])
              break

            case '+<':
              const lastTransformTranslation = last(
                this.parser.transformStack
              ) as Transform | undefined
              thisTransform.translation.set(
                lastTransformTranslation?.translation ?? [0, 0]
              )
              break

            case '@<':
              const lastTransformRotation = last(this.parser.transformStack) as
                | Transform
                | undefined
              thisTransform.rotation = lastTransformRotation?.rotation ?? 0
              break

            case '*!':
              // Reset scale
              thisTransform.scale.set([1, 1])
              break

            case '@!':
              // Reset rotation
              thisTransform.rotation = 0
              break

            case '+!':
              // Reset translation
              thisTransform.translation.set([0, 0])
              break

            default:
              // Handle regex patterns and key-value pairs
              if (transform.startsWith('+=>')) {
                thisTransform.add = transform.substring(3)
              } else if (transform.startsWith('@=>')) {
                thisTransform.rotate = transform.substring(3)
              } else if (transform.match(TransformMethods.SCALE_REGEX)) {
                // Scale - use pre-compiled regex
                const match = transform.match(TransformMethods.SCALE_REGEX)
                if (match) {
                  thisTransform.scale.scale(this.parser.evalPoint(match[2]))
                }
              } else if (transform.match(TransformMethods.ROTATION_REGEX)) {
                // Rotation - use pre-compiled regex
                const match = transform.match(TransformMethods.ROTATION_REGEX)
                if (match) {
                  thisTransform.rotation += this.parser.expr(match[2])!
                }
              } else if (transform.match(TransformMethods.TRANSLATION_REGEX)) {
                // Translation - use pre-compiled regex
                const match = transform.match(
                  TransformMethods.TRANSLATION_REGEX
                )
                if (match) {
                  thisTransform.translation.add(
                    this.parser
                      .evalPoint(match[2])
                      .scale(thisTransform.scale)
                      .rotate(thisTransform.rotation)
                  )
                }
              } else {
                const keyCall = transform.match(TransformMethods.KEY_CALL_REGEX)
                if (keyCall) {
                  let key = keyCall[1]
                  const value = keyCall[3]
                  const expression = keyCall[2] // '=' or '=>'
                  if (['h', 's', 'l', 'a', 'w'].includes(key)) {
                    if (key === 'w') key = 'width'
                    if (expression.includes('>')) {
                      thisTransform[key] = () => this.parser.expr(value)
                    } else {
                      thisTransform[key] = this.parser.expr(value)
                    }
                  } else {
                    switch (expression) {
                      case '=':
                        this.parser.defStatic(key, value)
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
    point.scale(transform.scale).rotate(transform.rotation)

    if (transform.rotate !== undefined && randomize) {
      point.rotate(this.parser.expr(transform.rotate))
    }
    if (transform.add !== undefined && randomize) {
      point.add(
        this.parser
          .evalPoint(transform.add)
          .scale(transform.scale)
          .rotate(transform.rotation)
      )
    }
    point.add(relative ? this.parser.lastPoint : transform.translation)
    return point
  }

  reverseTransform = (
    point: any,
    { randomize = true, transform = this.parser.currentTransform } = {}
  ): any => {
    point.subtract(transform.translation)
    if (transform.add !== undefined && randomize) {
      const addPoint = this.parser.evalPoint(transform.add)
      addPoint.scale(transform.scale)
      point.subtract(addPoint)
    }
    if (transform.rotate !== undefined && randomize) {
      point.rotate(this.parser.expr(transform.rotate) * -1)
    }
    point.divide(transform.scale).rotate(transform.rotation * -1)
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
