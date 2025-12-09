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

## State Synchronization: Constants → Tauri

### The Problem

Some constants represent **global application state** that needs to be synchronized between TypeScript and Rust for hybrid parsing. Others are **local parsing state** that only exists during expression evaluation.

### Global vs Local Constants

**Global Constants (Synced to Tauri):**

- `T` - Time (updates every 100ms for animation)
- `S` - Scrub position (manual timeline control)
- `H` - Height-to-width ratio (canvas dimensions)
- `scene` - Current scene index

**Local Constants (Parser-only, NOT synced):**

- `I` - Current loop index (ephemeral, changes per loop iteration)
- `N` - Total loop count (ephemeral, changes per loop)
- `i` - Normalized loop progress 0-1 (derived from I/N)
- `C` - Current curve index (ephemeral, changes per curve)
- `L` - Current letter (ephemeral, changes per letter)
- `P` - Current point (ephemeral, changes per point)

These local constants are stored in the `ExpressionParser` struct (`src-tauri/src/parser/methods/expressions.rs`) as private fields used only during parsing. They don't need to be in the global `ParserState` or synced via Tauri commands.

### How Global Constants are Synced

#### 1. JavaScript Parser Constants

Global constants are defined in `src/lib/parser/Parser.ts`:

```typescript
progress = {
  time: performance.now() / 1000, // T - Global
  scrub: 0, // S - Global
  progress: 0, // Global
  scene: 0, // Global
  // Local parsing state (not synced):
  curve: 0, // C - Local
  indexes: [0, 0, 0], // I - Local
  countNums: [0, 0, 0], // N - Local
  letter: 0, // L - Local
  point: 0 // P - Local
}

// Constants that reference this state:
constants = {
  T: x => this.progress.time * (x ? this.expressions.expr(x) : 1),
  S: () => this.progress.scrub,
  I: solveIndex => this.progress.indexes[solveIndex || 0], // Local only
  N: solveIndex => this.progress.countNums[solveIndex || 0], // Local only
  C: () => this.progress.curve, // Local only
  L: () => this.progress.letter, // Local only
  P: () => this.progress.point // Local only
}
```

#### 2. Synchronization Flow

**Time Constant (`T`):**

```
Browser Performance API → Parser State → Tauri Command → Rust State
   (every 100ms)        (progress.time)  (invoke)    (AppState)
```

Implementation in `src/renderer/app/AsemicApp.tsx`:

```typescript
// Periodic time sync (lines 249-253)
const timeInterval = setInterval(() => {
  const currentTime = performance.now() / 1000
  invoke('update_parser_time', { time: currentTime })
}, 100) // Updates every 100ms
```

**Progress & Scene Constants:**

```
Parser Draw → onmessage callback → Tauri Command → Rust State
  (worker)      (AsemicApp)         (invoke)       (AppState)
```

Implementation in `src/renderer/app/AsemicApp.tsx`:

```typescript
// On-demand progress sync (lines 231-234)
if (!isUndefined(data.progress)) {
  setProgress(data.progress)
  invoke('update_parser_progress', {
    progress: data.progress,
    scene: activeScene
  })
}
```

#### 3. Rust Backend Storage

**Shared State Structure** (`src-tauri/src/parser_state.rs`):

```rust
pub struct ParserState {
    pub time: f64,        // T constant
    pub progress: f64,    // Current playback position
    pub scrub: f64,       // S constant (manual scrubbing)
    pub width: f64,       // Canvas width
    pub height: f64,      // Canvas height (used for H constant)
    pub scene: usize,     // Current scene index
    pub total_length: f64,// Total duration
}

pub struct AppState {
    pub parser_state: Mutex<ParserState>, // Thread-safe access
}
```

**Tauri Commands** (`src-tauri/src/main.rs`):

```rust
#[tauri::command]
async fn update_parser_time(
    time: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut parser_state = state.parser_state.lock().unwrap();
    parser_state.time = time;
    Ok(())
}

#[tauri::command]
async fn update_parser_progress(
    progress: f64,
    scene: usize,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut parser_state = state.parser_state.lock().unwrap();
    parser_state.progress = progress;
    parser_state.scene = scene;
    Ok(())
}

#[tauri::command]
async fn update_parser_dimensions(
    width: f64,
    height: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut parser_state = state.parser_state.lock().unwrap();
    parser_state.width = width;
    parser_state.height = height;
    Ok(())
}
```

#### 4. Helper API

`src/renderer/parserState.ts` provides clean TypeScript wrappers:

```typescript
export async function updateParserTime(time: number): Promise<void>
export async function updateParserProgress(
  progress: number,
  scene: number
): Promise<void>
export async function updateParserDimensions(
  width: number,
  height: number
): Promise<void>
export async function getParserState(): Promise<ParserState>
```

### Key Architectural Decisions

1. **Unidirectional Flow**: State flows JavaScript → Rust only

   - Rust is authoritative consumer, not producer (currently)
   - Simplifies synchronization logic
   - Prevents circular updates

2. **Periodic vs On-Demand Updates**:

   - **Time**: Updated every 100ms (periodic) - needed for animation
   - **Progress/Scene**: Updated when changed (on-demand) - less frequent
   - **Dimensions**: Updated on resize (on-demand) - rare

3. **Thread Safety**:

   - `Mutex<ParserState>` allows safe concurrent access
   - Multiple commands can update different fields
   - Lock is held only during brief update operations

4. **Separation of Concerns**:
   - Parser logic remains in TypeScript (proven, fast)
   - Rust handles native integration and state persistence
   - Clean API boundary via Tauri commands

## Parser Constants Reference

| Constant | Description                 | Type     | Scope  | Synced to Rust          |
| -------- | --------------------------- | -------- | ------ | ----------------------- |
| `T`      | Current time in seconds     | `number` | Global | ✅ Yes (`time`)         |
| `S`      | Scrub position              | `number` | Global | ✅ Yes (`scrub`)        |
| `H`      | Height-to-width ratio       | `number` | Global | ✅ Yes (`height/width`) |
| `I`      | Current loop index          | `number` | Local  | ❌ Parser-only          |
| `N`      | Total loop count            | `number` | Local  | ❌ Parser-only          |
| `i`      | Current loop progress (0-1) | `number` | Local  | ❌ Parser-only          |
| `C`      | Current curve index         | `number` | Local  | ❌ Parser-only          |
| `L`      | Current letter              | `number` | Local  | ❌ Parser-only          |
| `P`      | Current point               | `number` | Local  | ❌ Parser-only          |

**Scope Legend:**

- **Global**: Application-level state, synced between TypeScript and Rust
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
│   ├── main.rs              # Tauri commands
│   ├── parser_state.rs      # Shared state definition
│   └── parser/              # Future: Rust parser implementation
│       └── mod.rs
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

3. **Sync to Rust** (if needed):

   - Add field to `ParserState` struct
   - Create or extend Tauri command
   - Call command when value changes
   - Update helper in `parserState.ts`

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

### Testing State Sync

1. Check parser state in worker: `console.log(parser.progress)`
2. Check Rust state: Add debug logging to Tauri commands
3. Verify timing: Ensure updates don't occur more frequently than needed
4. Test threading: Ensure no race conditions with concurrent updates

## Future Considerations

### Hybrid Parser Architecture

The current setup prepares for a future where:

- Rust handles performance-critical parsing (syntax tree traversal)
- TypeScript handles dynamic expression evaluation
- State is bidirectional: Rust → TypeScript for parser output

### State Persistence

The Rust state infrastructure enables:

- Saving/loading parser state across sessions
- Recording playback positions
- Undo/redo functionality
- Project state management

### Performance Optimization

Current bottlenecks to address:

- 100ms time sync interval (consider requestAnimationFrame alignment)
- Mutex lock contention if many concurrent updates
- Serialization overhead in Tauri IPC

## Common Patterns

### Adding a Tauri Command

```rust
#[tauri::command]
async fn command_name(
    param: Type,
    state: State<'_, AppState>,
) -> Result<ReturnType, String> {
    let mut parser_state = state.parser_state.lock().unwrap();
    // Update state
    Ok(result)
}
```

### Calling from TypeScript

```typescript
import { invoke } from '@tauri-apps/api/core'

await invoke('command_name', { param: value })
```

### Safe State Updates

```typescript
// Always check for undefined before syncing
if (!isUndefined(data.newValue)) {
  setLocalState(data.newValue)
  invoke('update_state', { newValue: data.newValue }).catch(console.error) // Handle failures gracefully
}
```

## Resources

- Parser constants: `src/lib/parser/Parser.ts` (lines 129-180)
- State sync implementation: `src/renderer/app/AsemicApp.tsx` (lines 206-253)
- Rust state definition: `src-tauri/src/parser_state.rs`
- Tauri commands: `src-tauri/src/main.rs` (lines 220-281)
- Helper API: `src/renderer/parserState.ts`
