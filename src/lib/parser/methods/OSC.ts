import { splitString } from '../../settings'

export class OSCMethods {
  parser: any

  constructor(parser: any) {
    this.parser = parser
  }

  osc(args: string) {
    const [path, ...argsArray] = splitString(args, ' ')
    this.parser.output.osc.push({
      path,
      args: argsArray.map((x: string) => {
        if (x.startsWith("'")) {
          return x.substring(1)
        } else if (x.startsWith('"')) {
          return x.substring(1, x.length - 1)
        } else if (x.includes(',')) {
          return [...this.parser.evalPoint(x)] as [number, number]
        } else {
          const evaluated = this.parser.expr(x)
          return isNaN(evaluated) ? x : evaluated
        }
      })
    })
    return this.parser
  }

  sc(args: string) {
    const [path, value] = splitString(args, ' ')
    this.parser.output.sc.push({ path, value: this.parser.expr(value) })
    return this.parser
  }

  synth(name: string, code: string) {
    this.parser.output.scSynthDefs[name] = code
    return this.parser
  }

  file(filePath: string) {
    this.parser.output.files.push(this.parser.resolveName(filePath))
    return this.parser
  }
}
