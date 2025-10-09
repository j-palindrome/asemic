# Asemic Parser - Python to WebAssembly

This directory contains the Python implementation of the Asemic Parser and tools to compile it to WebAssembly for use in JavaScript environments.

## Overview

The Python parser can be used in JavaScript through Pyodide, which compiles Python to WebAssembly. This allows the full Python parser to run in the browser without any server-side code.

## Files

- `parser.py` - Main Python parser implementation
- `pyodide-bridge.js` - JavaScript wrapper for the Python parser
- `demo.html` - Interactive demo showing the parser in action
- `build-wasm.sh` - Build script for creating a custom WASM bundle (optional)

## Quick Start

### Method 1: Using Pyodide CDN (Easiest)

Simply open `demo.html` in a web browser. It will automatically:

1. Load Pyodide from CDN
2. Load the Python parser
3. Provide an interactive interface to test the parser

```bash
# Start a simple HTTP server
python3 -m http.server 8000

# Open in browser
open http://localhost:8000/demo.html
```

### Method 2: Using in Your JavaScript Project

```javascript
import { AsemicParser } from './pyodide-bridge.js'

// Initialize parser
const parser = await AsemicParser.create()

// Parse Asemic code
parser.parse(`
# scene1
tri 0.5 0.5 0.2
circle 0.3 0.7 0.1 0.1
`)

// Get results
const state = parser.getState()
console.log(state.groups) // Array of curves
console.log(state.errors) // Any errors

// Draw next frame
parser.scrub(0.5) // Scrub to 0.5 seconds
const groups = parser.getGroups()
```

### Method 3: Standalone Function

```javascript
import { parseAsemic } from './pyodide-bridge.js'

const result = await parseAsemic(`
# scene1
tri 0.5 0.5 0.2
`)

console.log(result)
```

## API Reference

### AsemicParser Class

#### `static async create()`

Create a new parser instance. Must be called before using the parser.

```javascript
const parser = await AsemicParser.create()
```

#### `parse(source: string)`

Parse Asemic source code and update the parser state.

```javascript
parser.parse('tri 0.5 0.5 0.2')
```

#### `getState(): Object`

Get the complete parser state including groups, errors, parameters, etc.

```javascript
const state = parser.getState()
// Returns: { groups, errors, osc, sc, progress, totalLength, params, presets }
```

#### `expr(expression: string): number`

Evaluate a single expression.

```javascript
const result = parser.expr('sin(0.5) + 2')
```

#### `setParam(name: string, value: number)`

Set a parameter value.

```javascript
parser.setParam('speed', 0.8)
```

#### `getParam(name: string): number`

Get a parameter value.

```javascript
const speed = parser.getParam('speed')
```

#### `scrub(time: number)`

Jump to a specific time in the animation and redraw.

```javascript
parser.scrub(1.5) // Jump to 1.5 seconds
```

#### `reset()`

Reset the parser state.

```javascript
parser.reset()
```

#### `getGroups(): Array`

Get the current rendered groups (curves).

```javascript
const groups = parser.getGroups()
```

#### `getErrors(): Array<string>`

Get any parsing or execution errors.

```javascript
const errors = parser.getErrors()
```

## Building Custom WASM Bundle (Advanced)

For production use, you may want to create a custom Pyodide bundle with only the required modules:

```bash
# Install pyodide-build
pip install pyodide-build

# Create custom package
./build-wasm.sh
```

This will create a smaller, faster-loading bundle.

## Performance Considerations

1. **Initial Load**: Pyodide is ~8MB. Consider lazy loading or showing a loading indicator.

2. **Parsing Speed**: Python in WASM is fast but slightly slower than native JavaScript. For real-time applications, consider:

   - Parsing once and caching results
   - Using Web Workers to avoid blocking the main thread
   - Debouncing repeated parse calls

3. **Memory**: The parser maintains state. Call `reset()` periodically to free memory.

## Example: Using in a Web Worker

```javascript
// worker.js
importScripts('https://cdn.jsdelivr.net/pyodide/v0.24.1/full/pyodide.js')

let parser

self.onmessage = async e => {
  if (e.data.type === 'init') {
    // Initialize parser
    const pyodide = await loadPyodide()
    const parserCode = await fetch('./parser.py').then(r => r.text())
    await pyodide.runPythonAsync(parserCode)
    pyodide.runPython('from parser import Parser\nparser = Parser()')
    parser = pyodide
    self.postMessage({ type: 'ready' })
  } else if (e.data.type === 'parse') {
    // Parse in worker
    const result = parser.runPython(`
import json
parser.setup(${JSON.stringify(e.data.source)})
parser.draw()
# ... convert to JSON
json.dumps(state)
    `)
    self.postMessage({ type: 'result', data: JSON.parse(result) })
  }
}
```

```javascript
// main.js
const worker = new Worker('worker.js')

worker.postMessage({ type: 'init' })

worker.onmessage = e => {
  if (e.data.type === 'ready') {
    // Parser ready
    worker.postMessage({ type: 'parse', source: 'tri 0.5 0.5 0.2' })
  } else if (e.data.type === 'result') {
    // Got parse results
    console.log(e.data.data)
  }
}
```

## Troubleshooting

### "Cannot find module 'parser'"

Make sure `parser.py` is in the same directory and accessible via HTTP (not `file://`).

### "Failed to fetch"

You must serve the files over HTTP. Use `python -m http.server` or similar.

### Slow initial load

This is normal. Pyodide is large. Consider:

- Showing a loading indicator
- Using a CDN closer to your users
- Creating a custom build with fewer modules

### Type errors in browser console

These are usually from Pyodide's type conversion. They're typically harmless but can be suppressed with proper error handling.

## Comparison: Python vs TypeScript Parser

| Feature         | Python/WASM     | TypeScript/JS      |
| --------------- | --------------- | ------------------ |
| Initial Load    | ~8MB + parser   | ~50KB + parser     |
| Parse Speed     | Fast (WASM)     | Very Fast (native) |
| Feature Parity  | 100%            | 100%               |
| Maintenance     | Single codebase | Separate impl      |
| Browser Support | Modern browsers | All browsers       |

## License

Same as main Asemic project.
