import { splitString } from '../../settings'
import { AsemicFont } from '../../defaultFont'
import { expand } from 'regex-to-strings'
import { Parser } from '../Parser'
import { split } from 'lodash'
import invariant from 'tiny-invariant'
import { parserObject } from './Utilities'

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

  linden(iterations: string, text: string, rules: Record<string, string>) {
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
    const scenes = text.split('\n# ')
    let sceneList: Parameters<Parser['scene']> = []
    for (const scene of scenes) {
      if (scene.trim() === '') continue
      const [firstLine, rest] = splitString(scene, '\n')
      const parserSettings = {
        draw: () => {
          this.parser.text(rest)
        }
      } as (typeof sceneList)[number]
      this.parser.tokenize(firstLine).forEach(setting => {
        if (!setting.includes('=')) return
        const [key, value] = splitString(setting, '=')
        parserSettings[key] = this.parser.expr(value)
      })

      sceneList.push(parserSettings)
    }
    this.parser.scene(...sceneList)
    return this.parser
  }

  text(token: string) {
    // Replace // with JS comments in the token
    token = token.replace(/\/\/.+/gm, '')
    const parseTo = (content: string) => {
      const spaceIndex = content.indexOf(' ')

      if (spaceIndex > 0 && /^[a-z]+$/.test(content.substring(0, spaceIndex))) {
        const [fontName, chars] = splitString(content, /\s+/)
        const charTokens = this.parser.tokenize(chars)
        const eachChars: Record<string, () => void> = {}
        const eachDynamicChars: Record<string, () => void> = {}
        charTokens.forEach(line => {
          if (line === '!') {
            this.parser.resetFont(fontName)
            return
          }
          const [_, char, expression, func] = line.match(/(\w+)(\=\>?)(.+)/)!
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

        const parserObject = (args: string) => {
          const obj: { [key: string]: any } = {}
          for (let arg of this.parser.tokenize(args)) {
            if (arg.includes('=')) {
              const [key, value] = splitString(arg, '=')
              obj[key] = value
            }
          }
          return obj
        }
        // Process the content within parentheses as needed
        switch (funcName) {
          case 'group':
            this.parser.group(parserObject(args) as any)
            break
          case 'font':
            this.parser.error(
              'use {fontname ...chars} instead of (font fontname chars)'
            )
            break
          case 'linden':
            const [count, textStr, rules] = this.parser.tokenize(args)
            const rulesObj = Object.fromEntries(
              this.parser
                .tokenize(rules.slice(1, -1))
                .map(rule => splitString(rule, '='))
            )
            this.parser.linden(count, textStr, rulesObj)
            break
          case 'log':
            let parser = this.parser
            invariant(parser)
            // @ts-ignore
            this.parser.error(eval(args))
            break
          // Add more cases for other functions if needed
          default:
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
      }

      if (char === '[') {
        const start = i
        while (token[i] !== ']') {
          i++
          if (i >= tokenLength) {
            throw new Error('Missing ] in text')
          }
        }
        const end = i
        const content = token.substring(start + 1, end)
        this.parser.points(content)
        if (token[end + 1] === '+') {
          i++
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
        while (token[i] !== '"' || token[i - 1] === '\\') {
          let thisChar = token[i]
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
          if (thisChar === '\n') {
            if (font.characters['NEWLINE']) {
              ;(font.characters['NEWLINE'] as any)()
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
            if (i >= tokenLength) {
              throw new Error('Missing " in text')
            }
          }
          i++
        }

        if (font.characters['END'] && !add) {
          font.characters['END']()
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
