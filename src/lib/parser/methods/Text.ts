import { splitString } from '../../settings'
import { expand } from 'regex-to-strings'
import { Parser } from '../Parser'
import { split } from 'lodash'
import invariant from 'tiny-invariant'
import { AsemicFont } from '@/lib/AsemicFont'
import { parserObject } from '../core/utilities'
import { SceneSettings } from '@/renderer/components/SceneSettingsPanel'

export class TextMethods {
  parser: Parser

  // Performance caches
  private fontCache = new Map<string, AsemicFont>()
  private characterCache = new Map<string, string>()
  private regexCache = new Map<string, RegExp>()

  constructor(parser: Parser) {
    this.parser = parser
  }

  linden(
    iterations: string,
    text: string,
    rules: Record<string, string> | string
  ) {
    if (typeof rules === 'string') {
      const rulesObj = parserObject(this.parser, rules, {}) as Record<
        string,
        string
      >
      rules = rulesObj
    }

    let textList = text.split('')
    for (let i = 0; i < this.parser.expressions.expr(iterations); i++) {
      textList = textList.map(char => rules[char] || char)
      textList = textList.flatMap(char => char.split(''))
    }
    const string = textList.join('')
    this.parser.textMethods.text(`"${string}"`)
    // this.parser.error(`linden: ${string}`)
    return this.parser
  }

  text(token: string) {
    let add = false
    for (let i = 0; i < token.length; ) {
      let char = token[i]
      if (char[i - 1] === '+') {
        add = true
      }
      i++
      const font = this.parser.fonts[this.parser.currentFont]

      // Randomly select one character from each set of brackets for the text
      if (font.characters['START'] && !add) {
        font.characters['START']()
      }
      if (font.dynamicCharacters['START'] && !add) {
        font.dynamicCharacters['START']()
      }
      // debugger
      while (token[i] !== '"' || token[i - 1] === '\\') {
        let thisChar = token[i]
        if (thisChar === '(' && token[i - 1] !== '\\') {
          const end = token.indexOf(')', i)
          if (end === -1) {
            throw new Error('Missing ) in text')
          }
          const content = token.substring(i + 1, end)
          // debugger
          thisChar = content

          i = end
        } else if (thisChar === '{' && token[i - 1] !== '\\') {
          const start = i
          let brackets = 1
          while (brackets > 0) {
            i++
            if (i >= tokenLength) {
              throw new Error('Missing } in text')
            }
            if (token[i] === '{') {
              brackets++
            } else if (token[i] === '}') {
              brackets--
            }
          }
          const end = i
          const content = token.substring(start + 1, end)
          parseTo(content)
          i++
          thisChar = token[i]
        }
        this.parser.progress.letter = i / (tokenLength - 1)
        this.parser.progress.currentLine = thisChar
        const specialChars = {
          '[': 'BOPEN',
          ']': 'BCLOSE',
          '(': 'POPEN',
          ')': 'PCLOSE',
          '{': 'COPEN',
          '}': 'CCLOSE',
          '"': 'QUOTE',
          ',': 'COMMA',
          ' ': 'SPACE',
          '\n': 'NEWLINE',
          '=': 'EQUAL'
        }
        if (specialChars[thisChar]) {
          thisChar = specialChars[thisChar]
        }
        if (thisChar.includes(' ')) {
          const [func, ...words] = thisChar.split(' ')
          if (!font.dynamicCharacters[func]) {
            throw new Error('Unknown word ' + func)
          }
          if (font.characters['EACH']) {
            ;(font.characters['EACH'] as any)()
          }
          if (font.dynamicCharacters['EACH']) {
            ;(font.dynamicCharacters['EACH'] as any)()
          }
          // debugger
          font.dynamicCharacters[func](...words)
        } else {
          if (font.characters['EACH']) {
            ;(font.characters['EACH'] as any)()
          }
          if (font.dynamicCharacters['EACH']) {
            ;(font.dynamicCharacters['EACH'] as any)()
          }
          let start = i
          while (
            !font.characters[thisChar] &&
            !font.dynamicCharacters[thisChar]
          ) {
            if (i >= tokenLength) {
              throw new Error('Unknown word ' + thisChar)
            }
            thisChar = token.substring(start, i)
            i++
          }
          if (font.dynamicCharacters[thisChar]) {
            ;(font.dynamicCharacters[thisChar] as any)()
          }
          if (font.characters[thisChar]) {
            ;(font.characters[thisChar] as any)()
          }
        }
        if (i >= tokenLength) {
          throw new Error('Missing " in text')
        }
        i++
      }

      if (font.characters['END'] && !add) {
        font.characters['END']()
      }
      if (font.dynamicCharacters['END'] && !add) {
        font.dynamicCharacters['END']()
      }
    }
  }

  resetFont(name: string) {
    if (this.parser.fonts[name]) {
      this.parser.fonts[name].reset()
    }
    return this.parser
  }

  keys(index: string | number) {
    this.text(
      this.parser.live.keys[Math.floor(this.parser.expressions.expr(index))]
    )
    return this.parser
  }

  regex(regex: string, seed: string | number = 0) {
    if (!this.parser.progress.regexCache[regex]) {
      const iterator = expand(regex).getIterator()
      const cache: string[] = []
      let next = iterator.next()
      while (!next.done) {
        cache.push(next.value)
        next = iterator.next()
        if (cache.length > 1000) break
      }
      this.parser.progress.regexCache[regex] = cache
    }
    const cache = this.parser.progress.regexCache[regex]
    const selectedText =
      cache[
        Math.floor(
          this.parser.constants['#'](
            (this.parser.progress.curve +
              this.parser.expressions.expr(seed)) as any
          ) * cache.length
        )
      ]!

    this.text(`"${selectedText}"`)
    return this.parser
  }

  // Clear caches when needed
  clearCaches() {
    this.fontCache.clear()
    this.characterCache.clear()
    this.regexCache.clear()
  }

  // Get cache statistics for monitoring
  getCacheStats() {
    return {
      fontCache: this.fontCache.size,
      characterCache: this.characterCache.size,
      regexCache: this.regexCache.size
    }
  }
}
