# AsemicExpressionEditor - Usage Guide

## Overview

The `AsemicExpressionEditor` component now includes integration with the Rust parser to evaluate Asemic expressions in real-time.

## Features

- **Syntax highlighting** for Asemic expression syntax
- **Autocomplete** for methods and constants
- **Rust-powered evaluation** via Tauri backend
- **Auto-evaluation mode** for real-time results
- **Manual evaluation** via imperative ref handle

## Basic Usage

```tsx
import { useRef, useState } from 'react'
import AsemicExpressionEditor, {
  AsemicExpressionEditorRef
} from '@/renderer/components/AsemicExpressionEditor'

function MyComponent() {
  const [expression, setExpression] = useState('2 + 3 * 4')
  const editorRef = useRef<AsemicExpressionEditorRef>(null)

  return <AsemicExpressionEditor value={expression} onChange={setExpression} />
}
```

## Manual Evaluation

```tsx
function MyComponent() {
  const [expression, setExpression] = useState('(+ 5 10)')
  const [result, setResult] = useState<number | null>(null)
  const editorRef = useRef<AsemicExpressionEditorRef>(null)

  const handleEvaluate = async () => {
    const evaluatedResult = await editorRef.current?.evaluateExpression()
    setResult(evaluatedResult)
  }

  return (
    <div>
      <AsemicExpressionEditor
        ref={editorRef}
        value={expression}
        onChange={setExpression}
      />
      <button onClick={handleEvaluate}>Evaluate</button>
      {result !== null && <div>Result: {result}</div>}
    </div>
  )
}
```

## Auto-Evaluation Mode

```tsx
function MyComponent() {
  const [expression, setExpression] = useState('T * 2')
  const [result, setResult] = useState<number | null>(null)
  const [error, setError] = useState<string | undefined>()

  return (
    <AsemicExpressionEditor
      value={expression}
      onChange={setExpression}
      autoEvaluate={true}
      onEvaluate={(evaluatedResult, evaluationError) => {
        if (evaluationError) {
          setError(evaluationError)
          setResult(null)
        } else {
          setResult(evaluatedResult)
          setError(undefined)
        }
      }}
    />
  )
}
```

## Evaluating Custom Expressions

You can also evaluate expressions that are different from the editor's current value:

```tsx
const editorRef = useRef<AsemicExpressionEditorRef>(null)

// Evaluate a specific expression
const result = await editorRef.current?.evaluateExpression('(* 3 (+ 2 5))')
```

## Props API

| Prop           | Type                                               | Default | Description                              |
| -------------- | -------------------------------------------------- | ------- | ---------------------------------------- |
| `value`        | `string`                                           | -       | Current expression text (controlled)     |
| `onChange`     | `(value: string) => void`                          | -       | Called when text changes                 |
| `placeholder`  | `string`                                           | `''`    | Placeholder text                         |
| `onEnter`      | `() => void`                                       | -       | Called when Enter key is pressed         |
| `onEvaluate`   | `(result: number \| null, error?: string) => void` | -       | Called after evaluation (auto or manual) |
| `autoEvaluate` | `boolean`                                          | `false` | If true, evaluates on every change       |

## Ref Methods

| Method               | Signature                                    | Description                                                                        |
| -------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `evaluateExpression` | `(expr?: string) => Promise<number \| null>` | Evaluates the given expression (or current value if omitted) using the Rust parser |

## Backend Implementation

The evaluation is powered by the Rust `ExpressionParser` in `src-tauri/src/parser/methods/expressions.rs`, which is called via the Tauri command `parser_eval_expression`.

### Supported Operations

- Basic arithmetic: `+`, `-`, `*`, `/`, `%`
- Logical operators: `&`, `|`, `^`, `_`
- Parentheses for grouping
- Function calls (when implemented)
- Constants (when implemented)

## Error Handling

Evaluation errors are caught and returned via the `onEvaluate` callback:

```tsx
onEvaluate={(result, error) => {
  if (error) {
    console.error('Evaluation failed:', error)
    // Show error to user
  } else {
    console.log('Success:', result)
    // Use the result
  }
}}
```

Common errors:

- "Empty expression" - The expression string is empty
- "Unknown function or constant: X" - The function/constant is not yet implemented
- "X is NaN" - Invalid number format
- Parse errors from malformed expressions
