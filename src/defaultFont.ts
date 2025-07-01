import { escapeRegExp } from 'lodash'
import { Parser } from './types'

export class AsemicFont {
  parser: Parser
  characters: Record<
    string,
    (p: Parser, info?: { i: number; n: number }) => void
  > = {}
  protected defaultCharacters: AsemicFont['characters'] = {}
  protected defaultDynamicCharacters: AsemicFont['characters'] = {}
  dynamicCharacters: AsemicFont['characters'] = {}

  reset() {
    this.characters = { ...this.defaultCharacters }
    this.dynamicCharacters = { ...this.defaultDynamicCharacters }
  }

  resetCharacter(char: string) {
    this.characters[char] = this.defaultCharacters[char]
    this.dynamicCharacters[char] = this.defaultDynamicCharacters[char]
  }

  parseCharacters(chars: AsemicFont['characters']) {
    for (let name of Object.keys(chars)) {
      if (name.includes(',')) {
        const multipleChars = name.split(',')
        const countNum = multipleChars.length
        for (let j = 0; j < countNum; j++) {
          this.characters[multipleChars[j]] = (p: Parser) => {
            chars[name](p, { i: j, n: multipleChars.length })
          }
        }
      } else {
        this.characters[name] = chars[name]
      }
    }
  }

  constructor(characters: AsemicFont['characters']) {
    this.parseCharacters(characters)
    this.defaultCharacters = { ...this.characters }
    this.defaultDynamicCharacters = { ...this.dynamicCharacters }
  }
}

export class DefaultFont extends AsemicFont {
  constructor() {
    super({
      a: p => p.squ('1,1 1,0 1').tri('1,-1 +0,1 .05'),
      b: p => p.crv('0,-2 0,0').squ('0,-1 0,0 -1'),
      c: p => p.pen('1,-.8 +0,.6 1,.2'),
      d: p => p.crv('1,-2 1,0').squ('1,-1 1,0 1'),
      e: p => p.hex('1,-.7 @1/4,.4 1,.3').crv('<0 <.5'),
      f: (p: Parser) =>
        p
          .tra('+.25,0')
          .squ('1,-1.5 +-1,0 .5')
          .tra('+0,0')
          .tra('+-.25,0')
          .crv('0,-1 @0,.5'),
      g: p => p.cir('.5,-.5 .5,.5').crv('1,-.5').tri('@1/4,1 +-1,0 -.5'),
      h: p => p.crv('0,0 0,-2').crv('0,-.8 1,-1 1,0'),
      i: (p: Parser) =>
        p.tra('+0.5,0').crv('0,0 +0,-1').cir('0,-1.5 .25,.25').tra('+-.5,0'),
      j: (p: Parser) =>
        p
          .tra('+.5,0')
          .crv('0,-1')
          .tri('@1/4,1.5 @.5,1 -.3')
          .cir('0,-1.5 .25,.25')
          .tra('+-.5,0'),
      k: p => p.crv('0,0 @-1/4,2').crv('0,-1 1,0').crv('0,-1 @-1/8,.5'),
      l: (p: Parser) =>
        p.tra('+0.5,0').crv('0,-2').tri('0,-.2 @0,.3 .2').tra('+-0.5,0'),
      m: (p: Parser) =>
        p
          .crv('0,0 0,-1')
          .tri('<.8 @0,.5 -0.2')
          .tra('+@1/4,1')
          .tri('+0,-1 @0,.5 -0.2')
          .tra('+@1/4,1'),
      n: p => p.crv('0,0 0,-1').tri('0,-.9 @0,1 -0.2').tra('+@1/4,1'),
      o: p => p.cir('.5,-.5 .5,.5'),
      p: p => p.crv('0,1 @-1/4,2').pen('+0,0 @1/4,1 -1,.2'),
      q: p => p.crv('1,1 @-1/4,2').pen('+0,0 @1/4,1 1,.2'),
      r: p => p.crv('0,0 @-1/4,1').tri('0,-.9 @0,1 -0.2'),
      s: p => p.tri('1,-1 @0,-0.6 0.2').tri('1,-0.2 @0,-1 -0.3'),
      t: p => p.crv('.5,0 +0,-2').crv('0,-1 +1,0'),
      u: p => p.squ('0,-1 1,-1 1,0'),
      '.': p => p.cir('0,0 .1,.1'),
      v: p => p.crv('0,-1 .5,0').crv('.5,0 1,-1'),
      w: (p: Parser) =>
        p
          .tra('*0.5,1')
          .crv('0,-1 .5,0')
          .crv('.5,0 1,-1')
          .tra('+1,0')
          .crv('0,-1 .5,0')
          .crv('.5,0 1,-1')
          .tra('+-1,0 *2,1'),
      x: p => p.crv('0,-1 +1,1').crv('0,0 +1,-1'),
      y: p => p.crv('0,1 +1,-2').crv('<0 0,-1'),
      z: p => p.crv('0,-1 +1,0').crv('1,-1 0,0').crv('0,0 +1,0'),
      A: p => p.crv('0,0 .5,-2').crv('.5,-2 1,0').crv('<.5 +-.5,0'),
      B: p => p.crv('0,0 0,-2').squ('+0,0 +0,1 -.8').squ('+0,0 +0,1 -1'),
      C: p => p.pen('1,-1.7 1,-0.3 1,.3'),
      D: p => p.crv('0,0 0,-2').squ('+0,0 +0,2 -1'),
      E: (p: Parser) =>
        p.crv('0,0 0,-2').crv('+0,0 +1,0').crv('0,-1 +.5,0').crv('0,0 +.9,0'),
      F: p => p.crv('0,0 0,-2').crv('+0,0 +1,0').crv('0,-1 +.5,0'),
      G: p => p.crv('1,-1.7 1,-2 0,-2 0,0 1,0 1,-1').crv('+0,0 +-.5,0'),
      H: p => p.crv('0,0 +0,-2').crv('0,-1 +1,0').crv('1,0 +0,-2'),
      I: p => p.crv('.5,0 +0,-2').crv('0,0 +1,0').crv('0,-2 +1,0'),
      J: p => p.crv('1,-2 1,0 0,0 0,-1').crv('<0 +-.5,0'),
      K: p => p.crv('0,0 0,-2').crv('0,-1 @-1/8,.75').crv('0,-1 1,0'),
      L: p => p.crv('0,0 0,-2').crv('0,0 1,0'),
      M: (p: Parser) =>
        p.crv('0,0 0,-2').crv('+0,0 +.5,1').crv('+0,0 +.5,-1').crv('+0,0 1,0'),
      N: p => p.crv('0,0 0,-2').crv('+0,0 1,0').crv('+0,0 +0,-2'),
      O: p => p.cir('.5,-1 .5,1'),
      P: p => p.crv('0,0 0,-2').squ('+0,0 +0,1 -1'),
      Q: p => p.cir('.5,-1 .5,1').crv('1,0 @-3/8,.7'),
      R: p => p.crv('0,0 0,-2').squ('+0,0 +0,1 -1').crv('<.8 1,0'),
      S: p => p.squ('1,-1.7 .5,-1 .5').squ('+0,0 0,0 -1'),
      T: p => p.crv('0,-2 +1,0').crv('.5,0 +0,-2'),
      U: p => p.squ('0,-2 +1,0 2'),
      V: p => p.crv('0,-2 .5,0').crv('+0,0 1,-2'),
      W: p => p.crvs('0,-2 .25,0', '+0,0 .5,-1', '+0,0 .75,0', '+0,0 1,-2'),
      X: p => p.crv('0,-2 +1,2').crv('0,0 +1,-2'),
      Y: p => p.crv('.5,0 +0,-1').crv('+0,0 0,-2').crv('<0 1,-2'),
      Z: p => p.crv('0,-2 +1,0').crv('+0,0 0,0').crv('+0,0 1,0'),
      '\\s': p => p.tra('+1,0'),
      '\\n': p => p.tra('< +0,3 >'),
      '\\^': p => p.tra('+0,2 >'),
      '\\.': p => p.tra('+1.25,0')
    })
  }
}
