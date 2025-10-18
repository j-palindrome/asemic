import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect
} from 'react'
import {
  drawSelection,
  EditorView,
  Decoration,
  ViewPlugin,
  DecorationSet
} from '@codemirror/view'
import { EditorState, Prec, RangeSetBuilder } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap } from '@codemirror/view'
import {
  autocompletion,
  completeFromList,
  CompletionContext,
  snippet
} from '@codemirror/autocomplete'
import { Extension } from '@codemirror/state'
import { Parser } from '@/lib'
import {
  delimitedIndent,
  LanguageSupport,
  LRLanguage,
  syntaxHighlighting
} from '@codemirror/language'
// @ts-ignore
import { parser } from '@/lib/parser/text-lezer.grammar' // <-- You must compile your grammar to JS
import { styleTags, tags as t, tags } from '@lezer/highlight'
import { foldNodeProp, foldInside, indentNodeProp } from '@codemirror/language'
import { printTree } from './lezerPrettyPrint'
import { HighlightStyle } from '@codemirror/language'
import helpText from '@/lib/help.md?raw'
import Markdown from 'react-markdown'

// Transparent background theme
const transparentTheme: Extension = EditorView.theme({
  '&': { background: 'transparent !important' },
  '.cm-scroller, .cm-gutters': { background: 'transparent !important' }
})

// Dynamically extract public method names from Parser

interface Props {
  defaultValue: string
  onChange: (value: string | undefined) => void
  errors: string[]
  help: boolean
  setHelp: (help: boolean) => void
}

export interface AsemicEditorRef {
  getValue: () => string
  setValue: (value: string) => void
  insertAtCursor: (text: string) => void
}

const AsemicEditor = forwardRef<AsemicEditorRef, Props>(
  ({ help, setHelp, defaultValue, onChange, errors }, ref) => {
    const editorDivRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef<EditorView | null>(null)

    useImperativeHandle(
      ref,
      () => ({
        getValue: () => viewRef.current?.state.doc.toString() ?? '',
        setValue: (value: string) => {
          if (viewRef.current) {
            viewRef.current.dispatch({
              changes: {
                from: 0,
                to: viewRef.current.state.doc.length,
                insert: value
              }
            })
          }
        },
        insertAtCursor: (text: string) => {
          if (viewRef.current) {
            const { state } = viewRef.current
            const selection = state.selection.main
            viewRef.current.dispatch({
              changes: {
                from: selection.from,
                to: selection.to,
                insert: text
              },
              selection: { anchor: selection.from + text.length }
            })
          }
        }
      }),
      []
    )

    useEffect(() => {
      if (!editorDivRef.current) return
      if (viewRef.current) return
      const enterKeymap = keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            // console.log(viewRef.current?.state.doc.toString())
            onChange(viewRef.current?.state.doc.toString())
            return true
          }
        }
      ])

      // Ensure 'parser' is a Lezer Parser instance, not a LanguageSupport

      const EXAMPLELanguage = LRLanguage.define({
        parser: parser.configure({
          props: [
            indentNodeProp.add({
              Application: delimitedIndent({ closing: ')', align: false })
            }),
            foldNodeProp.add({
              Application: foldInside
            }),
            styleTags({
              StringContent: t.string,
              LineCommentContent: t.comment,
              RegExContent: t.regexp,
              Letter: t.variableName,
              'Name/...': t.className,
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
        { tag: t.string, color: '#82aaff' }, // blue
        { tag: t.variableName, color: '#c792ea' }, // purple
        { tag: t.number, color: '#f78c6c' }, // orange
        { tag: t.keyword, color: '#ffcb6b' }, // yellow
        { tag: t.operator, color: '#ffcb6b' }, // yellow
        { tag: t.comment, color: '#546e7a', fontStyle: 'italic' }, // muted blue
        { tag: t.paren, color: '#c792ea' }, // purple
        { tag: t.squareBracket, color: '#c792ea' }, // purple
        { tag: t.brace, color: '#c792ea' }, // purple
        { tag: t.punctuation, color: '#ffcb6b' } // yellow
      ])

      const drawingMethods = [
        {
          name: 'tri',
          args: ['start:pt', 'end:pt', 'h:number', 'w:number'],
          group: 'Drawing'
        },
        {
          name: 'squ',
          args: ['start:pt', 'end:pt', 'h:number', 'w:number'],
          group: 'Drawing'
        },
        {
          name: 'pen',
          args: ['start:pt', 'end:pt', 'h:number', 'w:number'],
          group: 'Drawing'
        },
        {
          name: 'hex',
          args: ['start:pt', 'end:pt', 'h:number', 'w:number'],
          group: 'Drawing'
        },
        {
          name: 'circle',
          args: ['center:pt', 'w,h:pt'],
          group: 'Drawing'
        },
        {
          name: 'linden',
          args: ['iterations:pt', 'axiom:string', '|', 'rules:object'],
          group: 'Lindenmayer system to generate text strings'
        },
        {
          name: 'repeat',
          args: ['count:pt', '|', 'callbacks...'],
          group: 'Nested repeats cascading left->right'
        },
        {
          name: 'bepeat',
          args: ['count:pt', '|', 'callbacks...'],
          group: 'Nested repeats cascading right->left'
        },
        {
          name: 'within',
          args: ['bottom,left:pt', 'top,right:pt', '|', 'callback'],
          group: 'Stretch drawing to box'
        },
        {
          name: 'align',
          args: ['anchor:pt', 'align:pt(0-1)', '|', 'callback'],
          group: 'Align horizontally and vertically using anchor point'
        },
        {
          name: 'alignX',
          args: ['x:num', 'align:num(0-1)', '|', 'callbacks...'],
          group: 'Center horizontally using anchor point'
        },
        {
          name: 'add',
          args: ['add:pt', '|', 'callback'],
          group: 'Modify each curve drawn in callback'
        },
        { name: 'group', args: [] },
        { name: 'end', args: [] }
      ]

      function parserCompletionSource(context: CompletionContext) {
        const word = context.matchBefore(/\w*/)
        if (!word || word.from == word.to) return null

        return {
          from: word.from,
          options: drawingMethods.map(({ name, args, group }) => {
            // Create snippet with argument placeholders
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
      }

      const startState = EditorState.create({
        doc: defaultValue,

        extensions: [
          basicSetup,
          oneDark,
          transparentTheme,
          Prec.highest(enterKeymap),
          autocompletion({ override: [parserCompletionSource] }),
          EditorView.lineWrapping,
          EditorState.allowMultipleSelections.of(true),
          drawSelection(),
          new LanguageSupport(EXAMPLELanguage, [
            syntaxHighlighting(exampleHighlight)
          ]),
          EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': { overflow: 'auto' }
          })
        ]
      })

      viewRef.current = new EditorView({
        state: startState,
        parent: editorDivRef.current
      })

      const parseAndLog = () => {
        if (viewRef.current) {
          const doc = viewRef.current.state.doc.toString()
          const tree = EXAMPLELanguage.parser.parse(doc)
          console.log(printTree(tree, doc))
        }
      }

      // Parse and print the result once on mount
      parseAndLog()
      return () => {
        viewRef.current?.destroy()
        viewRef.current = null
      }
    }, [])

    return (
      <div className='flex h-0 grow w-full relative'>
        <div
          className={`editor text-white ${
            errors.length > 0 ? 'w-2/3' : 'w-full'
          }`}
          style={{ height: '100%' }}>
          <div ref={editorDivRef} style={{ height: '100%' }} />
        </div>
        {errors.length > 0 && (
          <div className='editor !text-red-400 w-1/3'>
            {errors.join('\n---\n')}
          </div>
        )}
        {help && (
          <div className='absolute top-0 left-0 w-full h-full bg-black/90 text-white p-4 text-sm overflow-auto z-50'>
            <Markdown>{helpText}</Markdown>
          </div>
        )}
      </div>
    )
  }
)

export default AsemicEditor
