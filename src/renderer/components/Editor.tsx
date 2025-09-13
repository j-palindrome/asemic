import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect
} from 'react'
import { drawSelection, EditorView } from '@codemirror/view'
import { EditorState, Prec } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { keymap } from '@codemirror/view'
import { autocompletion, CompletionContext } from '@codemirror/autocomplete'
import { Extension } from '@codemirror/state'
import { Parser } from '@/lib'

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
      const startState = EditorState.create({
        doc: defaultValue,

        extensions: [
          basicSetup,
          javascript(),
          oneDark,
          transparentTheme,
          Prec.highest(enterKeymap),
          autocompletion({ override: [parserCompletionSource] }),
          EditorView.lineWrapping,
          EditorState.allowMultipleSelections.of(true),
          drawSelection()
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

// DrawingMethods autocomplete source
const drawingMethods = ['tri', 'squ', 'pen', 'hex', 'circle', 'seq', 'line']

function parserCompletionSource(context: CompletionContext) {
  const word = context.matchBefore(/\w*/)
  if (!word || (word.from == word.to && !context.explicit)) return null
  return {
    from: word.from,
    options: drawingMethods.map(m => ({
      label: m,
      type: 'function',
      info: `DrawingMethods.${m}`
    }))
  }
}

export default AsemicEditor
