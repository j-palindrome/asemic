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
  CompletionContext
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
}

export interface AsemicEditorRef {
  getValue: () => string
  setValue: (value: string) => void
  insertAtCursor: (text: string) => void
}

const AsemicEditor = forwardRef<AsemicEditorRef, Props>(
  ({ defaultValue, onChange, errors }, ref) => {
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
        'tri',
        'squ',
        'pen',
        'hex',
        'circle',
        'seq',
        'line',
        'to',
        'text',
        'font',
        'resetFont',
        'keys',
        'regex',
        'parse',
        'linden',
        'repeat',
        'within',
        'center',
        'each',
        'noise',
        'scene',
        'play',
        'param',
        'preset',
        'toPreset',
        'osc',
        'sc',
        'synth',
        'file',
        'group',
        'end',
        'points',
        'table',
        'expr',
        'choose',
        'defCollect'
      ]
      function parserCompletionSource(context: CompletionContext) {
        const word = context.matchBefore(/\w*/)
        if (!word || (word.from == word.to && !context.explicit)) return null
        return {
          from: word.from,
          options: drawingMethods.map(m => ({
            label: m,
            type: 'function'
          }))
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
          ])
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
      </div>
    )
  }
)

export default AsemicEditor
