/**
 * Expression Evaluator for AssemblyScript
 *
 * Handles mathematical expression evaluation with WASM-optimized performance
 */

import { Point, Progress } from './types'

/** Math constants */
const PHI: f64 = 1.6180339887
const TWO_PI: f64 = Math.PI * 2

/** Simple expression parser state */
class ExprParser {
  pos: i32
  text: string

  constructor(text: string) {
    this.text = text
    this.pos = 0
  }

  peek(): string {
    if (this.pos >= this.text.length) return '\0'
    return this.text.charAt(this.pos)
  }

  next(): string {
    const ch = this.peek()
    this.pos++
    return ch
  }

  skipWhitespace(): void {
    while (this.peek() === ' ' || this.peek() === '\t') {
      this.next()
    }
  }
}

/** Expression evaluator with progress context */
export class ExpressionEvaluator {
  progress: Progress
  accumulators: Float64Array
  noiseIndex: i32
  groupCount: i32
  width: f64
  height: f64

  constructor() {
    this.progress = new Progress()
    this.accumulators = new Float64Array(64) // Max 64 accumulators
    this.noiseIndex = 0
    this.groupCount = 0
    this.width = 1920
    this.height = 1080
  }

  /** Evaluate a numeric expression */
  eval(expr: string): f64 {
    // Handle simple cases first (optimization)
    const trimmed = expr.trim()

    // Try parsing as direct number
    const num = parseFloat(trimmed)
    if (!isNaN(num)) {
      return num
    }

    // Parse complex expression
    const parser = new ExprParser(trimmed)
    return this.parseExpression(parser)
  }

  /** Parse addition/subtraction */
  private parseExpression(parser: ExprParser): f64 {
    let left = this.parseTerm(parser)

    parser.skipWhitespace()
    while (parser.peek() === '+' || parser.peek() === '-') {
      const op = parser.next()
      parser.skipWhitespace()
      const right = this.parseTerm(parser)

      if (op === '+') {
        left += right
      } else {
        left -= right
      }
      parser.skipWhitespace()
    }

    return left
  }

  /** Parse multiplication/division/modulo */
  private parseTerm(parser: ExprParser): f64 {
    let left = this.parseFactor(parser)

    parser.skipWhitespace()
    while (
      parser.peek() === '*' ||
      parser.peek() === '/' ||
      parser.peek() === '%'
    ) {
      const op = parser.next()
      parser.skipWhitespace()
      const right = this.parseFactor(parser)

      if (op === '*') {
        left *= right
      } else if (op === '/') {
        left /= right
      } else {
        left = left % right
      }
      parser.skipWhitespace()
    }

    return left
  }

  /** Parse power/exponentiation */
  private parseFactor(parser: ExprParser): f64 {
    let left = this.parseUnary(parser)

    parser.skipWhitespace()
    if (parser.peek() === '^') {
      parser.next()
      parser.skipWhitespace()
      const right = this.parseFactor(parser) // Right associative
      left = Math.pow(left, right)
    }

    return left
  }

  /** Parse unary operators and atoms */
  private parseUnary(parser: ExprParser): f64 {
    parser.skipWhitespace()

    // Unary minus
    if (parser.peek() === '-') {
      parser.next()
      return -this.parseUnary(parser)
    }

    // Unary plus
    if (parser.peek() === '+') {
      parser.next()
      return this.parseUnary(parser)
    }

    return this.parseAtom(parser)
  }

  /** Parse atoms (numbers, functions, constants, parentheses) */
  private parseAtom(parser: ExprParser): f64 {
    parser.skipWhitespace()

    // Parentheses
    if (parser.peek() === '(') {
      parser.next()
      const result = this.parseExpression(parser)
      parser.skipWhitespace()
      if (parser.peek() === ')') {
        parser.next()
      }
      return result
    }

    // Try to parse number
    const start = parser.pos
    let hasDigit = false
    let hasDot = false

    while (true) {
      const ch = parser.peek()
      if (ch >= '0' && ch <= '9') {
        hasDigit = true
        parser.next()
      } else if (ch === '.' && !hasDot) {
        hasDot = true
        parser.next()
      } else {
        break
      }
    }

    if (hasDigit) {
      const numStr = parser.text.substring(start, parser.pos)
      return parseFloat(numStr)
    }

    // Parse identifier (function or constant)
    return this.parseIdentifier(parser)
  }

  /** Parse identifier (constants or functions) */
  private parseIdentifier(parser: ExprParser): f64 {
    const start = parser.pos

    while (true) {
      const ch = parser.peek()
      if (
        (ch >= 'a' && ch <= 'z') ||
        (ch >= 'A' && ch <= 'Z') ||
        (ch >= '0' && ch <= '9') ||
        ch === '_'
      ) {
        parser.next()
      } else {
        break
      }
    }

    const ident = parser.text.substring(start, parser.pos)
    parser.skipWhitespace()

    // Check for function call
    if (parser.peek() === '(') {
      return this.parseFunction(ident, parser)
    }

    // Return constant value
    return this.getConstant(ident)
  }

  /** Parse function call */
  private parseFunction(name: string, parser: ExprParser): f64 {
    parser.next() // Skip '('
    parser.skipWhitespace()

    // Parse arguments
    const args: f64[] = []

    if (parser.peek() !== ')') {
      while (true) {
        args.push(this.parseExpression(parser))
        parser.skipWhitespace()

        if (parser.peek() === ',') {
          parser.next()
          parser.skipWhitespace()
        } else {
          break
        }
      }
    }

    if (parser.peek() === ')') {
      parser.next()
    }

    // Call function
    return this.callFunction(name, args)
  }

  /** Get constant value */
  private getConstant(name: string): f64 {
    // Single-letter constants
    if (name === 'I') {
      return this.progress.index0
    }
    if (name === 'N') {
      return this.progress.count0
    }
    if (name === 'P') {
      return this.progress.point
    }
    if (name === 'C') {
      return this.groupCount
    }
    if (name === 'L') {
      return this.progress.letter
    }
    if (name === 'T') {
      return this.progress.time
    }
    if (name === 'S') {
      return this.progress.scrub
    }
    if (name === 'H') {
      return this.height / this.width
    }

    // Multi-letter constants
    if (name === 'PHI') {
      return PHI
    }
    if (name === 'ST') {
      return this.progress.scrubTime
    }
    if (name === 'Hpx') {
      return this.height
    }
    if (name === 'Wpx') {
      return this.width
    }

    return 0
  }

  /** Call built-in function */
  private callFunction(name: string, args: f64[]): f64 {
    const argc = args.length

    // Math functions
    if (name === 'sin') {
      return argc > 0 ? Math.sin(args[0] * TWO_PI) : 0
    }
    if (name === 'cos') {
      return argc > 0 ? Math.cos(args[0] * TWO_PI) : 0
    }
    if (name === 'abs') {
      return argc > 0 ? Math.abs(args[0]) : 0
    }
    if (name === 'sqrt') {
      return argc > 0 ? Math.sqrt(args[0]) : 0
    }
    if (name === 'floor') {
      return argc > 0 ? Math.floor(args[0]) : 0
    }
    if (name === 'ceil') {
      return argc > 0 ? Math.ceil(args[0]) : 0
    }
    if (name === 'round') {
      return argc > 0 ? Math.round(args[0]) : 0
    }
    if (name === 'min') {
      return argc >= 2 ? Math.min(args[0], args[1]) : argc > 0 ? args[0] : 0
    }
    if (name === 'max') {
      return argc >= 2 ? Math.max(args[0], args[1]) : argc > 0 ? args[0] : 0
    }
    if (name === 'pow') {
      return argc >= 2 ? Math.pow(args[0], args[1]) : 0
    }

    // Utility functions
    if (name === 'or') {
      // Ternary operator: or(condition, trueVal, falseVal)
      return argc >= 3 ? (args[0] > 0 ? args[1] : args[2]) : 0
    }
    if (name === 'choose') {
      // Choose by index: choose(index, val0, val1, ...)
      if (argc < 2) return 0
      const index = i32(Math.floor(args[0]))
      if (index < 0 || index >= argc - 1) return 0
      return args[index + 1]
    }
    if (name === 'mix') {
      // Average of all arguments
      if (argc === 0) return 0
      let sum: f64 = 0
      for (let i = 0; i < argc; i++) {
        sum += args[i]
      }
      return sum / argc
    }

    // Special functions
    if (name === 'acc') {
      // Accumulator
      if (argc === 0) return 0
      const idx = this.progress.accumIndex
      if (idx < this.accumulators.length) {
        this.accumulators[idx] += args[0] / 60.0
        const val = this.accumulators[idx]
        this.progress.accumIndex++
        return val
      }
      return 0
    }

    if (name === 'px') {
      // Pixels to normalized
      const scale = argc > 0 ? args[0] : 1
      return (1.0 / this.width) * scale
    }

    return 0
  }

  /** Hash function */
  hash(n: f64): f64 {
    const val = Math.sin(n * (43758.5453123 + this.progress.seed))
    return Math.abs(val - Math.floor(val))
  }

  /** Linear interpolation */
  lerp(a: f64, b: f64, t: f64): f64 {
    return a + (b - a) * t
  }
}
