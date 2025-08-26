import { splitString } from '../../settings'
import { AsemicFont } from '../../defaultFont'
import { expand } from 'regex-to-strings'

export class TextMethods {
  parser: any

  constructor(parser: any) {
    this.parser = parser
  }

  text(token: string, { add = false }: { add?: boolean } = {}) {
    const font = this.parser.fonts[this.parser.currentFont]
    // Randomly select one character from each set of brackets for the text
    token = token.replace(
      /[^\\]\[([^\]]+[^\\])\](?:\{([^\}]+)\})?/g,
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

    for (let i = 0; i < token.length; i++) {
      if (token[i] === '\n') {
        if (font.characters['NEWLINE']) {
          ;(font.characters['NEWLINE'] as any)()
        }
      }
      if (token[i] === '{') {
        const start = i
        while (token[i] !== '}') {
          i++
          if (i >= token.length) {
            throw new Error('Missing } in text')
          }
        }
        const end = i
        this.parser.to(token.substring(start + 1, end))
        continue
      }
      this.parser.progress.letter = i / (token.length - 1)

      if (!font.characters[token[i]]) {
        continue
      }
      ;(font.characters[token[i]] as any)()
      if (font.characters['EACH']) {
        ;(font.characters['EACH'] as any)()
      }
    }
    if (font.characters['END'] && !add) {
      font.characters['END']()
    }

    return this.parser
  }

  font(sliced: string) {
    let chars: AsemicFont['characters'] = {}

    const [name, characterString] = splitString(sliced, /\s/)
    const characterMatches = this.parser.tokenize(characterString, {
      separateObject: true
    })
    for (let charMatch of characterMatches) {
      const [name, matches] = splitString(charMatch, '=')
      chars[name] = () => this.parser.parse(matches)
    }

    this.processFont(name, chars)

    return this.parser
  }

  processFont(name: string, chars: AsemicFont['characters']) {
    this.parser.currentFont = name
    if (chars) {
      if (!this.parser.fonts[name]) {
        this.parser.fonts[name] = new AsemicFont(this.parser, chars as any)
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
    this.text(
      cache[
        Math.floor(
          this.parser.hash(
            this.parser.progress.curve + this.parser.expr(seed)
          ) * cache.length
        )
      ]!
    )
    return this.parser
  }
}
