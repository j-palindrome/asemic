import { escapeRegExp } from 'lodash'
import { Parser } from './types'

export class AsemicFont {
  parser: Parser
  characters: Record<string, (...words: string[]) => void> = {}
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
      // const reservedCharacters = ['START', 'END', 'EACH', 'NEWLINE', 'SPACE']
      if (name.includes(',')) {
        const multipleChars = name.split(',')
        const countNum = multipleChars.length

        for (let j = 0; j < countNum; j++) {
          dict[multipleChars[j]] = (...words) => {
            this.parser.progress.indexes[0] = j
            this.parser.progress.countNums[0] = countNum
            chars[name](...words)
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
