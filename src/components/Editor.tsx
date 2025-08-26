import Editor from '@monaco-editor/react'
import { editor } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'

interface Props {
  defaultValue: string
  onKeyDown: (ev: React.KeyboardEvent<HTMLDivElement>) => void
  onChange: (value: string | undefined) => void
  errors: string[]
}

export default function AsemicEditor({
  defaultValue,
  onChange,
  errors
}: Props) {
  const handleEditorDidMount = (
    editor: editor.IStandaloneCodeEditor,
    monaco: Monaco
  ) => {
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true
    })

    monaco.editor.defineTheme('asemic-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#00000000',
        focusBorder: '#00000000', // Transparent border
        'editorWidget.border': '#00000000',
        'editorGroup.border': '#00000000',
        'editor.lineHighlightBackground': '#00000000',
        'editor.lineHighlightBorder': '#00000000'
      }
    })
    monaco.editor.setTheme('asemic-theme')

    const model = monaco.editor.createModel(defaultValue, 'javascript')
    editor.setModel(model)

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onChange(editor.getValue())
    })
  }

  return (
    <div className='flex h-full w-full relative *:flex-none'>
      <div
        className={`editor text-white ${
          errors.length > 0 ? 'w-2/3' : 'w-full'
        }`}>
        <Editor
          height='100%'
          defaultLanguage='plaintext'
          theme='vs-dark'
          defaultValue={defaultValue}
          onMount={handleEditorDidMount}
          options={{
            tabSize: 2,
            copyWithSyntaxHighlighting: true,
            'semanticHighlighting.enabled': true,
            minimap: { enabled: false },
            wordWrap: 'on',
            lineNumbers: 'off',
            glyphMargin: false,
            folding: true,
            scrollBeyondLastLine: false,
            scrollbar: {
              vertical: 'auto',
              horizontal: 'hidden'
            }
          }}
        />
      </div>
      {errors.length > 0 && (
        <div className='editor !text-red-400 w-1/3'>
          {errors.join('\n---\n')}
        </div>
      )}
    </div>
  )
}
