import invariant from 'tiny-invariant'
import { splitStringAt } from '../../settings'
import { clamp } from 'lodash'

export class ExpressionMethods {
  parser: any

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

    if (replace) {
      if (expr.includes('`')) {
        const matches = expr.matchAll(/`([^`]+)`/g)
        for (let match of matches) {
          const [original, expression] = match
          expr = expr.replace(original, eval(expression))
        }
      }
    }

    if (expr.includes('(')) {
      let bracket = 1
      const start = expr.indexOf('(') + 1
      let end = start
      for (; end < expr.length; end++) {
        if (expr[end] === '(') bracket++
        else if (expr[end] === ')') {
          bracket--
          if (bracket === 0) break
        }
      }

      const solvedExpr = expr.substring(start, end)

      return this.expr(
        expr.substring(0, start - 1) +
          this.expr(solvedExpr).toFixed(4) +
          expr.substring(end + 1)
      )
    }

    if (expr.match(/^\-?[0-9\.]+$/)) {
      return parseFloat(expr)
    }

    invariant(typeof expr === 'string')
    let stringExpr = expr as string

    if (stringExpr.includes(' ')) {
      const [funcName, ...args] = this.parser.tokenize(expr, {
        separatePoints: false
      })
      if (this.parser.constants[funcName]) {
        return this.parser.constants[funcName](...args)
      }
    }

    const operatorsList = ['&&', '^^', '_', '+', '-', '*', '/', '%', '^']

    if (expr.includes('_')) {
      const [funcName, ...args] = this.parser.tokenize(expr, {
        separateFragments: true
      })

      const foundKey = this.parser.sortedKeys.find(x => funcName.startsWith(x))
      if (foundKey) {
        const arg1 = funcName.slice(foundKey.length).trim()
        return this.parser.constants[foundKey](arg1, ...args)
      }
    }

    for (let i = stringExpr.length - 1; i >= 0; i--) {
      let operator = operatorsList.find(
        x => stringExpr.substring(i, i + x.length) === x
      )
      if (operator) {
        if (
          stringExpr[i] === '-' &&
          stringExpr[i - 1] &&
          '*+/%()'.includes(stringExpr[i - 1])
        )
          continue
        let operators: [number, number] = splitStringAt(
          stringExpr,
          i,
          operator.length
        ).map(x => this.expr(x || 0, false)!) as [number, number]
        switch (operator) {
          case '&':
            return operators[0] && operators[1] ? 1 : 0

          case '|':
            return operators[0] || operators[1] ? 1 : 0

          case '^':
            return operators[0] ** operators[1]

          case '#':
            let [round, after] = operators

            const afterNum = this.expr(after || 0, false)
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

    const sortedKeys = Object.keys(this.parser.constants).sort(
      x => x.length * -1
    )
    const foundKey = sortedKeys.find(x => (expr as string).startsWith(x))
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

    return this.parser
  }
}
