# TouchDesigner Integration Guide

This guide explains how to integrate the Python AsemicParser with TouchDesigner to create a working .tox extension.

## File Structure

```
tox/
├── AsemicParser.py          # Core parser implementation
├── AsemicExtension.py       # TouchDesigner extension wrapper
├── example_usage.py         # Usage examples
├── component_setup.md       # TD component setup guide
└── README.md               # Overview documentation
```

## Key Differences from TypeScript Version

### 1. Language Translation

- **TypeScript → Python**: Core logic translated to Python
- **Web Worker → Extension**: TouchDesigner extension system instead of web workers
- **WebGPU → SOP Geometry**: Visual output through TouchDesigner's geometry system
- **Canvas → Geometry COMP**: Rendering through TD's 3D pipeline

### 2. Data Flow Changes

```
Original Web Worker:
Browser → Worker → Canvas/Audio

TouchDesigner Extension:
TD Parameters → Python → SOP/CHOP/TOP
```

### 3. Animation Loop

```python
# Instead of requestAnimationFrame:
def startAnimation(self):
    self.animationTimer = run("args[0].animate()",
                             self,
                             delayFrames=1,
                             delayRef=op('timer1'))
```

### 4. Geometry Output

```python
# Convert parser groups to TouchDesigner geometry:
def updateGeometry(self):
    geo = self.geometryComp.op('geo1')
    geo.clear()

    for group in self.parser.groups:
        points = group.flat()
        for point in points:
            geo.appendPoint()
            geo.points[-1].P = [point[0], point[1], 0]
```

## Implementation Status

### ✅ Completed

- [x] Core parser structure
- [x] Basic expression evaluation
- [x] Constants and functions framework
- [x] TouchDesigner extension wrapper
- [x] Parameter system integration
- [x] Basic geometry output

### 🚧 Partially Implemented

- [ ] Full expression parser (currently uses eval())
- [ ] Complete drawing commands (tri, squ, pen, etc.)
- [ ] Scene management system
- [ ] Transform stack operations
- [ ] Font/text rendering

### ❌ Not Yet Implemented

- [ ] Audio/OSC output to CHOPs
- [ ] Image/table data loading
- [ ] Advanced noise functions
- [ ] File I/O operations
- [ ] Preset management
- [ ] Full Asemic language parsing

## Next Steps for Complete Implementation

### 1. Expression Parser

Replace the simple `eval()` with a proper expression parser:

```python
def expr(self, expression):
    # TODO: Implement proper tokenization
    # TODO: Handle operator precedence
    # TODO: Function call parsing
    # TODO: Variable substitution
```

### 2. Drawing Commands

Implement the core drawing primitives:

```python
def tri(self, args): # Triangle
def squ(self, args): # Square
def pen(self, args): # Set pen position
def circle(self, args): # Circle
def line(self, args): # Line
```

### 3. Scene System

Complete the scene management:

```python
def scene(self, length, callback):
    # Create scene with timing
    # Add to scene list
    # Handle scene switching
```

### 4. Audio Output

Connect to TouchDesigner CHOPs:

```python
def updateAudio(self):
    if self.audioOut:
        # Convert parser.output.osc to CHOP channels
        # Send OSC messages
        # Update audio parameters
```

### 5. Advanced Features

- Table data integration with TD
- Image processing with TOPs
- MIDI/OSC input handling
- Real-time parameter mapping

## Testing the Implementation

### 1. Basic Test

```python
# Create simple test source
source = """
scene 2 {
    pen 0.5, 0.5
    circle 0.1
}
"""

parser = AsemicParser()
parser.setup(source)
parser.draw()
print(f"Generated {len(parser.groups)} groups")
```

### 2. TouchDesigner Test

1. Load the .tox in TouchDesigner
2. Put test code in sourceDAT
3. Toggle play parameter
4. Check geometryComp for output
5. Monitor Python console for errors

### 3. Performance Test

```python
# Test with complex source
source = """
scene 10 {
    repeat 100 {
        pen sin(I*0.1), cos(I*0.1)
        circle 0.01
    }
}
"""
```

## Common Issues and Solutions

### Extension Not Loading

- Check Python file paths
- Verify class name matches
- Check for syntax errors in Python console

### No Visual Output

- Verify geometryComp setup
- Check that parser.groups contains data
- Enable auto-layout in geometry viewer

### Parameter Changes Not Working

- Check callback setup in component
- Verify parameter names match extension code
- Test with simple parameter first

### Performance Issues

- Reduce complexity of Asemic source
- Optimize expression evaluation
- Limit animation frame rate

## Future Enhancements

### 1. Live Coding

- Syntax highlighting in Text DAT
- Error display with line numbers
- Auto-completion for Asemic functions

### 2. Visual Debugging

- Real-time curve visualization
- Transform stack display
- Parameter value monitoring

### 3. Export Features

- .tox template generation
- Standalone executable export
- Video/image sequence export

### 4. Community Features

- Preset sharing system
- Online Asemic library
- Documentation integration

## Resources

- [TouchDesigner Documentation](https://docs.derivative.ca/)
- [Python in TouchDesigner](https://docs.derivative.ca/Python)
- [Asemic Language Reference](../README.md)
- [Original TypeScript Implementation](../src/parser/Parser.ts)
