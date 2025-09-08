import { splitString } from '../../settings'
import { AsemicFont } from '../../defaultFont'
import { expand } from 'regex-to-strings'
import { Parser } from '../Parser'

export class TextMethods {
  parser: Parser

  // Performance caches
  private fontCache = new Map<string, AsemicFont>()
  private characterCache = new Map<string, string>()
  private regexCache = new Map<string, RegExp>()

  // Pre-compiled regex for bracket replacements
  private static readonly BRACKET_REGEX =
    /[^\\]\[([^\]]+[^\\])\](?:\{([^\}]+)\})?/g

  constructor(parser: Parser) {
    this.parser = parser
  }

  text(token: string) {
    let add = false
    if (token.startsWith('+')) {
      add = true
      token = token.slice(1)
    }
    const font = this.parser.fonts[this.parser.currentFont]
    // Randomly select one character from each set of brackets for the text
    token = token.replace(
      TextMethods.BRACKET_REGEX,
      (options: string, substring: string, count: string) => {
        if (count) {
          const numTimes = parseFloat(count)
          let newString = ''
          for (let i = 0; i < numTimes; i++) {
            this.parser.progress.seed++
            newString +=
              substring[Math.floor(this.parser.hash(1) * substring.length)]
          }
          return newString
        } else {
          this.parser.progress.seed++
          return substring[Math.floor(this.parser.hash(1) * substring.length)]
        }
      }
    )

    if (font.characters['START'] && !add) {
      font.characters['START']()
    }

    const tokenLength = token.length
    for (let i = 0; i < tokenLength; i++) {
      const char = token[i]

      if (char === '{') {
        const start = i
        while (token[i] !== '}') {
          i++
          if (i >= tokenLength) {
            throw new Error('Missing } in text')
          }
        }
        const end = i
        this.parser.to(token.substring(start + 1, end))
        continue
      }

      this.parser.progress.letter = i / (tokenLength - 1)

      if (char === '\n') {
        if (font.characters['NEWLINE']) {
          ;(font.characters['NEWLINE'] as any)()
        }
        continue
      } else if (!font.characters[char]) {
        continue
      }

      if (font.characters['EACH']) {
        ;(font.characters['EACH'] as any)()
      }
      if (font.characters['EACH2']) {
        this.parser.to('>')
        ;(font.characters['EACH2'] as any)()
      }
      ;(font.characters[char] as any)()
      if (font.characters['EACH2']) {
        this.parser.to('<')
      }
    }

    if (font.characters['END'] && !add) {
      font.characters['END']()
    }

    return this.parser
  }

  resetFont(name: string) {
    if (this.parser.fonts[name]) {
      this.parser.fonts[name].reset()
    }
    return this.parser
  }

  font(name: string, chars: AsemicFont['characters']) {
    this.parser.currentFont = name
    if (chars) {
      if (!this.parser.fonts[name]) {
        this.parser.fonts[name] = new AsemicFont(this.parser, chars)
      } else {
        this.parser.fonts[name].parseCharacters(chars)
      }
    }
    return this.parser
  }

  keys(index: string | number) {
    this.text(this.parser.live.keys[Math.floor(this.parser.expr(index))])
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
          this.parser.hash(
            this.parser.progress.curve + this.parser.expr(seed)
          ) * cache.length
        )
      ]!

    this.text(selectedText)
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
