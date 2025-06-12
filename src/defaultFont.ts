import { escapeRegExp } from 'lodash'

export class AsemicFont {
  protected defaultCharacters: Record<string, string> = {}
  protected defaultDynamicCharacters: Record<string, string> = {}
  characters: Record<string, string> = {}
  dynamicCharacters: Record<string, string> = {}
  reset() {
    this.characters = { ...this.defaultCharacters }
    this.dynamicCharacters = { ...this.defaultDynamicCharacters }
  }
  resetCharacter(char: string) {
    this.characters[char] = this.defaultCharacters[char]
    this.dynamicCharacters[char] = this.defaultDynamicCharacters[char]
  }
  parseCharacters(characters: string) {
    const charList = characters.split(/\n|;/g).filter(Boolean)

    for (let i = 0; i < charList.length; i++) {
      const char = charList[i].trim()
      // console.log(char.match(/^(.+?)(\:|\=>|!)(.*)$/))
      let [_, name, type, markup] = char.match(/^(.+?)(\:|\=>|!)(.*)$/)!

      if (name.includes(',')) {
        const multipleChars = name.split(',')
        const countNum = multipleChars.length
        let charString: string[] = []
        for (let j = 0; j < countNum; j++) {
          charString.push(
            // TODO: incorporate this into evalExpr so it doesn't override text
            `${multipleChars[j]}:${markup
              .replace(/I/g, j.toString())
              .replace(/N/g, countNum.toString())}`
          )
        }
        this.parseCharacters(charString.join('\n'))
      } else {
        const escapedCharacters = {
          '\\n': '\n',
          '\\s': ' '
        }
        for (let char of Object.keys(escapedCharacters)) {
          if (name.includes(char)) {
            name = name.replace(
              new RegExp(escapeRegExp(char), 'g'),
              escapedCharacters[char]
            )
          }
        }
        switch (type) {
          case '=>':
            if (markup === '!')
              this.dynamicCharacters[name] = this.defaultDynamicCharacters[name]
            else this.dynamicCharacters[name] = markup
            break
          case ':':
            if (markup === '!')
              this.characters[name] = this.defaultCharacters[name]
            else this.characters[name] = markup
            break
          case '!':
            this.characters[name] = this.defaultCharacters[name]
            this.dynamicCharacters[name] = this.defaultDynamicCharacters[name]
            break
        }
      }
    }
  }
  constructor(characters: string) {
    this.parseCharacters(characters)
    this.defaultCharacters = { ...this.characters }
    this.defaultDynamicCharacters = { ...this.dynamicCharacters }
  }
}

export class DefaultFont extends AsemicFont {
  constructor() {
    super(`a: (squ 1,-1 1,0 1) (tri 1,-1 +0,1 .05)
b: [0,-2 0,0] (squ 0,-1 0,0 -1)
c: (pen 1,-.8 @1/4,.6 1,.2)
d: [1,-2 1,0] (squ 1,-1 1,0 1)
e: (hex 1,-.7 @1/4,.4 1,.3) [<0 <.5]
f: {+.25,0} (squ 1,-1.5 +-1,0 .5) +[0,0] {+-.25,0} [0,-1 @0,.5]
g: (cir .5,-.5 .5,.5) [1,-.5] +(tri @1/4,1 +-1,0 -.5)
h: [0,0 0,-2] [0,-.8 1,-1 1,0]
i: {+0.5,0} [0,0 +0,-1] (cir 0,-1.5 .25,.25) {+-.5,0}
j: {+.5,0} [0,-1] +(tri @1/4,1.5 @.5,1 -.3) (cir 0,-1.5 .25,.25) {+-.5,0}
k: [0,0 @-1/4,2] [0,-1 1,0] [0,-1 @-1/8,.5]
l: {+0.5,0} [0,-2] +(tri 0,-.2 @0,.3 .2) {+-0.5,0}
m: [0,0 0,-1] (tri <.8 @0,.5 -0.2) +[@1/4,1] (tri +0,-1 @0,.5 -0.2) +[@1/4,1]
n: [0,0 0,-1] (tri 0,-.9 @0,1 -0.2) +[@1/4,1]
o: (cir .5,-.5 .5,.5)
p: [0,1 @-1/4,2] (pen +0,0 @1/4,1 -1,.2)
q: [1,1 @-1/4,2] (pen +0,0 @1/4,1 1,.2)
r: [0,0 @-1/4,1] (tri 0,-.9 @0,1 -0.2)
s: (tri 1,-1 @0,-0.6 0.2) +(tri 1,-0.2 @0,-1 -0.3)
t: [.5,0 +0,-2] [0,-1 +1,0]
u: (squ 0,-1 1,-1 1,0)
.: (cir 0,0 .1,.1)
v: [0,-1 .5,0] [.5,0 1,-1]
w: {*0.5,1} [0,-1 .5,0] [.5,0 1,-1] {+1,0} [0,-1 .5,0] [.5,0 1,-1] {+-1,0 *2,1}
x: [0,-1 +1,1] [0,0 +1,-1]
y: [0,1 +1,-2] [<0.5 0,-1]
z: [0,-1 +1,0] [1,-1 0,0] [0,0 +1,0]
A: [0,0 .5,-2] [.5,-2 1,0] [<.5 +-.5,0]
B: [0,0 0,-2] (squ +0,0 +0,1 -.8) (squ +0,0 +0,1 -1)
C: (pen 1,-1.7 1,-0.3 1,.3)
D: [0,0 0,-2] (squ +0,0 +0,2 -1)
E: [0,0 0,-2] [+0,0 +1,0] [0,-1 +.5,0] [0,0 +.9,0]
F: [0,0 0,-2] [+0,0 +1,0] [0,-1 +.5,0]
G: [1,-1.7 1,-2 0,-2 0,0 1,0 1,-1] [+0,0 +-.5,0]
H: [0,0 +0,-2] [0,-1 +1,0] [1,0 +0,-2]
I: [.5,0 +0,-2] [0,0 +1,0] [0,-2 +1,0]
J: [1,-2 1,0 0,0 0,-1] [<0 +-.5,0]
K: [0,0 0,-2] [0,-1 @-1/8,.75] [0,-1 1,0]
L: [0,0 0,-2] [0,0 1,0]
M: [0,0 0,-2] [+0,0 +.5,1] [+0,0 +.5,-1] [+0,0 1,0]
N: [0,0 0,-2] [+0,0 1,0] [+0,0 +0,-2]
O: (cir .5,-1 .5,1)
P: [0,0 0,-2] (squ +0,0 +0,1 -1)
Q: (cir .5,-1 .5,1) [1,0 @-3/8,.7]
R: [0,0 0,-2] (squ +0,0 +0,1 -1) [<.8 1,0]
S: (squ 1,-1.7 .5,-1 .5) +(squ +0,0 0,0 -1)
T: [0,-2 +1,0] [.5,0 +0,-2]
U: (squ 0,-2 +1,0 2)
V: [0,-2 .5,0] [+0,0 1,-2]
W: [0,-2 .25,0] [+0,0 .5,-1] [+0,0 .75,0] [+0,0 1,-2]
X: [0,-2 +1,2] [0,0 +1,-2]
Y: [.5,0 +0,-1] [+0,0 0,-2] [<0 1,-2]
Z: [0,-2 +1,0] [+0,0 0,0] [+0,0 1,0]
\\s: {+1,0}
\\n: {< +0,3 >}
\\^: {+0,2 >}
\\.: {+1.25,0}`)
  }
}
