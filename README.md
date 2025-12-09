# Asemic

A TypeScript library for generative asemic writing and visual programming.

## Installation

```bash
npm install asemic
# or
pnpm add asemic
# or
yarn add asemic
```

## Development

### Web Development

Run the web-based development server:

```bash
# Start the development server
pnpm run dev

# Build the library
pnpm run build
```

### Tauri Desktop App

This project can be built as a Tauri desktop application with native file system access:

```bash
# Development (runs Tauri with hot reload)
pnpm tauri dev

# Build the Tauri app
pnpm tauri build
```

The Tauri app provides:

- Native file dialog for opening/saving .asemic files
- Better performance for complex visualizations
- Desktop app experience
- Cross-platform support (macOS, Windows, Linux, iOS)

## Usage

### Basic Parser Usage

```typescript
import { Parser } from 'asemic/parser'

const parser = new Parser()
parser.parse('[0,0 1,1]') // Creates a simple line
console.log(parser.curves) // Array of curve data
```

### Using the Asemic Class

```typescript
import Asemic from 'asemic/asemic'

const canvas = document.createElement('canvas')
const asemic = new Asemic(canvas, data => {
  console.log('Received data:', data)
})

asemic.postMessage({
  source: '[0,0 1,1] [0,1 1,0]'
})
```

### React Component

```typescript
import AsemicApp from 'asemic/asemic-app'

function MyApp() {
  const source = `
    width 1.0
    height 1.0
    [0,0 1,1]
  `

  return <AsemicApp source={source} />
}
```

### Renderers

```typescript
// Canvas Renderer
import CanvasRenderer from 'asemic/canvas-renderer'

const ctx = canvas.getContext('2d')
const renderer = new CanvasRenderer(ctx)

// WebGPU Renderer
import WebGPURenderer from 'asemic/webgpu-renderer'

const device = await navigator.gpu.requestAdapter()
const context = canvas.getContext('webgpu')
const renderer = new WebGPURenderer(context)

## API Reference

### Parser

The core parsing engine for the asemic language.

### Asemic

Main class that coordinates parsing and rendering with Web Workers.

### AsemicApp

React component for full-featured asemic applications.

### Renderers

- `CanvasRenderer`: 2D Canvas rendering
- `WebGPURenderer`: High-performance WebGPU rendering
- `ThreeRenderer`: Three.js-based 3D rendering

## License

ISC
```
