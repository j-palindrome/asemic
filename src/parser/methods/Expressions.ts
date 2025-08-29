import invariant from 'tiny-invariant'
import { splitStringAt } from '../../settings'
import { clamp } from 'lodash'

export class ExpressionMethods {
  parser: any

  // Cache regex patterns for better performance
  private static readonly BACKTICK_REGEX = /`([^`]+)`/g
  private static readonly NUMBER_REGEX = /^\-?[0-9\.]+$/

  // Cache operator precedence for faster lookup
  private static readonly OPERATORS = [
    '&&',
    '^^',
    '^',
    '#',
    '+',
    '-',
    '*',
    '/',
    '%'
  ]

  constructor(parser: any) {
    this.parser = parser
  }

  expr(expr: string | number, replace = true): number {
    const returnedExpr = this.exprEval(expr, replace)
    if (Number.isNaN(returnedExpr)) {
      throw new Error(`Expr ${expr} is NaN`)
    }
    return returnedExpr
  }

  exprEval(expr: string | number, replace = true): number {
    if (expr === undefined || expr === null) {
      throw new Error('undefined or null expression')
    }
    if (typeof expr === 'number') {
      return expr
    }

    expr = expr.trim()
    if (expr.length === 0) throw new Error('Empty expression')

    this.parser.progress.curve++

    // Early number check before any processing
    if (ExpressionMethods.NUMBER_REGEX.test(expr)) {
      return parseFloat(expr)
    }

    if (replace && expr.includes('`')) {
      const matches = expr.matchAll(ExpressionMethods.BACKTICK_REGEX)
      for (let match of matches) {
        const [original, expression] = match
        expr = expr.replace(original, eval(expression))
      }
    }

    // Optimized parentheses handling
    const parenIndex = expr.indexOf('(')
    if (parenIndex !== -1) {
      let bracket = 1
      let end = parenIndex + 1

      while (end < expr.length && bracket > 0) {
        const char = expr[end]
        if (char === '(') bracket++
        else if (char === ')') bracket--
        end++
      }

      if (bracket === 0) {
        const solvedExpr = expr.substring(parenIndex + 1, end - 1)
        return this.expr(
          expr.substring(0, parenIndex) +
            this.expr(solvedExpr).toFixed(4) +
            expr.substring(end)
        )
      }
    }

    invariant(typeof expr === 'string')
    let stringExpr = expr as string

    // Cache space check
    const hasSpace = stringExpr.includes(' ')
    if (hasSpace) {
      const [funcName, ...args] = this.parser.tokenize(expr, {
        separatePoints: false
      })
      if (this.parser.constants[funcName]) {
        return this.parser.constants[funcName](...args)
      }
    }

    // Optimized underscore handling
    if (stringExpr.includes('_')) {
      const [funcName, ...args] = this.parser.tokenize(expr, {
        separateFragments: true
      })

      const foundKey = this.parser.sortedKeys.find(x => funcName.startsWith(x))
      if (foundKey) {
        const arg1 = funcName.slice(foundKey.length).trim()
        return this.parser.constants[foundKey](arg1, ...args)
      }
    }

    // Optimized operator parsing - scan right to left for first operator found
    for (let i = stringExpr.length - 1; i >= 0; i--) {
      for (const op of ExpressionMethods.OPERATORS) {
        if (stringExpr[i] === op) {
          // Skip negative signs that are part of numbers
          if (op === '-' && i > 0 && '*+/%()#'.includes(stringExpr[i - 1])) {
            continue
          }

          let operators: [number, number] = splitStringAt(stringExpr, i, 1).map(
            x => this.expr(x || 0, false)!
          ) as [number, number]

          switch (op) {
            case '&':
              return operators[0] && operators[1] ? 1 : 0
            case '|':
              return operators[0] || operators[1] ? 1 : 0
            case '^':
              return operators[0] ** operators[1]
            case '#':
              let [round, after] = operators
              // debugger
              const afterNum = this.expr(after || 1, false)
              if (!afterNum) {
                return this.expr(round, false)
              } else {
                return Math.floor(this.expr(round) / afterNum) * afterNum
              }
            case '+':
              return operators[0] + operators[1]
            case '-':
              return operators[0] - operators[1]
            case '*':
              return operators[0] * operators[1]
            case '/':
              return operators[0] / operators[1]
            case '%':
              return operators[0] % operators[1]
          }
        }
      }
    }

    // Use cached sortedKeys if available, otherwise compute once
    if (!this.parser.sortedKeys) {
      this.parser.sortedKeys = Object.keys(this.parser.constants).sort(
        (a, b) => b.length - a.length
      )
    }

    const foundKey = this.parser.sortedKeys.find(x => stringExpr.startsWith(x))
    if (foundKey) {
      const arg1 = expr.slice(foundKey.length).trim()
      return this.parser.constants[foundKey](arg1)
    }

    throw new Error(`Unknown function ${expr}`)
  }

  choose(value0To1: string | number, ...callbacks: (() => void)[]) {
    const normalizedValue = this.expr(value0To1)
    const numCallbacks = callbacks.length

    if (numCallbacks === 0) return this.parser

    // Scale the value to the number of callbacks and clamp it
    const index = Math.ceil(clamp(normalizedValue, 0, 0.999999) * numCallbacks)

    // Call the selected callback
    if (callbacks[index]) {
      callbacks[index]()
    }

    return this.parser
  }

  def(key: string, definition: string) {
    if (this.parser.reservedConstants.includes(key)) {
      throw new Error(`Reserved constant: ${key}`)
    }

    this.parser.constants[key] = (...args: string[]) => this.expr(definition)

    return this.parser
  }

  defStatic(key: string, definition: string) {
    if (this.parser.reservedConstants.includes(key)) {
      throw new Error(`Reserved constant: ${key}`)
    }

    const solvedDefinition = this.expr(definition)
    this.parser.constants[key] = () => solvedDefinition

    if (!this.parser.sortedKeys.includes(key))
      this.parser.sortedKeys = Object.keys(this.parser.constants).sort(
        (a, b) => b.length - a.length
      )

    return this.parser
  }
}
