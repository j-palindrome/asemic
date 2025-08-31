import invariant from 'tiny-invariant'
import { splitStringAt } from '../../settings'
import { clamp, last, lastIndexOf } from 'lodash'
import { Parser } from '../../types'

export class ExpressionMethods {
  parser: Parser

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
  private static readonly OPERATOR_REGEX = new RegExp(
    `[${this.OPERATORS.map(x => `\\${x}`).join('')}]`,
    'g'
  )

  // Cache for operator splits
  private operatorSplitCache: Record<
    string,
    { string: string; operatorType: string }[]
  > = {}

  sortedKeys: string[]

  protected generateSortedKeys() {
    this.sortedKeys = Object.keys(this.parser.constants).sort(
      (a, b) => b.length - a.length
    )
  }
  constructor(parser: any) {
    this.parser = parser
    this.generateSortedKeys()
  }

  protected fastExpr(stringExpr: string) {
    if (stringExpr.length === 0) {
      throw new Error('Empty expression')
    }
    if (/[^\-\d\.]/.test(stringExpr)) {
      const foundKey = this.sortedKeys.find(x => stringExpr.startsWith(x))
      if (foundKey) {
        const arg1 = stringExpr.slice(foundKey.length)
        return this.parser.constants[foundKey](arg1)
      } else {
        throw new Error(`Unknown function ${stringExpr}`)
      }
    } else {
      const value = parseFloat(stringExpr)
      if (Number.isNaN(value)) {
        throw new Error(`${stringExpr} is NaN`)
      }
      return value
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

    // invariant(typeof expr === 'string')
    // Optimized operator parsing - split by operator RegExp, cache, and process
    let splitResult: { string: string; operatorType: string }[] =
      this.operatorSplitCache[expr]
    // Optimized parentheses handling
    let parenIndex = expr.lastIndexOf('(')
    while (parenIndex !== -1) {
      let closeParen = expr.indexOf(')', parenIndex + 1)
      const solvedExpr = expr.substring(parenIndex + 1, closeParen)
      expr =
        expr.substring(0, parenIndex) +
        this.expr(solvedExpr).toFixed(4) +
        expr.substring(closeParen + 1)

      parenIndex = expr.lastIndexOf('(')
    }
    let stringExpr = expr as string

    // NO PARENTHESES NOW

    // Cache space check
    if (stringExpr.includes(' ')) {
      const [funcName, ...args] = stringExpr.split(' ')
      if (this.parser.constants[funcName]) {
        return this.parser.constants[funcName](...args)
      } else {
        throw new Error(`Unknown function ${stringExpr}`)
      }
    } else if (stringExpr.includes('_')) {
      const [funcName, ...args] = stringExpr.split('_')

      const foundKey = this.sortedKeys.find(x => funcName.startsWith(x))
      if (foundKey) {
        const arg1 = funcName.slice(foundKey.length).trim()
        return this.parser.constants[foundKey](arg1, ...args)
      } else {
        throw new Error(`Unknown function ${stringExpr}`)
      }
    } else {
      if (splitResult === undefined) {
        // Find operator splits in the string
        splitResult = []
        ExpressionMethods.OPERATOR_REGEX.lastIndex = 0
        let operators = stringExpr.matchAll(ExpressionMethods.OPERATOR_REGEX)

        let operatorArray = Array.from(operators)

        for (let i = 0; i < operatorArray.length; i++) {
          const match = operatorArray[i]
          const operatorIndex = match.index!

          // Add the text before this operator
          if (i === 0) {
            splitResult.push({
              string: stringExpr.substring(0, operatorIndex),
              operatorType: ''
            })
          }
          // if the previous operator was immediately before this one, and this is a negative sign, we need to merge it with the previous operator
          if (
            match[0] === '-' &&
            (operatorIndex === 0 ||
              (i > 0 && operatorIndex === operatorArray[i - 1].index + 1))
          ) {
            last(splitResult)!.string += stringExpr.substring(
              operatorIndex,
              i < operatorArray.length - 1
                ? operatorArray[i + 1].index
                : stringExpr.length
            )
            continue
          }

          // Add the text after this operator with the operator type
          splitResult.push({
            string: stringExpr.substring(
              operatorIndex + 1,
              i < operatorArray.length - 1
                ? operatorArray[i + 1].index
                : stringExpr.length
            ),
            operatorType: match[0]
          })
        }

        // If no operators found, add the entire string
        if (operatorArray.length === 0) {
          splitResult.push({
            string: stringExpr,
            operatorType: ''
          })
        }
        // if (splitResult.length > 2) debugger

        this.operatorSplitCache[expr] = splitResult
      }
      invariant(splitResult)
      if (splitResult.length === 1) {
        if (splitResult[0].string.length === 0)
          throw new Error(`Empty expression beginning ${stringExpr}`)
        return this.fastExpr(splitResult[0].string)
      } else {
        let leftVal: number = this.fastExpr(splitResult[0].string)

        // Find the split index for the operator
        for (let i = 1; i < splitResult.length; i++) {
          const result = splitResult[i]
          const { string, operatorType } = result
          if (string.length === 0) {
            throw new Error(
              `Empty expression after operator ${operatorType} in ${expr}`
            )
          }
          const rightVal = this.fastExpr(string)

          switch (operatorType) {
            case '&':
              leftVal = leftVal && rightVal ? 1 : 0
              break
            case '|':
              leftVal = leftVal || rightVal ? 1 : 0
              break
            case '^':
              leftVal = leftVal ** rightVal
              break
            case '#':
              leftVal = Math.floor(leftVal / rightVal) * rightVal
              break
            case '+':
              leftVal = leftVal + rightVal
              break
            case '-':
              leftVal = leftVal - rightVal
              break
            case '*':
              leftVal = leftVal * rightVal
              break
            case '/':
              leftVal = leftVal / rightVal
              break
            case '%':
              leftVal = leftVal % rightVal
              break
          }
        }

        return leftVal
      }
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
    if (!this.sortedKeys.includes(key)) this.generateSortedKeys()

    return this.parser
  }

  defStatic(key: string, definition: string) {
    if (this.parser.reservedConstants.includes(key)) {
      throw new Error(`Reserved constant: ${key}`)
    }

    const solvedDefinition = this.expr(definition)
    this.parser.constants[key] = () => solvedDefinition
    if (!this.sortedKeys.includes(key)) this.generateSortedKeys()

    return this.parser
  }
}
