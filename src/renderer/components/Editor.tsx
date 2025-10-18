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
  syntaxHighlighting,
  syntaxTree
} from '@codemirror/language'
// @ts-ignore
import { parser } from '@/lib/parser/text-lezer.grammar' // <-- You must compile your grammar to JS
import { styleTags, tags as t, tags } from '@lezer/highlight'
import { foldNodeProp, foldInside, indentNodeProp } from '@codemirror/language'
import { printTree } from './lezerPrettyPrint'
import { HighlightStyle } from '@codemirror/language'
import helpText from '@/lib/help.md?raw'
import Markdown from 'react-markdown'
import { SyntaxNode } from '@lezer/common'

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
              'Name!': t.className,
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
        { tag: t.className, color: '#6366f1' },
        { tag: t.variableName, color: '#d97706' }
      ])

      const drawingMethods = [
        {
          name: 'tri',
          args: ['start:pt', 'end:pt', 'h:number', 'w:number'],
          group: '3-point curve'
        },
        {
          name: 'squ',
          args: ['start:pt', 'end:pt', 'h:number', 'w:number'],
          group: '4-point curve'
        },
        {
          name: 'pen',
          args: ['start:pt', 'end:pt', 'h:number', 'w:number'],
          group: '5-point curve'
        },
        {
          name: 'hex',
          args: ['start:pt', 'end:pt', 'h:number', 'w:number'],
          group: '6-point curve'
        },
        {
          name: 'circle',
          args: ['start:pt', 'w,h:pt'],
          group: 'circle extending left and up from start'
        },
        {
          name: 'linden',
          args: ['iterations:num', 'axiom:string', '|', 'rules:object'],
          group: 'lindenmayer system to generate text strings'
        },
        {
          name: 'repeat',
          args: ['count:pt', '|', 'callbacks...'],
          group: 'nested repeats cascading left->right'
        },
        {
          name: 'bepeat',
          args: ['count:pt', '|', 'callbacks...'],
          group: 'nested repeats cascading right->left'
        },
        {
          name: 'within',
          args: ['bottom,left:pt', 'top,right:pt', '|', 'callback'],
          group: 'stretch drawing to box'
        },
        {
          name: 'align',
          args: ['anchor:pt', 'align:pt(0-1)', '|', 'callback'],
          group: 'align horizontally and vertically using anchor point'
        },
        {
          name: 'alignX',
          args: ['x:num', 'align:num(0-1)', '|', 'callbacks...'],
          group: 'center each callback horizontally using anchor point'
        },
        {
          name: 'add',
          args: ['add:pt', '|', 'callback'],
          group: 'modify each curve drawn in callback'
        },
        {
          name: 'interp',
          args: ['count:num', '|', 'callback'],
          group: 'interpolate between each point'
        },
        {
          name: 'group',
          args: [
            'count=100',
            'mode:line|curve=line',
            'curve=false',
            'vert:wgsl=0,0',
            'a:wgsl',
            'correction=0'
          ],
          group: 'start new group'
        },
        { name: 'end', args: [], group: 'end current curve' },
        { name: 'end', args: [], group: 'end current curve' }
      ]

      const exprMethods = [
        {
          name: '~',
          args: ['freq', 'fm=PHI', 'modulation=2', 'step=0'],
          group: '2-sine FM noise optionally stepped'
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
          args: ['value=C']
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
          args: ['freq'],
          group: 'noise'
        }
      ]

      const toMethods = [
        { name: '*', args: ['x,y'], group: 'scale' },
        { name: '+', args: ['x,y'], group: 'translate' },
        { name: '@', args: ['angle(0-1)'], group: 'rotate (clockwise)' },
        { name: '*>', args: ['pt'], group: 'scale jitter' },
        { name: '+>', args: ['pt'], group: 'translate jitter' },
        { name: '@>', args: ['angle(0-1)'], group: 'rotation jitter' },
        { name: 'a=', args: ['value'], group: 'alpha (0-1)' },
        { name: 'h=', args: ['value'], group: 'hue (0-1)' },
        { name: 's=', args: ['value'], group: 'saturation (0-1)' },
        { name: 'l=', args: ['value'], group: 'luminosity (0-1)' },
        { name: 'w=', args: ['value'], group: 'width (in px)' },
        { name: 'a=>', args: ['expr'], group: 'alpha (0-1)' },
        { name: 'h=>', args: ['expr'], group: 'hue (0-1)' },
        { name: 's=>', args: ['expr'], group: 'saturation (0-1)' },
        { name: 'l=>', args: ['expr'], group: 'luminosity (0-1)' },
        { name: 'w=>', args: ['expr'], group: 'width (in px)' },
        { name: '!', args: [], group: 'reset transform' },
        { name: '<', args: ['name?'], group: 'pop' },
        { name: '>', args: ['name?'], group: 'push' }
      ]

      function parserCompletionSource(context: CompletionContext) {
        const to = context.matchBefore(/\{[^\}]*/)
        if (to) {
          const tree = syntaxTree(context.state)
          const node = tree.resolveInner(context.pos, 0).lastChild

          if (node && !node.parent?.name.includes('Expr')) {
            return {
              from: node.from,
              options: toMethods.map(({ name, args, group }) => {
                // Create snippet with argument placeholders
                const argPlaceholders = args
                  .map((arg, i) => `#{${arg}}`)
                  .join('')
                const snippetText =
                  args.length > 0 ? `${name}${argPlaceholders}` : name

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
        }
        const word = context.matchBefore(/^[\|\s]*\([\w\~\>\<\#\?]*/)
        if (word)
          return {
            from: word.from + word.text.indexOf('(') + 1,
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

        const expr = context.matchBefore(/\([\w\~\>\<\#\?]*/)
        if (expr)
          return {
            from: expr.from + 1,
            options: exprMethods.map(({ name, args, group }) => {
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

        const constant = context.matchBefore(/[\w\~\>\<\#\?]+/)
        if (constant)
          return {
            from: constant.from,
            options: constants.map(({ name, args, group }) => {
              const snippetText =
                args.length > 0 ? `${name}#{${args[0]}}` : name

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
        doc: defaultValue,

        extensions: [
          basicSetup,
          transparentTheme,
          Prec.lowest(oneDark),
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
