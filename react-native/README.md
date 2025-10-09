# Asemic for React Native

Complete React Native implementation of the Asemic generative writing system.

## 🎯 What Changed from Web Version

### Removed/Replaced

❌ **WebAssembly** - Not supported in React Native  
❌ **HTML Canvas** - Replaced with react-native-canvas or react-native-svg  
❌ **Electron** - N/A for mobile  
❌ **WebGPU** - Not available  
❌ **File system access** - Uses React Native's filesystem  
❌ **Image loading** - Uses React Native Image API

### React Native Adaptations

✅ **Parser** - Pure TypeScript (no WASM), works as-is  
✅ **Canvas Rendering** - Uses `react-native-canvas` or `react-native-svg`  
✅ **Animation** - Uses `react-native-reanimated`  
✅ **File I/O** - Uses `react-native-fs`  
✅ **Performance** - Uses `react-native-reanimated` for 60fps

## 📦 Installation

### 1. Install React Native Dependencies

```bash
npm install react-native-canvas react-native-svg react-native-reanimated react-native-fs

# Or with yarn
yarn add react-native-canvas react-native-svg react-native-reanimated react-native-fs

# Link native modules (if not using auto-linking)
cd ios && pod install && cd ..
```

### 2. Configure Reanimated

Add to `babel.config.js`:

```javascript
module.exports = {
  presets: ['module:metro-react-native-babel-preset'],
  plugins: [
    'react-native-reanimated/plugin' // Must be last
  ]
}
```

### 3. Copy Asemic Files

```bash
# Copy the React Native adapter
cp -r react-native/asemic src/

# The core parser files work as-is
# (Parser.ts, types.ts, utils.ts, etc.)
```

## 🚀 Quick Start

### Basic Usage

```tsx
import React from 'react'
import { View, StyleSheet } from 'react-native'
import { AsemicCanvas } from './asemic/AsemicCanvas'

export default function App() {
  const source = `
    # scene1
    tri 0.5 0.5 0.2
    circle 0.3 0.7 0.1 0.1
    
    # scene2 {length=2}
    repeat(100, () => {
      squ(I*0.01, 0.5, 0.02, 0.02)
    })
  `

  return (
    <View style={styles.container}>
      <AsemicCanvas source={source} width={400} height={600} animate={true} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  }
})
```

### With Animation

```tsx
import { AsemicAnimated } from './asemic/AsemicAnimated'

function AnimatedAsemic() {
  return (
    <AsemicAnimated
      source={`
        # scene1 {length=3}
        circle(0.5, 0.5, sin(S)*0.3, sin(S)*0.3)
      `}
      width={400}
      height={600}
      loop={true}
    />
  )
}
```

### With Parameters

```tsx
import { AsemicWithParams } from './asemic/AsemicWithParams'

function InteractiveAsemic() {
  const [params, setParams] = React.useState({
    size: 0.2,
    speed: 1.0
  })

  return (
    <AsemicWithParams
      source={`
        param("size", 0.2, 0, 1)
        param("speed", 1.0, 0, 2)
        
        tri(0.5, 0.5, size, size)
      `}
      width={400}
      height={600}
      params={params}
      onParamsChange={setParams}
    />
  )
}
```

## 📱 Components

### AsemicCanvas

Basic static rendering component.

```tsx
<AsemicCanvas
  source={string} // Asemic source code
  width={number} // Canvas width
  height={number} // Canvas height
  backgroundColor={string} // Default: 'white'
  strokeColor={string} // Default: 'black'
  strokeWidth={number} // Default: 2
/>
```

### AsemicAnimated

Animated rendering with timeline control.

```tsx
<AsemicAnimated
  source={string}
  width={number}
  height={number}
  loop={boolean}         // Default: true
  fps={number}           // Default: 60
  onFrame={(progress) => void} // Frame callback
/>
```

### AsemicSVG

SVG-based rendering (better performance for simple shapes).

```tsx
<AsemicSVG
  source={string}
  width={number}
  height={number}
  viewBox={string} // Default: "0 0 1 1"
/>
```

## 🎨 Rendering Options

### Option 1: Canvas (react-native-canvas)

Best for: Complex curves, many points, raster effects

**Pros:**

- Handles complex bezier curves well
- Good for thousands of points
- Familiar Canvas API

**Cons:**

- Slower than SVG for simple shapes
- Larger memory footprint

### Option 2: SVG (react-native-svg)

Best for: Simple shapes, geometric primitives, crisp lines

**Pros:**

- Better performance for simple shapes
- Scalable, resolution-independent
- Smaller memory footprint

**Cons:**

- Can be slow with many curves
- Limited effects

### Option 3: Skia (react-native-skia)

Best for: Maximum performance, complex effects

**Pros:**

- Native performance
- Advanced effects (gradients, shadows, blur)
- Hardware-accelerated

**Cons:**

- Larger dependency
- More complex API

## 🔧 API Reference

### Parser (Same as Web)

```typescript
import { Parser } from '../lib/parser/Parser'

const parser = new Parser()
parser.setup(source)
parser.draw()

console.log(parser.groups) // Generated curves
console.log(parser.params) // Parameters
console.log(parser.duration) // Total length
```

### Renderer

```typescript
import { AsemicRenderer } from './asemic/AsemicRenderer.native'

const renderer = new AsemicRenderer({
  width: 400,
  height: 600,
  backgroundColor: 'white',
  strokeColor: 'black'
})

// Render to canvas
await renderer.render(parser.groups, canvasRef.current)

// Render to SVG
const svg = renderer.renderToSVG(parser.groups)
```

## 📐 Layout & Sizing

### Responsive Sizing

```tsx
import { useWindowDimensions } from 'react-native'

function ResponsiveAsemic() {
  const { width, height } = useWindowDimensions()

  return (
    <AsemicCanvas
      source='tri 0.5 0.5 0.2'
      width={width}
      height={height * 0.6}
    />
  )
}
```

### Fixed Aspect Ratio

```tsx
function FixedRatioAsemic() {
  return (
    <View style={{ aspectRatio: 3 / 4 }}>
      <AsemicCanvas source='circle 0.5 0.5 0.3 0.3' width={300} height={400} />
    </View>
  )
}
```

## ⚡ Performance Tips

### 1. Use SVG for Simple Shapes

```tsx
// ✅ Good - SVG is faster for simple shapes
<AsemicSVG source="squ 0.5 0.5 0.2" />

// ❌ Slower - Canvas has overhead
<AsemicCanvas source="squ 0.5 0.5 0.2" />
```

### 2. Limit Curve Complexity

```tsx
// ✅ Good - 8 segments
<AsemicCanvas source="circle(0.5, 0.5, 0.3, 0.3, 8)" />

// ❌ Slower - 64 segments (unnecessary detail)
<AsemicCanvas source="circle(0.5, 0.5, 0.3, 0.3, 64)" />
```

### 3. Use React.memo

```tsx
const MemoizedAsemic = React.memo(AsemicCanvas, (prev, next) => {
  return prev.source === next.source
})
```

### 4. Debounce Updates

```tsx
import { useDebouncedValue } from './hooks/useDebouncedValue'

function EditableAsemic() {
  const [source, setSource] = useState('tri 0.5 0.5 0.2')
  const debouncedSource = useDebouncedValue(source, 300)

  return (
    <>
      <TextInput value={source} onChangeText={setSource} />
      <AsemicCanvas source={debouncedSource} />
    </>
  )
}
```

## 🎬 Animation

### Frame-by-Frame

```tsx
import Animated, {
  useAnimatedProps,
  useSharedValue
} from 'react-native-reanimated'

function AnimatedAsemic() {
  const progress = useSharedValue(0)

  useEffect(() => {
    const interval = setInterval(() => {
      progress.value = (progress.value + 1 / 60) % duration
    }, 1000 / 60)

    return () => clearInterval(interval)
  }, [])

  return <AsemicAnimated progress={progress} />
}
```

### Gesture-Controlled

```tsx
import { GestureDetector, Gesture } from 'react-native-gesture-handler'

function GestureControlled() {
  const progress = useSharedValue(0)

  const pan = Gesture.Pan().onChange(e => {
    progress.value = e.translationX / width
  })

  return (
    <GestureDetector gesture={pan}>
      <AsemicAnimated progress={progress} />
    </GestureDetector>
  )
}
```

## 📁 File Operations

### Save to File

```tsx
import RNFS from 'react-native-fs'

async function saveAsemic() {
  const svg = renderer.renderToSVG(parser.groups)
  const path = `${RNFS.DocumentDirectoryPath}/asemic.svg`

  await RNFS.writeFile(path, svg, 'utf8')
  console.log('Saved to:', path)
}
```

### Load from File

```tsx
async function loadAsemic() {
  const path = `${RNFS.DocumentDirectoryPath}/asemic.txt`
  const source = await RNFS.readFile(path, 'utf8')

  parser.setup(source)
  parser.draw()
}
```

### Share

```tsx
import Share from 'react-native-share'

async function shareAsemic() {
  const svg = renderer.renderToSVG(parser.groups)

  await Share.open({
    message: 'Check out my Asemic art!',
    url: `data:image/svg+xml;base64,${btoa(svg)}`
  })
}
```

## 🐛 Troubleshooting

### Canvas not rendering

```bash
# Make sure native modules are linked
cd ios && pod install && cd ..
npx react-native run-ios
```

### Performance issues

- Use SVG instead of Canvas for simple shapes
- Reduce curve segment count
- Enable `react-native-reanimated` worklets
- Use `React.memo` and `useMemo`

### Memory leaks

```tsx
// Clean up parsers and renderers
useEffect(() => {
  const parser = new Parser()

  return () => {
    // Cleanup if needed
    parser.reset()
  }
}, [])
```

## 📚 Examples

See `react-native/examples/` for:

- `BasicExample.tsx` - Simple static rendering
- `AnimatedExample.tsx` - Timeline animation
- `InteractiveExample.tsx` - Touch-controlled parameters
- `GalleryExample.tsx` - Scrollable gallery
- `EditorExample.tsx` - Live code editor

## 🔗 Resources

- [React Native Canvas](https://github.com/iddan/react-native-canvas)
- [React Native SVG](https://github.com/react-native-svg/react-native-svg)
- [React Native Reanimated](https://docs.swmansion.com/react-native-reanimated/)
- [React Native Skia](https://shopify.github.io/react-native-skia/)

## 📄 License

Same as main Asemic project.
