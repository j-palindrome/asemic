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
  private static readonly KEY_CALL_REGEX = /^([a-z]+)\=(.+)/

  constructor(parser: Parser) {
    this.parser = parser
  }

  private getCachedRegex(pattern: string): RegExp {
    if (!this.regexCache.has(pattern)) {
      this.regexCache.set(pattern, new RegExp(pattern))
    }
    return this.regexCache.get(pattern)!
  }

  to(token: string) {
    this.parseTransform(token, { thisTransform: this.parser.currentTransform })
    return this.parser
  }

  parseTransform(token: string, { thisTransform = defaultTransform() } = {}) {
    token = token.trim()
    const transforms = this.parser.tokenize(token)

    transforms.forEach((transform: string) => {
      if (transform.startsWith('<')) {
        if (transform.slice(1)) {
          const name = transform.slice(1)
          Object.assign(thisTransform, this.parser.namedTransforms[name])
        } else {
          Object.assign(thisTransform, this.parser.transformStack.pop())
        }
      } else if (transform.startsWith('>')) {
        if (transform.slice(1)) {
          const name = transform.slice(1)
          this.parser.namedTransforms[name] = cloneTransform(thisTransform)
        }
        this.parser.transformStack.push(cloneTransform(thisTransform))
      } else if (transform === '!') {
        // Reset all transformations
        thisTransform.scale.set([1, 1])
        thisTransform.translation.set([0, 0])
        thisTransform.rotation = 0
        thisTransform.a = '1'
        thisTransform.h = '0'
        thisTransform.s = '0'
        thisTransform.l = '1'
        thisTransform.width = '1'
        thisTransform.add = undefined
        thisTransform.rotate = undefined
      } else if (transform.startsWith('*<')) {
        const lastTransform = last(this.parser.transformStack) as
          | Transform
          | undefined
        thisTransform.scale.set(lastTransform?.scale ?? [1, 1])
      } else if (transform.startsWith('+<')) {
        const lastTransform = last(this.parser.transformStack) as
          | Transform
          | undefined
        thisTransform.translation.set(lastTransform?.translation ?? [0, 0])
      } else if (transform.startsWith('@<')) {
        const lastTransform = last(this.parser.transformStack) as
          | Transform
          | undefined
        thisTransform.rotation = lastTransform?.rotation ?? 0
      } else if (transform.startsWith('*!')) {
        // Reset scale
        thisTransform.scale.set([1, 1])
      } else if (transform.startsWith('@!')) {
        // Reset rotation
        thisTransform.rotation = 0
      } else if (transform.startsWith('+!')) {
        // Reset translation
        thisTransform.translation.set([0, 0])
      } else if (transform.startsWith('+=>')) {
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
        const match = transform.match(TransformMethods.TRANSLATION_REGEX)
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
          const key = keyCall[1]
          const value = keyCall[2]
          switch (key) {
            case 'width':
            case 'w':
            case 'wid':
              thisTransform.width = value
              break
            default:
              if (value.includes(',')) {
                thisTransform[key] = this.parser.evalPoint(value, {
                  basic: true
                })
              } else {
                thisTransform[key] = value
              }
              break
          }
        }
      }
    })

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
