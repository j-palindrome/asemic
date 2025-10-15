import { escapeRegExp } from 'lodash'
import { Parser } from './types'

export class AsemicFont {
  parser: Parser
  characters: Record<string, () => void> = {}
  protected defaultCharacters: AsemicFont['characters'] = {}
  protected defaultDynamicCharacters: AsemicFont['characters'] = {}
  dynamicCharacters: AsemicFont['characters'] = {}

  reset() {
    this.characters = { ...this.defaultCharacters }
    this.dynamicCharacters = { ...this.defaultDynamicCharacters }
  }

  resetCharacter(char: string, { dynamic = false } = {}) {
    if (dynamic) {
      this.dynamicCharacters[char] = this.defaultDynamicCharacters[char]
    } else {
      this.characters[char] = this.defaultCharacters[char]
    }
    return this.parser
  }

  parseCharacters(chars: AsemicFont['characters'], { dynamic = false } = {}) {
    let dict = dynamic ? this.dynamicCharacters : this.characters
    for (let name of Object.keys(chars)) {
      const reservedCharacters = ['START', 'END', 'EACH', 'NEWLINE']
      if (name.length > 1 && !reservedCharacters.includes(name)) {
        if (name.startsWith('(') && name.endsWith(')')) {
          dict[name.slice(1, -1)] = chars[name]
        } else {
          const multipleChars = name.split('')
          const countNum = multipleChars.length

          for (let j = 0; j < countNum; j++) {
            dict[multipleChars[j]] = () => {
              this.parser.constants.I = () => j
              this.parser.constants.N = () => countNum
              this.parser.constants.i = () => j / (countNum - 1 || 1)
              chars[name]()
            }
          }
        }
      } else {
        dict[name] = chars[name]
      }
    }
  }

  constructor(
    parser: Parser,
    characters: AsemicFont['characters'],
    dynamicCharacters: AsemicFont['characters'] = {}
  ) {
    this.parser = parser
    this.parseCharacters(characters)
    this.parseCharacters(dynamicCharacters, { dynamic: true })
    this.defaultCharacters = { ...this.characters }
    this.defaultDynamicCharacters = { ...this.dynamicCharacters }
  }
}

export class DefaultFont extends AsemicFont {
  constructor(parser: Parser) {
    super(parser, {
      START: () => parser.to('+0,2 >line'),
      a: () => parser.squ('1,-1 1,0 1').tri('1,-1 +0,1 .05'),
      b: () => parser.line('0,-2 0,0').squ('0,-1 0,0 -1'),
      c: () => parser.pen('1,-.8 +0,.6 1,.2'),
      d: () => parser.line('1,-2 1,0').squ('1,-1 1,0 1'),
      e: () => parser.hex('1,-.7 +@1/4,.4 1,.3').line('<0,-1 <.5,-1'),
      f: () =>
        parser
          .to('+.25,0')
          .squ('1,-1.5 +-1,0 .5', { add: true })
          .line('+0,1.5')
          .to('+-.25,0')
          .line('0,-1 +@0,.5'),
      g: () =>
        parser
          .circle('.5,-.5 .5,.5')
          .points('1,-.5 1,0')
          .tri('+@1/4,1 +-1,0 -.5'),
      h: () => parser.line('0,0 0,-2').line('0,-.8 1,-1 1,0'),
      i: () =>
        parser
          .to('+0.5,0')
          .line('0,0 +0,-1')
          .circle('0,-1.5 .25,.25')
          .to('+-.5,0'),
      j: () =>
        parser
          .to('+.5,0')
          .points('0,-1')
          .tri('+@1/4,1.5 +@.5,1 -.3')
          .circle('0,-1.5 .25,.25')
          .to('+-.5,0'),
      k: () =>
        parser.line('0,0 +@-1/4,2').line('0,-1 1,0').line('0,-1 +@-1/8,.5'),
      l: () =>
        parser.to('+0.5,0').points('0,-2').tri('0,-.2 +@0,.3 .2').to('+-0.5,0'),
      m: () =>
        parser
          .line('0,0 0,-1')
          .tri('0,-.9 +@0,1 -0.2', { add: true })
          .line('1,0 {+.6,0}')
          .tri('0,-.9 +@0,1 -0.2', { add: true })
          .line('1,0')
          .to('+-.6,0'),
      n: () =>
        parser
          .line('0,0 0,-1')
          .tri('0,-.9 +@0,1 -0.2', { add: true })
          .line('1,0'),
      o: () => parser.circle('.5,-.5 .5,.5'),
      p: () => parser.line('0,1 +@-1/4,2').pen('+0,0 +@1/4,1 -1,.2'),
      q: () => parser.line('1,1 +@-1/4,2').pen('+0,0 +@1/4,1 1,.2'),
      r: () => parser.line('0,0 +@-1/4,1').tri('0,-.9 +@0,1 -0.2'),
      s: () =>
        parser.squ('.7,-1 .5,-.5 .3', { add: true }).line('.7,-.4 .7,0 0,0'),
      t: () => parser.line('.5,0 +0,-2').line('0,-1 +1,0'),
      u: () => parser.squ('0,-1 1,-1 1,0'),
      '.': () => parser.circle('0,0 .1,.1'),
      v: () => parser.line('0,-1 .5,0').line('.5,0 1,-1'),
      w: () =>
        parser
          .to('*0.5,1')
          .line('0,-1 .5,0')
          .line('.5,0 1,-1')
          .to('+1,0')
          .line('0,-1 .5,0')
          .line('.5,0 1,-1')
          .to('+-1,0 *2,1'),
      x: () => parser.line('0,-1 +1,1').line('0,0 +1,-1'),
      y: () => parser.line('0,1 1,-1').line('<0.5,-1 0,-1'),
      z: () => parser.line('0,-1 +1,0').line('1,-1 0,0').line('0,0 +1,0'),
      A: () => parser.line('0,0 .5,-2').line('.5,-2 1,0').line('<.5,-1 +-.5,0'),
      B: () => parser.line('0,0 0,-2').squ('+0,0 +0,1 -.8').squ('+0,0 +0,1 -1'),
      C: () => parser.pen('1,-1.7 1,-0.3 1,.3'),
      D: () => parser.line('0,0 0,-2').squ('+0,0 +0,2 -1'),
      E: () =>
        parser
          .line('0,0 0,-2')
          .line('+0,0 +1,0')
          .line('0,-1 +.5,0')
          .line('0,0 +.9,0'),
      F: () => parser.line('0,0 0,-2').line('+0,0 +1,0').line('0,-1 +.5,0'),
      G: () => parser.line('1,-1.7 1,-2 0,-2 0,0 1,0 1,-1').line('+0,0 +-.5,0'),
      H: () => parser.line('0,0 +0,-2').line('0,-1 +1,0').line('1,0 +0,-2'),
      I: () => parser.line('.5,0 +0,-2').line('0,0 +1,0').line('0,-2 +1,0'),
      J: () => parser.line('1,-2 1,0 0,0 0,-1').line('<0,-1 +-.5,0'),
      K: () => parser.line('0,0 0,-2').line('0,-1 +@-1/8,.75').line('0,-1 1,0'),
      L: () => parser.line('0,0 0,-2').line('0,0 1,0'),
      M: () =>
        parser
          .line('0,0 0,-2')
          .line('+0,0 +.5,1')
          .line('+0,0 +.5,-1')
          .line('+0,0 1,0'),
      N: () => parser.line('0,0 0,-2').line('+0,0 1,0').line('+0,0 +0,-2'),
      O: () => parser.circle('.5,-1 .5,1'),
      P: () => parser.line('0,0 0,-2').squ('+0,0 +0,1 -1'),
      Q: () => parser.circle('.5,-1 .5,1').line('1,0 +@-3/8,.7'),
      R: () => parser.line('0,0 0,-2').squ('+0,0 +0,1 -1').line('<.8,-1 1,0'),
      S: () => parser.squ('1,-1.7 .5,-1 .5', { add: true }).squ('+0,0 0,0 -1'),
      T: () => parser.line('0,-2 +1,0').line('.5,0 +0,-2'),
      U: () => parser.squ('0,-2 +1,0 2'),
      V: () => parser.line('0,-2 .5,0').line('+0,0 1,-2'),
      W: () =>
        parser.line('0,-2 .25,0', '+0,0 .5,-1', '+0,0 .75,0', '+0,0 1,-2'),
      X: () => parser.line('0,-2 +1,2').line('0,0 +1,-2'),
      Y: () => parser.line('.5,0 +0,-1').line('+0,0 0,-2').line('<0,-1 1,-2'),
      Z: () => parser.line('0,-2 +1,0').line('+0,0 0,0').line('+0,0 1,0'),
      ' ': () => parser.to('+-.25,0'),
      END: () => parser.to('+0,2'),
      NEWLINE: () => parser.to('<line +0,3 >line'),
      '\\': () => parser.to('<,-1 +0,3 >'),
      EACH: () => parser.to('+1.25,0'),
      '0': () => parser.circle('0.5,-.8 .5,.8'),
      '1': () => parser.line('.5,0 +0,-2').line('+0,0 0,-1.5'),
      '2': () => parser.line('1,0 0,0', '0,0 1,-.2 1,-1 0,-1 0,-.8'),
      '3': () => parser.hex('0,-.7 .8,-.5 .5,.2').hex('+0,0 0,0 .5 .2'),
      '4': () => parser.line('0,-2 0,-1 +0,0 +1,0', '.7,0 +0,-1.5'),
      '5': () => parser.hex('0,-.2 0,-1 1,.2').line('+0,0 0,-2 +0,0 1,-2'),
      '6': () => parser.circle('.5,-.5 .5,.5').line('+-1,0 0,-2 1,-2'),
      '7': () => parser.line('0,0 1,-2', '+0,0 0,-2'),
      '8': () => parser.circle('.5,-.5 .5,.5').circle('.5,-1.4 .4,.4'),
      '9': () => parser.circle('.5,-1.5 .5,.5').line('+0,0 0,0 1,0'),
      '(': () => parser.tri('.5,0 .5,-2 -.3').to('+-.4,0'),
      ')': () => parser.to('+-.5,0').tri('.5,0 .5,-2 .3')
    })
  }
}
