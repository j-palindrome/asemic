# Asemic Parser - Python Translation

This directory contains a Python translation of the TypeScript Asemic Parser from the main project.

## Overview

The Asemic Parser is the core component that:

- Parses Asemic graphics language source code
- Manages animation state and progress
- Evaluates expressions and mathematical constants
- Generates curves and shapes for rendering
- Controls scene timing and playback

## Structure

```
python/parser/
├── __init__.py      # Package exports
├── parser.py        # Main Parser class
└── README.md        # This file
```

## Classes

### `Parser`

Main parser class that processes Asemic code.

**Key Properties:**

- `groups`: List of curve groups (each group is a list of points)
- `settings`: Configuration settings for rendering
- `progress`: Animation progress and state tracking
- `scene_list`: List of timed scene draw functions
- `constants`: Dictionary of built-in expression constants
- `output`: Rendering output and error messages

**Key Methods:**

- `setup(source)`: Initialize parser with source code
- `draw()`: Render current frame based on progress
- `reset()`: Reset state for new frame or scene
- `play(value)`: Play/pause control
- `scrub(position)`: Jump to timeline position
- `expr(expression)`: Evaluate numeric expression
- `eval_point(expr)`: Evaluate point expression

### `BasicPt`

2D point class with x,y coordinates.

**Methods:**

- `clone()`: Create a copy
- `scale(factors)`: Scale by factors
- `add(other)`: Add another point
- `lerp(other, t)`: Linear interpolation

### `AsemicPt`

Extended point class that includes a reference to the parser.

### Data Classes

- `Transform`: Transformation properties for curves
- `Settings`: Parser configuration
- `Output`: Rendering output data
- `Progress`: Animation progress tracking
- `SceneItem`: Scene timing and draw functions

## Constants

The Parser includes many built-in constants for expressions:

### Math & Logic

- `-`: Negation
- `abs`: Absolute value
- `sin`: Sine function (0-1 input)
- `!`: Logical NOT
- `or`: Ternary conditional

### Indices & Counters

- `N(index)`: Current count in loop
- `I(index)`: Current index in loop
- `i(index)`: Normalized index (0-1)

### Time & Progress

- `T`: Current time
- `S`: Scrub progress (0-1 within scene)
- `ST`: Scrub time (absolute within scene)

### Canvas Properties

- `H`: Height/width aspect ratio
- `Hpx`: Height in pixels
- `Wpx`: Width in pixels
- `px(i)`: Convert pixels to normalized units

### Curve Properties

- `C`: Current curve length
- `L`: Current letter index
- `P`: Current point index

### Advanced Functions

- `>`: Interpolation operator
- `choose`: Select from array by index
- `~`: Noise generator
- `tangent`: Calculate curve tangent
- `hash`: Hash function
- `peaks`: Peak detection
- `acc`: Accumulator
- `table`: Sample image data

## Expression Parser

The `expr()` method provides a full-featured expression evaluator supporting:

**Operators** (in order of precedence):

1. Parentheses: `()`
2. Unary: `-`, `+`, `!` (logical NOT)
3. Power: `^`, `**`
4. Multiplicative: `*`, `/`, `%`
5. Additive: `+`, `-`
6. Comparison: `<`, `>`, `<=`, `>=`, `==`, `!=`

**Examples:**

```python
parser = Parser()

# Basic math
parser.expr("2 + 3")           # 5.0
parser.expr("2 * (3 + 4)")     # 14.0
parser.expr("2 ^ 3")           # 8.0

# Comparisons (return 1.0 for true, 0.0 for false)
parser.expr("5 > 3")           # 1.0
parser.expr("5 == 5")          # 1.0

# Built-in constants
parser.expr("sin(0.25)")       # ~0.0
parser.expr("abs(-5)")         # 5.0
parser.expr("choose(1, 10, 20, 30)")  # 20.0

# Complex expressions
parser.expr("2 + sin(T) * 5")  # Varies with time
```

**Point Expressions:**

```python
# Simple coordinates
pt = parser.eval_point("0.5 0.5")  # BasicPt(0.5, 0.5)

# With expressions
pt = parser.eval_point("sin(T) cos(T)")  # Animated point

# Single value (uses default_y)
pt = parser.eval_point("0.5", default_y=1.0)  # BasicPt(0.5, 1.0)
```

## Usage Example

```python
from parser import Parser

# Create parser instance
parser = Parser()

# Test expression evaluation
result = parser.expr("2 * (3 + 4) - 1")
print(f"Result: {result}")  # 13.0

# Evaluate with constants
parser.progress.time = 0.5
result = parser.expr("sin(T) + 1")
print(f"Time-based: {result}")

# Setup with source code (requires full parser implementation)
# parser.setup('''
# scene(5) {
#   pen(0 1, 0.5 0.5, 1 1)
# }
# ''')
```

## Testing

Run the test suite to verify expression parsing:

```bash
cd python/parser
python3 test_parser.py
```

The test covers:

- Basic arithmetic operations
- Operator precedence
- Parentheses
- Comparison operators
- Built-in functions
- Point parsing

## Implementation Status

### Completed ✅

- Core Parser class structure
- All data classes (BasicPt, AsemicPt, Transform, etc.)
- Built-in constants and expression functions
- Core methods (setup, draw, reset, play, scrub)
- Progress and state management
- Scene management and timing
- Pause functionality
- Debug output

### Recently Implemented ✅ (NEW - October 2025)

**Expression System:**

- **`expr()`**: Full expression parser and evaluator with:
  - Basic arithmetic operators: `+`, `-`, `*`, `/`, `%`, `^` (power)
  - Comparison operators: `<`, `>`, `<=`, `>=`, `==`, `!=`
  - Unary operators: `-`, `+`, `!`
  - Parentheses for grouping
  - Function calls with arguments
  - Constant lookups
  - Parameter access
  - Proper operator precedence
- **`eval_point()`**: Point expression parser supporting:
  - Space-separated x,y coordinates
  - Single value with default y
  - Expression evaluation for each coordinate
  - Point constant functions (like `>` for bezier interpolation)

**Scene Management:**

- **`scene()`**: Define scenes with timing and callbacks
- **`play()`**: Play/pause control with scene jumping
- **`scrub()`**: Timeline scrubbing
- **`param()`**: Define numeric parameters with ranges
- **`preset()`**: Create parameter presets
- **`to_preset()`**: Interpolate to preset values

**Utility Methods:**

- **`repeat()`**: Nested loop iteration with index tracking
- **`get_bounds()`**: Calculate bounding box of curves
- **`within()`**: Scale content to fit within bounds
- **`align()`**: Align content relative to a point
- **`test()`**: Conditional execution
- **`noise()`**: Sum-of-cosines noise generation

**Data Methods:**

- **`table()`**: Sample pixel values from loaded images
- **`load_files()`**: Load image data into parser
- **`resolve_name()`**: Resolve file paths with folder prefix

**Parsing Helpers:**

- **`tokenize()`**: Split text into tokens
- **`parse_point()`**: Parse point coordinate strings
- **`_split_args()`**: Parse function arguments

**Drawing Methods:** ✨

- **`tri()`**: Draw triangles between two points with height/width
- **`squ()`**: Draw squares/rectangles
- **`pen()`**: Draw pentagon-like shapes
- **`hex()`**: Draw hexagons
- **`circle()`**: Draw circles with bezier approximation
- **`seq()`**: Create sequences of points with repeat
- **`line()`**: Draw lines through multiple points
- **`points()`**: Add multiple points to current curve
- **`end()`**: Finalize current curve and add to group
- **`map_curve()`**: Map a curve between two points with transformations

**Transform Methods:** ✨

- **`to()`**: Apply transformations (scale `*`, translate `+`, rotate `@`, reset `!`)
- **`apply_transform()`**: Apply current transform to a point
- **`reverse_transform()`**: Reverse transform on a point
- **`parse_point_advanced()`**: Parse point notations including polar `@angle,radius` and relative `+x,y`
- **`parse_args()`**: Parse standard drawing arguments (start, end, height, width)

**Text Methods:** ✨

- **`linden()`**: Generate L-system text expansions
- **`regex()`**: Generate text from regex patterns (stub)
- **`font()`**: Set current font (stub)
- **`keys()`**: Set keyboard input state

**OSC Methods:** ✨

- **`osc()`**: Send OSC messages (stub for external communication)
- **`sc()`**: Send SuperCollider messages (stub)
- **`synth()`**: Define synth (stub)
- **`file()`**: Reference external files (stub)

**Enhanced BasicPt Methods:** ✨

- **`subtract()`**: Subtract another point
- **`magnitude()`**: Calculate vector length
- **`angle0to1()`**: Calculate normalized angle (0-1)
- **`rotate()`**: Rotate point by normalized angle
- **`scale()`**: Enhanced with optional center point

### Placeholder (Requires Full Implementation) ⚠️

- `parse()`: Full Asemic source code parser/compiler
- Full font rendering system with glyph data
- Complete OSC messaging implementation
- Full regex pattern expansion

These methods have basic or stub implementations that can be extended based on your needs.

## Differences from TypeScript Version

1. **Type Annotations**: Uses Python type hints instead of TypeScript types
2. **Dataclasses**: Uses `@dataclass` decorator for data structures
3. **Method Organization**: All methods are in single file rather than split across method classes
4. **Performance**: Python implementation may be slower for complex expressions
5. **No Direct DOM/Canvas**: Requires separate rendering implementation

## Dependencies

Standard library only:

- `math`: Mathematical functions
- `time`: Time tracking
- `random`: Random number generation
- `typing`: Type annotations
- `dataclasses`: Data class decorators

No external packages required for core functionality.

## Extension

To extend the parser with custom constants:

```python
custom_constants = {
    'myConst': lambda x: float(x) * 2.0,
    'myFunc': lambda: 42.0
}

parser = Parser(additional_constants=custom_constants)
```

## Notes

### About the Scrubber Issue

The original question was about scrubber causing play/pause issues. In this implementation:

- The `scrub()` method sets `progress.progress` to the target position
- Unlike `play()`, `scrub()` intentionally does NOT clear `pause_at`
- This preserves the pause state during scrubbing
- The `draw()` method checks for pause points and may set `pause_at` if progress crosses a scene boundary
- To fix scrubbing issues, you may want to:
  1. Clear `pause_at` in `scrub()` method, OR
  2. Add a flag to temporarily disable pause logic during scrubbing

## License

Same as parent Asemic project.

## Contributing

This is a translation of the TypeScript implementation. For feature requests or bugs in the core Asemic language, please refer to the main project.
