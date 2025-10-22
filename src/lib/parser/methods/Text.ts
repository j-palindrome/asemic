import { splitString } from '../../settings'
import { expand } from 'regex-to-strings'
import { Parser } from '../Parser'
import { split } from 'lodash'
import invariant from 'tiny-invariant'
import { AsemicFont } from '@/lib/AsemicFont'

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

  linden(
    iterations: string,
    text: string,
    rules: Record<string, string> | string
  ) {
    if (typeof rules === 'string') {
      const rulesObj = Object.fromEntries(
        this.parser
          .tokenize(rules.slice(1, -1))
          .map(rule => splitString(rule, '='))
      )
      rules = rulesObj
    }
    const applyRules = (text: string) => {
      let textList = text.split('')
      for (const [key, value] of Object.entries(rules)) {
        textList = textList.map(x => (x === key ? value : x))
      }
      return textList.join('')
    }

    for (let i = 0; i < this.parser.expr(iterations); i++) {
      text = applyRules(text)
    }
    this.parser.text(`${text}`)
    return this.parser
  }

  parse(text: string) {
    const scenes = text.split('\n#')
    let sceneList: Parameters<Parser['scene']> = []
    for (const scene of scenes) {
      if (scene.trim() === '') continue
      const [firstLine, rest] = splitString(scene, '\n')
      const parserSettings = {
        draw: () => {
          this.parser.text(rest)
        }
      } as (typeof sceneList)[number]
      const match = firstLine.match(/\{(.+)\}/)?.[1]
      if (match) {
        this.parser.tokenize(match).forEach(setting => {
          if (!setting.includes('=')) return
          const [key, value] = splitString(setting, '=')
          parserSettings[key] = this.parser.expr(value)
        })
      }
      sceneList.push(parserSettings)
    }
    this.parser.scene(...sceneList)
    return this.parser
  }

  text(token: string) {
    token = token.replace(/\/\/.+/gm, '')
    const parseTo = (content: string) => {
      const spaceIndex = /\s/.exec(content)?.index

      if (spaceIndex && /^[a-z]+$/.test(content.substring(0, spaceIndex))) {
        const [fontName, chars] = splitString(content, /\s+/)
        const charTokens = this.parser.tokenize(chars)
        const eachChars: Record<string, () => void> = {}
        const eachDynamicChars: Record<string, () => void> = {}
        charTokens.forEach(line => {
          if (line === '!') {
            this.parser.resetFont(fontName)
            return
          }
          let [_, char, expression, func] = line.match(/([^=]+)(\=\>?)(.+)/)!
          char = char.trim().replaceAll(/"/g, '')
          expression = expression.trim()
          func = func.trim()
          invariant(char, 'Character is required')
          invariant(expression, 'Expression is required')
          invariant(func, 'Function is required')
          if (func === '!') {
            switch (expression) {
              case '=':
                this.parser.fonts[fontName].resetCharacter(char)
                break
              case '=>':
                this.parser.fonts[fontName].resetCharacter(char, {
                  dynamic: true
                })
                break
            }
          } else {
            switch (expression) {
              case '=':
                eachChars[char] = () => this.parser.text(func)
                break
              case '=>':
                eachDynamicChars[char] = () => this.parser.text(func)
                break
            }
          }
        })
        this.parser.font(fontName, eachChars, eachDynamicChars)
      } else {
        this.parser.to(content)
      }
    }
    const tokenLength = token.length
    for (let i = 0; i < tokenLength; i++) {
      const char = token[i]

      if (char === '/') {
        i++
        const start = i
        while (token[i] !== '/' || token[i - 1] === '\\') {
          i++
          if (i >= tokenLength) {
            throw new Error('Missing / in text')
          }
        }
        const end = i
        const content = token.substring(start, end)
        this.parser.progress.currentLine = content
        this.parser.regex(content)
        continue
      }

      if (char === '(' && token[i - 1] !== '\\') {
        const start = i
        let parentheses = 1
        while (parentheses > 0) {
          i++
          if (i >= tokenLength) {
            throw new Error('Missing ) in text')
          }
          if (token[i] === '(') {
            parentheses++
          } else if (token[i] === ')') {
            parentheses--
          }
        }
        const end = i

        const [funcName, args] = splitString(
          token.substring(start + 1, end),
          ' '
        )

        this.parser.progress.currentLine = token

        if (
          this.parser[funcName as keyof Parser] &&
          typeof this.parser[funcName as keyof Parser] === 'function'
        ) {
          const newFunc = this.parser[funcName as keyof Parser] as Function
          newFunc.bind(this.parser)(...this.parser.tokenize(args))
        } else {
          throw new Error(`Unknown function: ${funcName}`)
        }
      }

      if (char === '[') {
        const start = i
        let count = 1
        while (count > 0) {
          i++
          if (i >= tokenLength) {
            throw new Error('Missing ] in text')
          }
          if (token[i] === '[') {
            count++
          } else if (token[i] === ']') {
            count--
          }
        }

        const end = i
        const content = token.substring(start + 1, end)
        this.parser.progress.currentLine = content
        this.parser.points(content)
        if (token[end + 1] === '+') {
          i++
        } else if (token[end + 1] === '<') {
          this.parser.end({ close: true })
        } else {
          this.parser.end()
        }
        continue
      }

      if (char === '{') {
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
        this.parser.progress.currentLine = content
        parseTo(content)
        continue
      }

      if (char === '"') {
        let add = false
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
        while (token[i] !== '"' || token[i - 1] === '\\') {
          let thisChar = token[i]
          if (thisChar === '(' && token[i - 1] !== '\\') {
            const end = token.indexOf(')', i)
            if (end === -1) {
              throw new Error('Missing ) in text')
            }
            const content = token.substring(i + 1, end)
            thisChar = content
            i = end
          }
          if (thisChar === '{') {
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
          if (thisChar === '\n') {
            if (font.characters['NEWLINE']) {
              ;(font.characters['NEWLINE'] as any)()
            }
            if (font.dynamicCharacters['NEWLINE']) {
              ;(font.dynamicCharacters['NEWLINE'] as any)()
            }
          } else if (thisChar === ' ') {
            if (font.characters['EACH']) {
              ;(font.characters['EACH'] as any)()
            }
            if (font.dynamicCharacters['EACH']) {
              ;(font.dynamicCharacters['EACH'] as any)()
            }
            if (font.characters['SPACE']) {
              ;(font.characters['SPACE'] as any)()
            }
            if (font.dynamicCharacters['SPACE']) {
              ;(font.dynamicCharacters['SPACE'] as any)()
            }
          } else if (!font.characters[thisChar]) {
          } else {
            if (font.characters['EACH']) {
              ;(font.characters['EACH'] as any)()
            }
            if (font.dynamicCharacters['EACH']) {
              ;(font.dynamicCharacters['EACH'] as any)()
            }
            // if (font.characters['EACH2']) {
            //   this.parser.to('>')
            //   ;(font.characters['EACH2'] as any)()
            // }
            ;(font.characters[thisChar] as any)()
            if (font.dynamicCharacters[thisChar]) {
              ;(font.dynamicCharacters[thisChar] as any)()
            }
            // if (font.characters['EACH2']) {
            //   this.parser.to('<')
            // }
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
      continue
    }

    return this.parser
  }

  resetFont(name: string) {
    if (this.parser.fonts[name]) {
      this.parser.fonts[name].reset()
    }
    return this.parser
  }

  font(
    name: string,
    chars: AsemicFont['characters'],
    dynamicChars: AsemicFont['characters'] = {}
  ) {
    this.parser.currentFont = name
    if (chars) {
      if (!this.parser.fonts[name]) {
        this.parser.fonts[name] = new AsemicFont(
          this.parser,
          chars,
          dynamicChars
        )
      } else {
        this.parser.fonts[name].parseCharacters(chars)
        this.parser.fonts[name].parseCharacters(dynamicChars, { dynamic: true })
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
