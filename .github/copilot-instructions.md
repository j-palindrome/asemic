# Asemic Library Architecture Overview

## Project Description

Asemic is a creative coding library for generative asemic writing and visual synthesis. It combines a custom parser for drawing expressions with real-time rendering using WebGPU, packaged as a Tauri desktop application.

## Core Architecture

### Three-Layer System

1. **TypeScript Parser & Renderer** (`src/lib/`)

   - Main parser implementation
   - WebGPU/Canvas renderers
   - Web Worker for off-main-thread rendering
   - Expression evaluation and scene management

2. **React UI** (`src/renderer/`)

   - Monaco-based code editor
   - Scene parameter controls
   - Real-time preview canvas
   - Settings and playback controls

3. **Rust/Tauri Backend** (`src-tauri/`)
   - Desktop application wrapper
   - Shared parser state management
   - File system operations
   - Future: Performance-critical parsing operations

## State Synchronization: No Global State in Rust

### Architecture Decision

**The Rust backend has NO global state.** All parser state is ephemeral and passed directly to the expression parser when needed. This simplifies the architecture and prevents synchronization complexity.

### Parser Constants

**Computed Constants (Not stored, calculated on-demand):**

- `T` - Current time in seconds (uses `performance.now()` or `SystemTime::now()` directly)

**Local Constants (Parser-only, ephemeral per evaluation):**

- `S` - Scrub position (passed in scene metadata)
- `H` - Height-to-width ratio (passed as dimensions)
- `scene` - Current scene index (passed as parameter)
- `I` - Current loop index (ephemeral during parsing)
- `N` - Total loop count (ephemeral during parsing)
- `i` - Normalized loop progress 0-1 (derived from I/N)
- `C` - Current curve index (ephemeral during parsing)
- `L` - Current letter (ephemeral during parsing)
- `P` - Current point (ephemeral during parsing)

### How Expression Evaluation Works

#### 1. JavaScript Parser (Main Implementation)

The TypeScript parser in `src/lib/parser/Parser.ts` is the primary parser and handles all drawing operations:

```typescript
progress = {
  scrub: 0,
  progress: 0,
  scene: 0,
  curve: 0,
  indexes: [0, 0, 0],
  countNums: [0, 0, 0],
  letter: 0,
  point: 0
}

constants = {
  T: x => (performance.now() / 1000) * (x ? this.expressions.expr(x) : 1),
  S: () => this.progress.scrub
  // ... other constants
}
```

#### 2. Rust Expression Parser (OSC Only)

The Rust expression parser in `src-tauri/src/parser/methods/expressions.rs` is used ONLY for evaluating OSC expressions. It receives full scene context on each call:

```rust
pub async fn parser_eval_expression(
    expr: String,
    osc_address: String,
    osc_host: String,
    osc_port: u16,
    width: f64,              // Canvas dimensions
    height: f64,
    current_scene: usize,    // Active scene index
    scene_metadata: Vec<SceneMetadata>, // All scene data
) -> Result<f64, String>
```

**No State Synchronization:**

- No periodic updates
- No global state to keep in sync
- All context passed directly with each evaluation
- Stateless and thread-safe

#### 3. TypeScript → Rust Flow (OSC Expressions Only)

```
AsemicApp.tsx → invoke('parser_eval_expression') → Rust ExpressionParser → OSC Send
    ↓
  Passes full context:
  - Canvas dimensions
  - Current scene index
  - All scene metadata
  - Expression to evaluate
```

Implementation in `src/renderer/app/AsemicApp.tsx`:

```typescript
// Build scene metadata array
const sceneMetadata = scenesArray.map((scene, idx) => ({
  start: 0,
  length: scene.length || 0.1,
  offset: scene.offset || 0,
  params: scene.params
    ? Object.entries(scene.params).reduce((acc, [key, config]) => {
        acc[key] = config.value ?? config.default ?? 0
        return acc
      }, {} as Record<string, number>)
    : {}
}))

// Evaluate and send OSC
await invoke<number>('parser_eval_expression', {
  expr: oscMsg.value,
  oscAddress: oscMsg.name,
  oscHost: oscHost,
  oscPort: oscPort,
  width,
  height,
  currentScene: activeScene,
  sceneMetadata
})
```

### Key Architectural Decisions

1. **Stateless Rust Parser**: No global state in Rust

   - All context passed with each expression evaluation
   - Simplifies architecture and prevents sync bugs
   - Thread-safe by design (no shared mutable state)

2. **Direct Parameter Passing**:

   - Canvas dimensions passed directly when needed
   - Scene metadata passed as complete array
   - Current scene index passed explicitly

3. **Separation of Concerns**:
   - TypeScript parser handles all drawing operations
   - Rust parser handles ONLY OSC expression evaluation
   - Clean API boundary via Tauri commands

## Parser Constants Reference

| Constant | Description                 | Type     | Scope     | Passed to Rust          |
| -------- | --------------------------- | -------- | --------- | ----------------------- |
| `T`      | Current time in seconds     | `number` | Computed  | ❌ Computed on-demand   |
| `S`      | Scrub position              | `number` | Local     | ✅ Yes (scene metadata) |
| `H`      | Height-to-width ratio       | `number` | Parameter | ✅ Yes (dimensions)     |
| `scene`  | Current scene index         | `number` | Parameter | ✅ Yes (currentScene)   |
| `I`      | Current loop index          | `number` | Local     | ❌ Parser-only          |
| `N`      | Total loop count            | `number` | Local     | ❌ Parser-only          |
| `i`      | Current loop progress (0-1) | `number` | Local     | ❌ Parser-only          |
| `C`      | Current curve index         | `number` | Local     | ❌ Parser-only          |
| `L`      | Current letter              | `number` | Local     | ❌ Parser-only          |
| `P`      | Current point               | `number` | Local     | ❌ Parser-only          |

**Scope Legend:**

- **Computed**: Calculated on-demand using current system time
- **Parameter**: Passed as function parameter when needed
- **Local**: Ephemeral parsing state, exists only during expression evaluation

## Web Worker Architecture

The parser runs in a dedicated Web Worker (`src/lib/asemic.worker.ts`):

```
Main Thread                    Worker Thread
-----------                    -------------
AsemicApp.tsx                  asemic.worker.ts
    ↓                                ↓
Asemic.ts ←→ postMessage ←→    Parser.ts
    ↑                                ↓
    └──── onmessage ←───────   WebGPURenderer
```

**Benefits**:

- Non-blocking UI during complex parsing
- Offscreen canvas rendering
- Parallel execution of drawing operations

**Message Flow**:

1. Main thread sends: source code, playback commands, settings
2. Worker responds: parsed data, errors, progress updates, rendered frames

## File Organization

```
src/
├── lib/                      # Core library (worker-compatible)
│   ├── Asemic.ts            # Main API, worker manager
│   ├── asemic.worker.ts     # Web Worker entry point
│   ├── parser/              # Expression parser
│   │   ├── Parser.ts        # Main parser class
│   │   └── core/            # AST nodes, transforms
│   ├── renderers/           # Visual/audio output
│   │   └── visual/
│   │       └── WebGPURenderer.ts
│   └── blocks/              # Drawing primitives
│
├── renderer/                 # React UI (main thread only)
│   ├── app/
│   │   ├── AsemicApp.tsx    # Main application
│   │   └── useAsemic.ts     # React hooks
│   ├── components/
│   │   └── Editor.tsx       # Monaco editor integration
│   └── parserState.ts       # Tauri state helpers
│
src-tauri/
├── src/
│   ├── main.rs              # Tauri commands (parser_eval_expression only)
│   ├── parser_state.rs      # Re-exports SceneMetadata
│   └── parser/              # Expression parser for OSC
│       ├── mod.rs           # Future: Full Rust parser
│       └── methods/
│           └── expressions.rs  # Stateless expression evaluator
```

## Development Guidelines

### When Adding New Constants

1. **Define in Parser.ts**:

   ```typescript
   constants = {
     NEWCONST: arg => this.progress.someValue
   }
   ```

2. **Add to Progress Type** (if storing state):

   ```typescript
   progress = {
     someValue: initialValue
     // ...
   }
   ```

3. **For OSC Expressions** (if needed in Rust):

   - Add constant to `ExpressionParser` in `expressions.rs`
   - Pass context via function parameters (no global state)
   - Update `parser_eval_expression` signature if needed

4. **Document in Editor.tsx**:
   ```typescript
   constants = [
     {
       name: 'NEWCONST',
       args: ['param=default'],
       group: 'description'
     }
   ]
   ```

### Using the Expression Parser

The Rust expression parser receives all context directly:

```typescript
await invoke<number>('parser_eval_expression', {
  expr: 'speed * 2',
  oscAddress: '/synth/freq',
  oscHost: '127.0.0.1',
  oscPort: 57120,
  width: 1920,
  height: 1080,
  currentScene: 0,
  sceneMetadata: [
    {
      start: 0,
      length: 10,
      offset: 0,
      params: { speed: 2.5, size: 0.75 }
    }
  ]
})
```

## Future Considerations

### Hybrid Parser Architecture

The current setup prepares for a future where:

- Rust handles performance-critical parsing (syntax tree traversal)
- TypeScript handles dynamic expression evaluation
- Communication is stateless: all context passed per-call

### Performance Optimization

Current bottlenecks to address:

- Serialization overhead in Tauri IPC (passing scene metadata on each call)
- Consider caching scene metadata in Rust if OSC updates are frequent
- Expression parser cache for repeated expressions

## Common Patterns

### Calling OSC Expression Parser

```typescript
import { evalExpression } from '@/renderer/parserState'

const result = await evalExpression('T * speed', {
  oscAddress: '/osc/address',
  oscHost: '127.0.0.1',
  oscPort: 57120,
  width: canvasWidth,
  height: canvasHeight,
  currentScene: activeSceneIndex,
  sceneMetadata: scenesMetadataArray
})
```

### Calling from TypeScript

```typescript
import { invoke } from '@tauri-apps/api/core'

await invoke('parser_eval_expression', {
  expr: 'expression',
  oscAddress: '/address',
  oscHost: 'host',
  oscPort: port,
  width,
  height,
  currentScene,
  sceneMetadata
})
```

## Resources

- Parser constants: `src/lib/parser/Parser.ts`
- Expression parser: `src-tauri/src/parser/methods/expressions.rs`
- OSC integration: `src/renderer/app/AsemicApp.tsx` (OSC loop)
- Tauri commands: `src-tauri/src/main.rs`
- Helper API: `src/renderer/parserState.ts`
