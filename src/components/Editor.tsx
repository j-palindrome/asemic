import Editor from '@monaco-editor/react'
import { editor } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'
import { Parser } from '../Parser'

interface Props {
  defaultValue: string
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
    const parserSignatures: Record<string, string> = {
      play: "play(play: AsemicData['play']): void",
      test: 'test(condition: Expr, callback?: () => void, callback2?: () => void): this',
      toPreset: 'toPreset(presetName: string, amount?: Expr): this',
      preset: 'preset(presetName: string, values: string): this',
      synth: 'synth(name: string, code: string): this',
      sc: 'sc(args: string): this',
      param:
        "param(paramName: string, { value, min, max, exponent }: InputSchema['params'][string]): this",
      repeat: 'repeat(count: string, callback: ExprFunc): this',
      debug: 'debug(slice?: number): string',
      scene:
        'scene(...scenes: { draw: () => void; setup?: () => void; length?: number; offset?: number; pause?: number }[]): this',
      set: "set(settings: Partial<this['settings']>): this",
      within:
        'within(coord0: string, coord1: string, callback: ExprFunc): this',
      center: 'center(coords: string, callback: () => void): this',
      each: 'each(makeCurves: () => void, callback: (pt: AsemicPt) => void): this',
      setup: 'setup(source: string): void',
      osc: 'osc(args: string): this',
      tri: 'tri(argsStr: string, { add }?: { add?: boolean }): this',
      squ: 'squ(argsStr: string, { add }?: { add?: boolean }): this',
      pen: 'pen(argsStr: string, { add }?: { add?: boolean }): this',
      hex: 'hex(argsStr: string): this',
      seq: 'seq(argsStr: string): this',
      circle: 'circle(argsStr: string): this',
      noise:
        'noise(value: number, frequencies: number[], phases?: number[]): number',
      parse: 'parse(text: string, args?: string[]): this',
      expr: 'expr(expr: Expr, replace?: boolean): number',
      choose: 'choose(value0To1: Expr, ...callbacks: (() => void)[]): this'
      // ...add more as needed...
    }

    // Helper to extract argument names from signature string
    function getSnippetArgs(signature: string) {
      const argsMatch = signature.match(/\(([^)]*)\)/)
      if (!argsMatch) return []
      return argsMatch[1]
        .split(',')
        .map(arg => arg.replace(/=[^,]+/, '').trim())
        .filter(arg => arg && !arg.startsWith('...'))
    }

    // Completion provider: only suggest function names
    monaco.languages.registerCompletionItemProvider('javascript', {
      provideCompletionItems: (model, position) => {
        const suggestions = Object.keys(parserSignatures).map(key => ({
          label: key,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${key}($0)`,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: parserSignatures[key],
          range: {
            startLineNumber: position.lineNumber,
            startColumn: model.getWordUntilPosition(position).startColumn,
            endLineNumber: position.lineNumber,
            endColumn: position.column
          },
          documentation: {
            value: `\`\`\`typescript\n${parserSignatures[key]}\n\`\`\``
          }
        }))
        return { suggestions }
      }
    })

    // Signature help provider: show argument hints when typing inside function calls
    monaco.languages.registerSignatureHelpProvider('javascript', {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: (model, position) => {
        // Get the text before the cursor
        const textUntilPosition = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        })
        // Find the last function call before the cursor
        const match = textUntilPosition.match(
          /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^()]*)$/
        )
        if (!match)
          return {
            value: { signatures: [], activeSignature: 0, activeParameter: 0 },
            dispose: () => {}
          }
        const funcName = match[1]
        const signature = parserSignatures[funcName]
        if (!signature)
          return {
            value: { signatures: [], activeSignature: 0, activeParameter: 0 },
            dispose: () => {}
          }
        const args = getSnippetArgs(signature)
        const paramsTyped = match[2].split(',').length - 1
        return {
          value: {
            signatures: [
              {
                label: signature,
                parameters: args.map(arg => ({ label: arg }))
              }
            ],
            activeSignature: 0,
            activeParameter: Math.max(0, paramsTyped)
          },
          dispose: () => {}
        }
      }
    })

    // Extend JavaScript tokenizer to highlight brackets and commas within strings
    monaco.languages.setMonarchTokensProvider('javascript', {
      tokenizer: {
        root: [
          // ...existing rules...
          [/"([^"\\]|\\.)*"/, 'string']
          // ...existing rules...
        ]
        // ...existing tokenizer states...
      }
    })

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      allowNonTsExtensions: true,
      noLib: true
    })

    monaco.editor.defineTheme('asemic-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'delimiter.parenthesis', foreground: '#4FC3F7' },
        { token: 'delimiter.bracket', foreground: '#1976D2' },
        { token: 'delimiter.brace', foreground: '#0D47A1' },
        { token: 'string', foreground: '#A0ABD9' }, // light blue for quoted strings
        { token: 'string.delimiter', foreground: '#FFD600' }, // yellow for quotes
        { token: 'string.comma', foreground: '#FFD600' }, // yellow for commas in strings
        { token: 'string.brace', foreground: '#FFD600' }, // yellow for {} in strings
        { token: 'string.bracket', foreground: '#FFD600' }, // yellow for [] in strings
        { token: 'string.parenthesis', foreground: '#FFD600' } // yellow for () in strings
      ],
      colors: {
        'editor.background': '#00000000',
        focusBorder: '#00000000', // Transparent border
        'editorWidget.border': '#00000000',
        'editorGroup.border': '#00000000',
        'editor.lineHighlightBackground': '#00000000',
        'editor.lineHighlightBorder': '#00000000',
        // Bracket highlight colors for nesting levels
        'editorBracketHighlight.foreground1': '#71CAF5',
        'editorBracketHighlight.foreground2': '#49AFDE',
        'editorBracketHighlight.foreground3': '#1994CF',
        'editorCodeLens.foreground': '#4FC3F7'
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
