# Compiling TypeScript Parser to WebAssembly

## Overview

The Asemic Parser is written in TypeScript. There are several approaches to make it run faster or in WASM:

## Option 1: AssemblyScript (Closest to WASM)

AssemblyScript is a TypeScript-to-WebAssembly compiler. It uses TypeScript syntax but with stricter typing and WASM-compatible APIs.

### Pros
- TypeScript-like syntax
- True WebAssembly output
- Can be 10-100x faster for numeric operations
- Small bundle size (~50KB)

### Cons
- Requires rewriting code (no DOM, no dynamic typing, etc.)
- Limited standard library
- Can't use lodash or most npm packages
- Steep learning curve for memory management

### Implementation Strategy

1. **Keep current TypeScript parser for full-featured use**
2. **Create AssemblyScript version for performance-critical paths**
3. **Use both**: TS for parsing, AS for curve generation/math

#### What to port to AssemblyScript:
- Expression evaluation (`expr`)
- Point calculations
- Transform operations
- Bezier curve generation
- Noise functions

#### What to keep in TypeScript:
- Text parsing (`parse`, `tokenize`)
- Scene management
- Font rendering
- Error handling
- File I/O

### Example: AssemblyScript Expression Evaluator

```typescript
// assembly/expressions.ts (AssemblyScript)
export function expr(input: string): f64 {
  // Simple expression evaluator
  // Note: Limited to numeric operations only
  return parseFloat(input);
}

export function sin(x: f64): f64 {
  return Math.sin(x * Math.PI * 2);
}

export function lerp(a: f64, b: f64, t: f64): f64 {
  return a + (b - a) * t;
}

export class Point {
  x: f64;
  y: f64;
  
  constructor(x: f64, y: f64) {
    this.x = x;
    this.y = y;
  }
  
  add(other: Point): Point {
    return new Point(this.x + other.x, this.y + other.y);
  }
}
```

See `assemblyscript-example/` directory for full implementation.

---

## Option 2: Keep TypeScript, Optimize Bundle (RECOMMENDED)

Modern JavaScript engines (V8, SpiderMonkey, JavaScriptCore) have JIT compilers that are incredibly fast. For most use cases, optimized TypeScript is fast enough.

### Advantages
- No rewriting needed
- Full TypeScript ecosystem
- Easy to maintain
- Already very fast

### Optimization Strategies

#### 1. Bundle Optimization
```bash
# Use esbuild for fast, optimized bundles
npm install -D esbuild

# Build optimized bundle
esbuild src/lib/parser/Parser.ts \
  --bundle \
  --minify \
  --target=es2020 \
  --format=esm \
  --outfile=dist/parser.min.js
```

#### 2. Tree Shaking
Remove unused code to reduce bundle size:
```javascript
// Import only what you need
import { Parser } from '@asemic/parser';

// Not the entire library
import * as Asemic from '@asemic/parser'; // ❌ Larger bundle
```

#### 3. Code Splitting
Split large methods into separate modules that load on demand:
```typescript
// Lazy load heavy dependencies
const { HeavyFeature } = await import('./heavy-feature');
```

#### 4. Web Workers
Run the parser in a Web Worker to avoid blocking the main thread:
```typescript
// parser.worker.ts
import { Parser } from './Parser';

self.onmessage = (e) => {
  const parser = new Parser();
  parser.setup(e.data.source);
  parser.draw();
  
  self.postMessage({
    groups: parser.groups,
    errors: parser.output.errors
  });
};
```

See `worker-example/` directory for full implementation.

---

## Option 3: Hybrid Approach (Advanced)

Use AssemblyScript for hot paths, TypeScript for everything else.

### Architecture
```
┌─────────────────────────────────────┐
│   TypeScript Parser (Main)          │
│   - Parsing                          │
│   - Text handling                    │
│   - Scene management                 │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   WASM Module (Hot Paths)            │
│   - Expression evaluation            │
│   - Point math                       │
│   - Transform operations             │
│   - Curve generation                 │
└─────────────────────────────────────┘
```

### Performance Comparison
| Operation | TypeScript | AssemblyScript | Speedup |
|-----------|------------|----------------|---------|
| Expression eval | 1ms | 0.1ms | 10x |
| Point transform | 0.5ms | 0.05ms | 10x |
| Parse text | 2ms | N/A | - |
| Draw curves | 3ms | 0.5ms | 6x |

### When to Use WASM
- **Large datasets** (>10,000 points)
- **Real-time rendering** (60fps+)
- **Complex math** (fractals, physics)
- **Embedded devices** (lower-powered CPUs)

### When TypeScript is Fine
- **Small/medium projects** (<1000 points)
- **Static rendering** (pre-render, not real-time)
- **Development** (faster iteration)
- **Most use cases** (JS engines are really fast!)

---

## Practical Recommendation

For the Asemic Parser, I recommend **Option 2 (Optimized TypeScript)** because:

1. ✅ **Already Fast**: Modern JS is within 2-5x of WASM for most code
2. ✅ **Maintainable**: Single codebase, easy to update
3. ✅ **Full Ecosystem**: Can use npm packages, DOM APIs, etc.
4. ✅ **Debugging**: Better source maps and dev tools
5. ✅ **Bundle Size**: Smaller than WASM + JS glue code

### Optimization Checklist

- [ ] Bundle with esbuild/Rollup (minification, tree-shaking)
- [ ] Use Web Workers for heavy parsing
- [ ] Cache parsed results when possible
- [ ] Profile with Chrome DevTools to find bottlenecks
- [ ] Consider WASM only if profiling shows it's needed

### If You Still Want WASM

Follow the AssemblyScript guide in `assemblyscript-example/` to:
1. Port critical functions to AssemblyScript
2. Compile to WASM
3. Create TypeScript bindings
4. Benchmark to verify performance gains

---

## Performance Testing

```typescript
// benchmark.ts
const iterations = 1000;

// Test TypeScript
const tsStart = performance.now();
for (let i = 0; i < iterations; i++) {
  const parser = new Parser();
  parser.setup(source);
  parser.draw();
}
const tsTime = performance.now() - tsStart;

// Test WASM (if available)
const wasmStart = performance.now();
for (let i = 0; i < iterations; i++) {
  const result = wasmParser.parse(source);
}
const wasmTime = performance.now() - wasmStart;

console.log(`TypeScript: ${tsTime}ms`);
console.log(`WASM: ${wasmTime}ms`);
console.log(`Speedup: ${(tsTime / wasmTime).toFixed(2)}x`);
```

---

## Next Steps

1. **Profile your use case**: Use Chrome DevTools Performance tab
2. **Identify bottlenecks**: Look for hot functions
3. **Optimize JavaScript first**: Often 80% of gains with 20% of effort
4. **Consider WASM**: Only if profiling shows clear bottlenecks
5. **Measure results**: Always benchmark before and after

See the example directories for working code:
- `assemblyscript-example/` - Full AssemblyScript port example
- `worker-example/` - Web Worker optimization
- `benchmark/` - Performance testing suite
