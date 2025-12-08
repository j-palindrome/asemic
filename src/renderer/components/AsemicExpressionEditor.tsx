import React, { useRef, useEffect } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState, Prec } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import {
  autocompletion,
  CompletionContext,
  snippet
} from '@codemirror/autocomplete'
import { Extension } from '@codemirror/state'
import {
  LanguageSupport,
  LRLanguage,
  syntaxHighlighting,
  syntaxTree
} from '@codemirror/language'
// @ts-ignore
import { parser } from '@/lib/parser/text-lezer.grammar'
import { styleTags, tags as t } from '@lezer/highlight'
import { HighlightStyle } from '@codemirror/language'

// Transparent background theme
const transparentTheme: Extension = EditorView.theme({
  '&': { background: 'transparent !important' },
  '.cm-scroller, .cm-gutters': { background: 'transparent !important' },
  '.cm-content': { padding: '2px 4px' },
  '&.cm-focused': { outline: 'none' }
})

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  onEnter?: () => void
}

const AsemicExpressionEditor: React.FC<Props> = ({
  value,
  onChange,
  placeholder = '',
  onEnter
}) => {
  const editorDivRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!editorDivRef.current || viewRef.current) return

    const enterKeymap = keymap.of([
      {
        key: 'Enter',
        run: () => {
          if (onEnter) {
            onEnter()
            return true
          }
          return false
        }
      }
    ])

    const EXAMPLELanguage = LRLanguage.define({
      parser: parser.configure({
        props: [
          styleTags({
            StringContent: t.string,
            LineCommentContent: t.comment,
            RegExContent: t.regexp,
            'Name!': t.name,
            'CurlyName!': t.className,
            Letter: t.variableName,
            '( )': t.paren,
            '[ ]': t.squareBracket,
            '{ }': t.brace,
            Operator: t.operator,
            Number: t.number,
            Heading: t.operator
          })
        ]
      })
    })

    const exampleHighlight = HighlightStyle.define([
      { tag: t.operator, color: '#b4a7d6' },
      { tag: t.className, color: '#818cf8' },
      { tag: t.variableName, color: '#95d2ff' },
      { tag: t.name, color: '#9edbf1' },
      { tag: t.string, color: '#63989b' },
      { tag: t.comment, color: '#adbac7', class: 'font-serif' }
    ])

    const exprMethods = [
      {
        name: '~',
        args: ['waves:pt[modRatio,modAmp=1]'],
        group: '2-sine FM noise'
      },
      {
        name: 'sah',
        args: ['signal:num', 'trigger:num0to1'],
        group: 'sample and hold, with a trigger when > 0.5'
      },
      {
        name: '?',
        args: ['condition', '|', 'if+', '|', 'if0'],
        group: 'if statement'
      },
      {
        name: '>',
        group: 'fade between points',
        args: ['fade(0-1)', 'values...']
      },
      {
        name: 'choose',
        group: 'choose between options',
        args: ['fade(0-1)', '|', 'callbacks...']
      },
      {
        name: 'mix',
        group: 'normalized sum of values',
        args: ['values...']
      },
      {
        name: 'tangent',
        group: 'tangent point to curve (rotation 0-1)',
        args: ['pointNum', 'curveNum']
      },
      {
        name: 'peaks',
        group: 'hash',
        args: ['value=C', 'peaks:pt[value,width]...']
      }
    ]

    const constants = [
      {
        name: '#',
        group: 'hash',
        args: ['value=C']
      },
      {
        name: 'I',
        args: ['nesting=0'],
        group: 'current index of nested loop'
      },
      {
        name: 'N',
        args: ['nesting=0'],
        group: 'total count of nested loop'
      },
      {
        name: 'i',
        args: ['nesting=0'],
        group: 'current progress (0-1) of nested loop'
      },
      {
        name: 'T',
        args: ['speed=1'],
        group: 'current time in seconds'
      },
      {
        name: '!',
        args: [],
        group: 'NOT'
      },
      {
        name: 'H',
        args: ['*=1'],
        group: 'height-to-width ratio'
      },
      {
        name: 'px',
        args: ['*=1'],
        group: 'pixels'
      },
      {
        name: 'S',
        args: [],
        group: 'scrub through scene (0-1)'
      },
      {
        name: 'C',
        args: [],
        group: 'hash seed for current point'
      },
      {
        name: 'P',
        args: [],
        group: 'point progress'
      },
      {
        name: '~',
        args: ['freq=1'],
        group: 'FM-based noise'
      }
    ]

    function parserCompletionSource(context: CompletionContext) {
      const expr = context.matchBefore(/\([\w\~\>\<\#\?]*/)
      if (expr)
        return {
          from: expr.from + 1,
          options: exprMethods.map(({ name, args, group }) => {
            const argPlaceholders = args
              .map((arg, i) => (arg === '|' ? '|' : `#{${arg}}`))
              .join(' ')
            const snippetText =
              args.length > 0 ? `${name} ${argPlaceholders}` : name

            return {
              label: name,
              type: 'function',
              detail: group,
              apply: snippet(snippetText),
              info: args.length > 0 ? `${name} ${args.join(' ')}` : name
            }
          })
        }

      const constant = context.matchBefore(/[\w\~\>\<\#\?]+/)
      if (constant)
        return {
          from: constant.from,
          options: constants.map(({ name, args, group }) => {
            const snippetText = args.length > 0 ? `${name}#{${args[0]}}` : name

            return {
              label: name,
              type: 'function',
              detail: group,
              apply: snippet(snippetText),
              info: args.length > 0 ? `${name} ${args.join(' ')}` : name
            }
          })
        }
      return null
    }

    const startState = EditorState.create({
      doc: value,
      extensions: [
        transparentTheme,
        Prec.highest(enterKeymap),
        autocompletion({ override: [parserCompletionSource] }),
        new LanguageSupport(EXAMPLELanguage, [
          syntaxHighlighting(exampleHighlight)
        ]),
        EditorView.updateListener.of(update => {
          if (update.docChanged) {
            onChange(update.state.doc.toString())
          }
        }),
        EditorView.theme({
          '&': {
            height: 'auto',
            fontSize: '14px'
          },
          '.cm-scroller': {
            overflow: 'visible'
          },
          '.cm-content': {
            whiteSpace: 'nowrap'
          }
        })
      ]
    })

    viewRef.current = new EditorView({
      state: startState,
      parent: editorDivRef.current
    })

    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [])

  // Update editor content when value prop changes externally
  useEffect(() => {
    if (viewRef.current) {
      const currentValue = viewRef.current.state.doc.toString()
      if (currentValue !== value) {
        viewRef.current.dispatch({
          changes: {
            from: 0,
            to: viewRef.current.state.doc.length,
            insert: value
          }
        })
      }
    }
  }, [value])

  return (
    <div
      ref={editorDivRef}
      className='inline-block min-w-[100px] text-white'
      style={{ lineHeight: '1.5' }}
    />
  )
}

export default AsemicExpressionEditor
