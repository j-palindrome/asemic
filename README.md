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

### Electron App

This project can be run as an Electron desktop application with full file system access:

```bash
# Development (runs Electron with hot reload)
pnpm run electron:dev

# Build the library
pnpm run build

# Build the Electron app
pnpm run build:electron

# Package the app for distribution
pnpm run dist
```

### Web Server

To run the web server for browser development:

```bash
# Start the development server
pnpm run dev:server
```

The Electron app provides:

- Native file dialog for opening/saving .asemic files
- Better performance for complex visualizations
- Desktop app experience
- Cross-platform support (macOS, Windows, Linux)

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
