import invariant from 'tiny-invariant'
import { splitStringAt } from '../../settings'
import { clamp, lastIndexOf } from 'lodash'

export class ExpressionMethods {
  parser: any

  // Cache regex patterns for better performance
  private static readonly BACKTICK_REGEX = /`([^`]+)`/g
  private static readonly NUMBER_REGEX = /^\-?[0-9\.]+$/

  // Cache operator precedence for faster lookup
  private static readonly OPERATORS = [
    '&',
    '|',
    '^',
    '#',
    '+',
    '-',
    '*',
    '/',
    '%'
  ]
  private static readonly OPERATOR_REGEX = /([&|^#+\-*/%])/
  // Cache for operator splits
  private operatorSplitCache: Record<
    string,
    { string: string; operatorType: string }[]
  > = {}

  constructor(parser: any) {
    this.parser = parser
  }

  fastExpr(stringExpr: string) {
    if (!/[\D\.]/.test(stringExpr)) {
      const value = parseFloat(stringExpr)
      if (Number.isNaN(value)) {
        throw new Error(`Unknown function ${stringExpr}`)
      }
      return value
    } else {
      // no splits, just parse the float
      const foundKey = this.parser.sortedKeys.find(x =>
        stringExpr.startsWith(x)
      )
      if (foundKey) {
        const arg1 = stringExpr.slice(foundKey.length)
        return this.parser.constants[foundKey](arg1)
      } else throw new Error(`Unknown function ${stringExpr}`)
    }
  }

  expr(expr: string | number, replace = true): number {
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
    let parenIndex = expr.lastIndexOf('(')
    while (parenIndex !== -1) {
      let closeParen = expr.indexOf(')', parenIndex + 1)
      const solvedExpr = expr.substring(parenIndex + 1, closeParen - 1)
      expr =
        expr.substring(0, parenIndex) +
        this.expr(solvedExpr).toFixed(4) +
        expr.substring(closeParen)

      parenIndex = expr.lastIndexOf('(')
    }

    invariant(typeof expr === 'string')
    let stringExpr = expr as string

    // NO PARENTHESES NOW

    // Cache space check
    if (stringExpr.includes(' ')) {
      const [funcName, ...args] = stringExpr.split(' ')
      if (this.parser.constants[funcName]) {
        return this.parser.constants[funcName](...args)
      } else {
        throw new Error(`Unknown function ${funcName}`)
      }
    } else if (stringExpr.includes('_')) {
      const [funcName, ...args] = stringExpr.split('_')

      const foundKey = this.parser.sortedKeys.find(x => funcName.startsWith(x))
      if (foundKey) {
        const arg1 = funcName.slice(foundKey.length).trim()
        return this.parser.constants[foundKey](arg1, ...args)
      } else {
        throw new Error(`Unknown function ${funcName}`)
      }
    } else if (!ExpressionMethods.OPERATOR_REGEX.test(stringExpr)) {
      return this.fastExpr(stringExpr)
    } else {
      // Optimized operator parsing - split by operator RegExp, cache, and process
      let splitResult: { string: string; operatorType: string }[] =
        this.operatorSplitCache[stringExpr]
      if (splitResult === undefined) {
        // Find operator splits in the string
        splitResult = []
        let operators = stringExpr.matchAll(ExpressionMethods.OPERATOR_REGEX)
        let lastIndex = 0
        while (true) {
          const { value, done } = operators.next()
          const [operator] = value

          splitResult.push({
            string: stringExpr.slice(lastIndex, value.index),
            operatorType: operator
          })
          lastIndex = value.index + 1
          if (done) break
        }
        splitResult.push({
          string: stringExpr.slice(lastIndex),
          operatorType: 'LAST'
        })
        this.operatorSplitCache[stringExpr] = splitResult
      }
      invariant(splitResult)
      let i = splitResult.length - 1
      let rightVal: number = this.fastExpr(splitResult[i].string)
      i--
      // Find the split index for the operator
      for (; i >= 0; i--) {
        const result = splitResult[i]
        const { string, operatorType } = result
        const leftVal = this.fastExpr(string)

        switch (operatorType) {
          case '&':
            return string && rightVal ? 1 : 0
          case '|':
            return leftVal || rightVal ? 1 : 0
          case '^':
            return leftVal ** rightVal
          case '#':
            return Math.floor(leftVal / rightVal) * rightVal

          case '+':
            return leftVal + rightVal
          case '-':
            return leftVal - rightVal
          case '*':
            return leftVal * rightVal
          case '/':
            return leftVal / rightVal
          case '%':
            return leftVal % rightVal
        }
      }

      return rightVal
    }
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
