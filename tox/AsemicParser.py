"""
Python implementation of the Asemic Parser class
Translated from TypeScript for TouchDesigner .tox extension
"""

import math
import random
import re
import time
from typing import Any, Dict, List, Callable, Optional, Union, Tuple
from functools import lru_cache


class AsemicPt:
    """Basic point class for Asemic parsing"""

    def __init__(self, parser, x: float, y: float):
        self.parser = parser
        self.x = x
        self.y = y

    def clone(self):
        return AsemicPt(self.parser, self.x, self.y)

    def scale(self, factors: List[float]):
        self.x *= factors[0]
        self.y *= factors[1]
        return self

    def add(self, other):
        self.x += other.x
        self.y += other.y
        return self

    def __getitem__(self, index):
        return self.x if index == 0 else self.y

    def __setitem__(self, index, value):
        if index == 0:
            self.x = value
        else:
            self.y = value


class AsemicGroup:
    """Group of points representing a curve or shape"""

    def __init__(self):
        self.points: List[AsemicPt] = []

    def flat(self):
        """Return flattened coordinates"""
        return [[pt.x, pt.y] for pt in self.points]


class Transform:
    """Transform representation"""

    def __init__(self):
        self.translation = [0.0, 0.0]
        self.rotation = 0.0
        self.scale = [1.0, 1.0]
        self.width = 1.0


class Settings:
    """Parser settings"""

    def __init__(self):
        self.h = 'auto'
        self.width = 1920
        self.height = 1080


class Output:
    """Parser output structure"""

    def __init__(self):
        self.errors: List[str] = []
        self.osc: List[Any] = []
        self.resetParams = False
        self.resetPresets = False
        self.pauseAt: Union[str, bool] = False


class Progress:
    """Progress tracking for animation"""

    def __init__(self):
        self.point = 0
        self.time = time.time()
        self.curve = 0
        self.seed = random.random()
        self.indexes = [0, 0, 0]
        self.countNums = [0, 0, 0]
        self.accums: List[float] = []
        self.accumIndex = 0
        self.letter = 0
        self.scrub = 0.0
        self.scrubTime = 0.0
        self.progress = 0.0
        self.regexCache: Dict[str, List[str]] = {}


class Scene:
    """Scene representation"""

    def __init__(self):
        self.start = 0.0
        self.length = 0.0
        self.draw: Optional[Callable] = None
        self.pause: Union[float, bool] = False
        self.offset = 0.0
        self.isSetup = False
        self.setup: Optional[Callable] = None


class AsemicParser:
    """
    Python implementation of the Asemic Parser class
    Main parsing and execution engine for Asemic language
    """

    ONE_FRAME = 1.0 / 60.0  # 60fps frame rate

    def __init__(self, additional_constants: Optional[Dict[str, Callable]] = None):
        # Core state
        self.rawSource = ""
        self.presets: Dict[str, Dict[str, Any]] = {}
        self.mode = "normal"  # 'normal' | 'blank'
        self.adding = 0
        self.debugged: Dict[str, Dict[str, List[str]]] = {}
        self.groups: List[AsemicGroup] = []
        self.settings = Settings()
        self.currentCurve: List[AsemicPt] = []
        self.currentTransform = Transform()
        self.transformStack: List[Transform] = []
        self.namedTransforms: Dict[str, Transform] = {}
        self.totalLength = 0.0
        self.pausedAt: List[str] = []
        self.pauseAt: Union[str, bool] = False
        self.sceneList: List[Scene] = []
        self.params: Dict[str, Any] = {}
        self.progress = Progress()
        self.live = {"keys": [""]}

        # Preprocessing settings
        self.preProcessing = {
            "width": 1920,
            "height": 1080
        }

        # Output
        self.output = Output()

        # Fonts and rendering
        # TODO: Implement font system
        self.fonts: Dict[str, Any] = {"default": None}
        self.currentFont = "default"
        self.lastPoint = AsemicPt(self, 0, 0)

        # Noise generation
        self.noiseTable: List[Callable[[float], float]] = []
        self.noiseValues: List[float] = []
        self.noiseIndex = 0

        # Image data
        self.images: Dict[str, List[Any]] = {}

        # Initialize constants
        self._setup_constants()
        if additional_constants:
            for key, value in additional_constants.items():
                if key in self.constants:
                    raise ValueError(f"Reserved constant: {key}")
                self.constants[key] = value

        self.sortedKeys = sorted(self.constants.keys(), key=len, reverse=True)

    def _setup_constants(self):
        """Setup built-in constants and functions"""
        self.constants: Dict[str, Callable] = {
            # Progress constants
            "N": lambda index="1": self.progress.countNums[int(self.expr(index)) - 1],
            "I": lambda index="1": self.progress.indexes[int(self.expr(index)) - 1],
            "i": lambda index="1": self.progress.indexes[int(self.expr(index)) - 1] /
            max(1, self.progress.countNums[int(self.expr(index)) - 1] - 1),
            "T": lambda: self.progress.time,
            "!": lambda continuing: 0 if self.expr(continuing) else 1,
            "H": lambda: self.preProcessing["height"] / self.preProcessing["width"],
            "Hpx": lambda: self.preProcessing["height"],
            "Wpx": lambda: self.preProcessing["width"],
            "S": lambda: self.progress.scrubTime,
            "C": lambda: self.progress.curve,
            "L": lambda: self.progress.letter,
            "P": lambda: self.progress.point,
            "px": lambda: 1.0 / self.preProcessing["width"],

            # Math functions
            "sin": lambda x: math.sin(self.expr(x) * math.pi * 2) * 0.5 + 0.5,
            "cos": lambda x: math.cos(self.expr(x) * math.pi * 2) * 0.5 + 0.5,
            "table": self.table,
            "acc": self._accumulator,
            ">": self._interpolate,
            "~": self._noise,
        }

        # Point constants
        self.pointConstants: Dict[str, Callable] = {
            ">": self._bezier_interpolate
        }

        # Curve constants
        self.curveConstants: Dict[str, Callable[[str], None]] = {
            "repeat": self._repeat_curve,
            "within": self._within_curve,
            "circle": self._circle_curve,
            "debug": self._debug_curve
        }

    def expr(self, expression: Union[str, int, float], replace: bool = True) -> float:
        """Evaluate mathematical expression"""
        if expression is None:
            raise ValueError("undefined or null expression")

        if isinstance(expression, (int, float)):
            return float(expression)

        expr_str = str(expression).strip()
        if not expr_str:
            raise ValueError("Empty expression")

        self.progress.curve += 1

        # Handle simple numbers
        if re.match(r'^-?[0-9.]+$', expr_str):
            return float(expr_str)

        # Replace constants
        if replace:
            for key in self.sortedKeys:
                if key in expr_str:
                    # Simple replacement for now - would need more sophisticated parsing
                    if key in self.constants:
                        try:
                            value = self.constants[key]()
                            expr_str = expr_str.replace(key, str(value))
                        except:
                            pass

        # Evaluate basic math expressions
        try:
            # Basic math evaluation (would need more sophisticated parser)
            return float(eval(expr_str))
        except:
            self.error(f"Failed to evaluate expression: {expr_str}")
            return 0.0

    def _accumulator(self, x: Union[str, float]) -> float:
        """Accumulator function"""
        if self.progress.accumIndex >= len(self.progress.accums):
            self.progress.accums.append(0.0)

        value = self.expr(x)
        # Correct for 60fps
        self.progress.accums[self.progress.accumIndex] += value / 60.0
        current_accum = self.progress.accums[self.progress.accumIndex]
        self.progress.accumIndex += 1
        return current_accum

    def _interpolate(self, *args) -> float:
        """Linear interpolation between values"""
        if len(args) < 2:
            return 0.0

        fade = self.expr(args[0])
        fade = max(0.0, min(0.999, fade))

        values = [self.expr(arg) for arg in args[1:]]
        if len(values) < 2:
            return values[0] if values else 0.0

        index = (len(values) - 1) * fade
        floor_index = int(index)

        if floor_index >= len(values) - 1:
            return values[-1]

        return self._lerp(values[floor_index], values[floor_index + 1], index % 1)

    def _lerp(self, a: float, b: float, t: float) -> float:
        """Linear interpolation"""
        return a + (b - a) * t

    def _noise(self, speed: str = "1", *freqs) -> float:
        """Noise generation"""
        sample_index = self.noiseIndex

        while sample_index >= len(self.noiseTable):
            if freqs:
                frequencies = [self.expr(f) for f in freqs]
            else:
                frequencies = [random.random() for _ in range(3)]

            self.noiseTable.append(
                lambda x, f=frequencies: self._noise_function(x, f) * 0.5 + 0.5)
            self.noiseValues.append(0.0)

        value = self.expr(speed) / 60.0
        self.noiseValues[self.noiseIndex] += value

        noise = self.noiseTable[self.noiseIndex](
            self.noiseValues[self.noiseIndex])
        self.noiseIndex += 1

        return noise

    def _noise_function(self, x: float, frequencies: List[float]) -> float:
        """Simple noise function - would be replaced with proper noise"""
        result = 0.0
        for i, freq in enumerate(frequencies):
            result += math.sin(x * freq * (i + 1)) / (i + 1)
        return result / len(frequencies)

    def _bezier_interpolate(self, progress: str, *points) -> AsemicPt:
        """Bezier interpolation for points"""
        expr_points = [self.evalPoint(p) for p in points]
        expr_fade = self.expr(progress)
        expr_fade = max(0.0, min(0.999, expr_fade))

        if len(expr_points) < 3:
            return expr_points[0] if expr_points else AsemicPt(self, 0, 0)

        index = (len(expr_points) - 2) * expr_fade
        start = int(index)

        def bezier(p1: AsemicPt, p2: AsemicPt, p3: AsemicPt, amount: float) -> AsemicPt:
            u = 1 - amount
            result = AsemicPt(self, 0, 0)
            result.x = u*u*p1.x + 2*u*amount*p2.x + amount*amount*p3.x
            result.y = u*u*p1.y + 2*u*amount*p2.y + amount*amount*p3.y
            return result

        return bezier(expr_points[start], expr_points[start + 1], expr_points[start + 2], index % 1)

    def evalPoint(self, point_str: str) -> AsemicPt:
        """Evaluate a point expression"""
        # Simple implementation - would need more sophisticated parsing
        coords = point_str.split(',')
        if len(coords) >= 2:
            x = self.expr(coords[0].strip())
            y = self.expr(coords[1].strip())
            return AsemicPt(self, x, y)
        return AsemicPt(self, 0, 0)

    def table(self, name: str, point: str, channel: str) -> float:
        """Table lookup function"""
        # TODO: Implement table lookup
        return 0.0

    def repeat(self, count: Union[str, int], evaluation: str):
        """Repeat operation with index tracking"""
        count_num = int(self.expr(count)) if isinstance(count, str) else count

        # Find available index level (0, 1, or 2)
        index_level = 0
        for i in range(3):
            if self.progress.countNums[i] == 0:
                index_level = i
                break

        # Set up the count and reset index
        self.progress.countNums[index_level] = count_num
        self.progress.indexes[index_level] = 0

        # Execute the evaluation for each iteration
        for i in range(count_num):
            self.progress.indexes[index_level] = i
            try:
                self.parse(evaluation)
            except Exception as e:
                self.error(f"Repeat iteration {i} failed: {str(e)}")

        # Reset the count after completion
        self.progress.countNums[index_level] = 0
        self.progress.indexes[index_level] = 0

    def parse(self, source: str):
        """Parse and execute source code"""
        lines = source.split('\n')
        i = 0

        while i < len(lines):
            line = lines[i].strip()

            # Skip empty lines and comments
            if not line or line.startswith('#'):
                i += 1
                continue

            # Check if this line contains a callback block
            if '{' in line:
                # Find the complete callback block
                callback_start = i
                brace_count = 0
                callback_lines = []

                # Process the current line and count braces
                current_line = line
                j = i

                while j < len(lines):
                    current_line = lines[j].strip()

                    # Count braces
                    brace_count += current_line.count('{')
                    brace_count -= current_line.count('}')

                    # Extract content inside braces
                    if '{' in current_line:
                        # Get everything after the opening brace
                        brace_pos = current_line.find('{')
                        before_brace = current_line[:brace_pos].strip()
                        after_brace = current_line[brace_pos + 1:].strip()

                        if after_brace:
                            callback_lines.append(after_brace)
                    else:
                        callback_lines.append(current_line)

                    # If braces are balanced, we found the complete block
                    if brace_count == 0:
                        # Remove the closing brace from the last line
                        if callback_lines and '}' in callback_lines[-1]:
                            last_line = callback_lines[-1]
                            brace_pos = last_line.rfind('}')
                            callback_lines[-1] = last_line[:brace_pos].strip()
                            if not callback_lines[-1]:
                                callback_lines.pop()

                        # Execute the command with callback
                        command_part = lines[callback_start].split('{')[
                            0].strip()
                        callback_code = '\n'.join(callback_lines)

                        try:
                            self._execute_line_with_callback(
                                command_part, callback_code)
                        except Exception as e:
                            self.error(f"Callback execution error: {str(e)}")

                        i = j + 1
                        break

                    j += 1

                if brace_count != 0:
                    self.error(
                        f"Unmatched braces starting at line {callback_start + 1}")
                    i += 1

    def line(self, *args):
        """Draw a line between points"""
        if len(args) < 2:
            self.error("Line requires at least 2 points")
            return

        # Parse all points
        points = []
        for arg in args:
            if isinstance(arg, str):
                point = self.evalPoint(arg)
                points.append(point)
            else:
                self.error(f"Invalid point argument: {arg}")
                return

        # Create line by adding points to current curve
        for point in points:
            # Apply current transform
            transformed_point = self._apply_current_transform(point)
            self.currentCurve.append(transformed_point)
            self.lastPoint = transformed_point.clone()
            self.progress.point += 1

    def _apply_current_transform(self, point: AsemicPt) -> AsemicPt:
        """Apply current transform to a point"""
        # Clone the point to avoid modifying the original
        transformed = point.clone()

        # Apply scale
        transformed.scale(self.currentTransform.scale)

        # Apply rotation (if non-zero)
        if self.currentTransform.rotation != 0:
            cos_r = math.cos(self.currentTransform.rotation)
            sin_r = math.sin(self.currentTransform.rotation)
            x = transformed.x * cos_r - transformed.y * sin_r
            y = transformed.x * sin_r + transformed.y * cos_r
            transformed.x = x
            transformed.y = y

        # Apply translation
        transformed.x += self.currentTransform.translation[0]
        transformed.y += self.currentTransform.translation[1]

        return transformed

    def _repeat_curve(self, args: str):
        """Repeat curve command"""
        parts = args.split(' ', 1)
        if len(parts) >= 2:
            count = parts[0]
            evaluation = parts[1]
            self.repeat(count, evaluation)
        else:
            self.error("Repeat requires count and evaluation arguments")

    def _within_curve(self, args: str):
        """Within curve command"""
        tokens = self.tokenize(args)
        if len(tokens) >= 3:
            coord0, coord1 = tokens[0], tokens[1]
            rest = ' '.join(tokens[2:])
            self.within(coord0, coord1, rest)
        else:
            self.error(
                "Within requires at least 3 arguments: coord0, coord1, and evaluation")

    def _circle_curve(self, args: str):
        """Circle curve command"""
        self.circle(args)

    def _debug_curve(self, args: str):
        """Debug curve command"""
        self.debug()

    def within(self, coord0: str, coord1: str, evaluation: str):
        """Within operation - execute code within a coordinate space"""
        # Parse the coordinate bounds
        try:
            # Save current transform
            saved_transform = Transform()
            saved_transform.translation = self.currentTransform.translation.copy()
            saved_transform.rotation = self.currentTransform.rotation
            saved_transform.scale = self.currentTransform.scale.copy()
            saved_transform.width = self.currentTransform.width

            # Parse the bounds
            x0 = self.expr(coord0)
            x1 = self.expr(coord1)

            # Set up coordinate space transformation
            # This creates a local coordinate system from x0 to x1
            width = x1 - x0
            self.currentTransform.translation[0] += x0
            self.currentTransform.scale[0] *= width

            # Execute the evaluation within this coordinate space
            self.parse(evaluation)

            # Restore transform
            self.currentTransform = saved_transform

        except Exception as e:
            self.error(f"Within operation failed: {str(e)}")

    def circle(self, args: str):
        """Circle drawing - create a circular path"""
        try:
            tokens = self.tokenize(args) if args.strip() else []

            # Default values
            radius = 0.5
            segments = 32
            center_x = 0.0
            center_y = 0.0

            # Parse arguments
            if len(tokens) >= 1:
                radius = self.expr(tokens[0])
            if len(tokens) >= 2:
                segments = int(self.expr(tokens[1]))
            if len(tokens) >= 3:
                center_x = self.expr(tokens[2])
            if len(tokens) >= 4:
                center_y = self.expr(tokens[3])

            # Generate circle points
            for i in range(segments + 1):  # +1 to close the circle
                angle = (i / segments) * 2 * math.pi
                x = center_x + radius * math.cos(angle)
                y = center_y + radius * math.sin(angle)

                point = AsemicPt(self, x, y)
                transformed_point = self._apply_current_transform(point)
                self.currentCurve.append(transformed_point)
                self.lastPoint = transformed_point.clone()
                self.progress.point += 1

        except Exception as e:
            self.error(f"Circle drawing failed: {str(e)}")

    def tokenize(self, text: str) -> List[str]:
        """Tokenize input text"""
        return text.split()

    def setup(self, source: str):
        """Setup parser with source code"""
        self.progress.seed = random.random()
        self.fonts = {"default": None}  # TODO: Implement fonts
        self.totalLength = 0.0

        self.settings = Settings()
        self.sceneList = []
        self.rawSource = source

        self.output.resetParams = True
        self.output.resetPresets = True

        try:
            # Replace arrow functions (-> becomes lambda in Python context)
            processed_source = source.replace('->', 'lambda: ')

            # Parse and execute source code to build scene list
            self.parse(processed_source)

            # Sort constants by length for proper replacement
            self.sortedKeys = sorted(
                self.constants.keys(), key=len, reverse=True)

        except Exception as e:
            self.output.errors.append(f"Setup failed: {str(e)}")

    def scene(self, *args):
        """Create a scene"""
        try:
            # Parse arguments
            length = 1.0  # Default length
            callback_code = ""

            if len(args) >= 1:
                # First argument could be length or callback
                if isinstance(args[0], str) and not args[0].replace('.', '').isdigit():
                    # It's callback code
                    callback_code = args[0]
                else:
                    # It's length
                    length = float(self.expr(args[0]))
                    if len(args) >= 2:
                        callback_code = args[1]

            # Create scene object
            scene = Scene()
            scene.start = self.totalLength
            scene.length = length
            scene.pause = False
            scene.offset = 0.0
            scene.isSetup = False

            # Create draw function that executes the callback
            if callback_code:
                def scene_draw(parser):
                    parser.parse(callback_code)
                scene.draw = scene_draw
            else:
                scene.draw = None

            # Add to scene list
            self.sceneList.append(scene)

            # Update total length
            self.totalLength += length

        except Exception as e:
            self.error(f"Scene creation failed: {str(e)}")

    def _execute_line_with_callback(self, command: str, callback_code: str):
        """Execute a command that has a callback block"""
        command = command.strip()

        # Handle commands that accept callbacks
        if command.startswith('repeat '):
            args = command[7:].strip()
            tokens = self.tokenize(args)
            if tokens:
                count = tokens[0]
                self.repeat(count, callback_code)
        elif command.startswith('within '):
            args = command[7:].strip()
            tokens = self.tokenize(args)
            if len(tokens) >= 2:
                coord0, coord1 = tokens[0], tokens[1]
                self.within(coord0, coord1, callback_code)
        elif command.startswith('scene'):
            # Parse scene arguments
            args = command[5:].strip() if len(command) > 5 else ""
            if args:
                self.scene(args, callback_code)
            else:
                self.scene(callback_code)
        else:
            # Try to execute as a regular command with the callback as argument
            self._execute_line(f"{command} {callback_code}")

    def _execute_line(self, line: str):
        """Execute a single line of code"""
        line = line.strip()
        if not line or line.startswith('#'):
            return

        # Handle curve constants
        for const_name, const_func in self.curveConstants.items():
            if line.startswith(const_name + ' '):
                args = line[len(const_name):].strip()
                const_func(args)
                return

        # Handle basic drawing commands
        if line.startswith('line '):
            args = line[5:].strip()
            points = self.tokenize(args)
            self.line(*points)
        elif line.startswith('repeat '):
            args = line[7:].strip()
            self._repeat_curve(args)
        elif line.startswith('circle'):
            args = line[6:].strip() if len(line) > 6 else ""
            self.circle(args)
        elif line.startswith('within '):
            args = line[7:].strip()
            self._within_curve(args)
        elif line.startswith('scene'):
            args = line[5:].strip() if len(line) > 5 else ""
            if args:
                self.scene(args)
            else:
                self.scene()
        elif line.startswith('debug'):
            self.debug()
        elif line.startswith('pen '):
            args = line[4:].strip()
            self.pen(args)
        elif line.startswith('to '):
            args = line[3:].strip()
            self.to(args)
        else:
            # Try to evaluate as expression
            try:
                self.expr(line)
            except Exception as e:
                self.error(f"Unknown command or expression: {line}")

    def pen(self, args: str):
        """Set pen position"""
        try:
            coords = args.split(',')
            if len(coords) >= 2:
                x = self.expr(coords[0].strip())
                y = self.expr(coords[1].strip())
                point = AsemicPt(self, x, y)
                transformed_point = self._apply_current_transform(point)
                self.lastPoint = transformed_point.clone()
            else:
                self.error("Pen requires x,y coordinates")
        except Exception as e:
            self.error(f"Pen command failed: {str(e)}")

    def to(self, args: str):
        """Draw line to position"""
        try:
            coords = args.split(',')
            if len(coords) >= 2:
                x = self.expr(coords[0].strip())
                y = self.expr(coords[1].strip())
                point = AsemicPt(self, x, y)
                transformed_point = self._apply_current_transform(point)

                # Add both current position and new position to create line
                self.currentCurve.append(self.lastPoint.clone())
                self.currentCurve.append(transformed_point)

                self.lastPoint = transformed_point.clone()
                self.progress.point += 1
            else:
                self.error("To requires x,y coordinates")
        except Exception as e:
            self.error(f"To command failed: {str(e)}")

    def draw(self):
        """Draw current frame"""
        self.reset()

        for i, scene in enumerate(self.sceneList):
            if (self.progress.progress >= scene.start and
                    self.progress.progress < scene.start + scene.length):

                self.reset(new_frame=False)
                self.progress.scrub = (
                    self.progress.progress - scene.start) / scene.length
                self.progress.scrubTime = self.progress.progress - scene.start

                try:
                    if scene.draw:
                        scene.draw(self)

                    # Finalize current curve into a group
                    if self.currentCurve:
                        group = AsemicGroup()
                        group.points = self.currentCurve.copy()
                        self.groups.append(group)
                        self.currentCurve = []

                except Exception as e:
                    self.error(f"Scene {i} failed: {str(e)}")

                if (self.pauseAt is False and
                    scene.pause is not False and
                        self.progress.progress >= scene.start + scene.pause - 0.02):

                    pause = f"{scene.start + scene.pause:.5f}"
                    if pause not in self.pausedAt:
                        self.pauseAt = pause
                        break

    def reset(self, new_frame: bool = True):
        """Reset parser state"""
        if new_frame:
            self.groups = []
            self.progress.time = time.time()
            self.progress.progress += 0 if self.pauseAt is not False else self.ONE_FRAME

            if self.progress.progress >= self.totalLength - self.ONE_FRAME:
                self.pausedAt = []
                self.progress.progress = 0.0

            self.output = Output()
            self.output.pauseAt = self.pauseAt

        self.transformStack = []
        self.lastPoint = AsemicPt(self, 0, 0)
        self.currentTransform = Transform()
        self.currentCurve = []
        self.currentFont = "default"
        self.progress.point = 0
        self.progress.curve = 0

        for i in range(3):
            self.progress.indexes[i] = 0
            self.progress.countNums[i] = 0

        self.noiseIndex = 0
        self.progress.accumIndex = 0
        self.progress.seed = 1.0

    def play(self, value: Any):
        """Play command"""
        # TODO: Implement play logic
        pass

    def scrub(self, value: float):
        """Scrub to specific time"""
        self.progress.progress = value

    def error(self, text: str):
        """Add error message"""
        if text not in self.output.errors:
            self.output.errors.append(text)

    def debug(self, slice_val: int = 0) -> str:
        """Debug output"""
        def to_fixed(x: float) -> str:
            return f"{x:.2f}"

        all_curves = [group.flat() for group in self.groups] + \
            [[[pt.x, pt.y] for pt in self.currentCurve]]
        curves_text = []

        for curve in all_curves[slice_val:]:
            points_text = []
            for point in curve:
                points_text.append(
                    f"{to_fixed(point[0])},{to_fixed(point[1])}")
            curves_text.append(f"[{' '.join(points_text)}]")

        result = '\n'.join(curves_text)
        self.output.errors.append(result)
        return result

    def hash(self, n: float) -> float:
        """Hash function for random generation"""
        val = math.sin(n) * (43758.5453123 + self.progress.seed)
        return abs(val - math.floor(val))

    @property
    def duration(self) -> float:
        """Get total duration"""
        return self.totalLength

    def loadFiles(self, files: Dict[str, Any]):
        """Load external files"""
        # TODO: Implement file loading
        pass
