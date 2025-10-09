"""
Asemic Parser - Python Translation
Main Parser class for processing Asemic graphics language

This is a Python translation of the TypeScript Parser class from the Asemic project.
It provides the core functionality for parsing and executing Asemic graphics language.
"""

import math
import time
import random
import re
from typing import Dict, List, Tuple, Union, Callable, Optional, Any
from dataclasses import dataclass, field


# Constants
ONE_FRAME = 1 / 60


def lerp(a: float, b: float, t: float) -> float:
    """Linear interpolation between two values"""
    return a + (b - a) * t


@dataclass
class BasicPt:
    """Basic 2D point class representing x,y coordinates"""
    x: float = 0.0
    y: float = 1.0

    def __getitem__(self, index: int) -> float:
        """Allow array-style access to coordinates"""
        return self.x if index == 0 else self.y

    def __setitem__(self, index: int, value: float):
        """Allow array-style setting of coordinates"""
        if index == 0:
            self.x = value
        else:
            self.y = value

    def clone(self) -> 'BasicPt':
        """Create a copy of this point"""
        return BasicPt(self.x, self.y)

    def scale(self, factors: List[float], center: Optional['BasicPt'] = None) -> 'BasicPt':
        """Scale the point by given factors, optionally around a center point"""
        if center:
            self.x = center.x + (self.x - center.x) * factors[0]
            self.y = center.y + (self.y - center.y) * factors[1]
        else:
            self.x *= factors[0]
            self.y *= factors[1]
        return self

    def add(self, other: 'BasicPt') -> 'BasicPt':
        """Add another point to this one"""
        self.x += other.x
        self.y += other.y
        return self

    def subtract(self, other: 'BasicPt') -> 'BasicPt':
        """Subtract another point from this one"""
        self.x -= other.x
        self.y -= other.y
        return self

    def magnitude(self) -> float:
        """Calculate the magnitude (length) of the vector"""
        return math.sqrt(self.x * self.x + self.y * self.y)

    def angle0to1(self) -> float:
        """Calculate angle as normalized value (0-1) instead of radians"""
        angle = math.atan2(self.y, self.x)
        if angle < 0:
            angle += math.pi * 2
        return angle / (math.pi * 2)

    def rotate(self, amount0to1: float, around: Optional['BasicPt'] = None) -> 'BasicPt':
        """Rotate point by normalized angle (0-1), optionally around a center point"""
        theta = amount0to1 * math.pi * 2
        cos_theta = math.cos(theta)
        sin_theta = math.sin(theta)

        if around:
            # Rotate around a center point
            dx = self.x - around.x
            dy = self.y - around.y
            self.x = dx * cos_theta - dy * sin_theta + around.x
            self.y = dx * sin_theta + dy * cos_theta + around.y
        else:
            # Rotate around origin
            dx = self.x
            dy = self.y
            self.x = dx * cos_theta - dy * sin_theta
            self.y = dx * sin_theta + dy * cos_theta
        return self

    def lerp(self, other: 'BasicPt', t: float) -> 'BasicPt':
        """Linear interpolation to another point"""
        self.x = self.x + (other.x - self.x) * t
        self.y = self.y + (other.y - self.y) * t
        return self


class AsemicPt(BasicPt):
    """Extended point class with parser reference"""

    def __init__(self, parser: Optional['Parser'], x: float = 0.0, y: float = 0.0):
        super().__init__(x, y)
        self.parser = parser


# Type alias for curves (list of points)
AsemicGroup = List[AsemicPt]


@dataclass
class Transform:
    """Transform properties for curves and shapes"""
    scale: BasicPt = field(default_factory=lambda: BasicPt(1, 1))
    translation: BasicPt = field(default_factory=lambda: BasicPt(0, 0))
    rotation: float = 0.0
    add: Optional[str] = None
    rotate: Optional[str] = None
    width: Union[float, Callable[[], float]] = 1.0
    h: Union[float, Callable[[], float]] = 1.0
    s: Union[float, Callable[[], float]] = 1.0
    l: Union[float, Callable[[], float]] = 0.5
    a: Union[float, Callable[[], float]] = 1.0


def default_transform() -> Transform:
    """Create a default transform"""
    return Transform()


def clone_transform(transform: Transform) -> Transform:
    """Deep clone a transform object"""
    return Transform(
        scale=transform.scale.clone(),
        translation=transform.translation.clone(),
        rotation=transform.rotation,
        add=transform.add,
        rotate=transform.rotate,
        width=transform.width,
        h=transform.h,
        s=transform.s,
        l=transform.l,
        a=transform.a
    )


@dataclass
class Settings:
    """Parser settings and configuration"""
    debug: bool = True
    h: Union[float, str] = 'window'
    perform: bool = False
    scene: int = 0
    fullscreen: bool = False
    folder: str = ''


def default_settings() -> Settings:
    """Create default settings"""
    return Settings()


@dataclass
class Output:
    """Parser output data including errors and OSC messages"""
    errors: List[str] = field(default_factory=list)
    osc: List[Any] = field(default_factory=list)
    sc: List[Dict[str, Any]] = field(default_factory=list)
    sc_synth_defs: Dict[str, str] = field(default_factory=dict)
    files: List[str] = field(default_factory=list)
    pauseAt: Union[str, bool] = False
    resetParams: bool = False
    resetPresets: bool = False
    params: Optional[Dict[str, Any]] = None
    presets: Optional[Dict[str, Any]] = None


def default_output() -> Output:
    """Create default output"""
    return Output()


@dataclass
class PreProcessing:
    """Pre-processing settings for rendering"""
    width: int = 800
    height: int = 600


def default_pre_process() -> PreProcessing:
    """Create default pre-processing settings"""
    return PreProcessing()


@dataclass
class SceneItem:
    """Scene list item containing draw functions and timing"""
    start: float
    length: float
    draw: Callable[[], None]
    pause: Union[bool, float]
    offset: float
    is_setup: bool
    setup: Optional[Callable[[], None]] = None


@dataclass
class Progress:
    """Progress tracking for animation and rendering"""
    point: float = 0.0
    time: float = field(default_factory=time.time)
    curve: int = 0
    seed: float = field(default_factory=random.random)
    indexes: List[int] = field(default_factory=lambda: [0, 0, 0])
    count_nums: List[int] = field(default_factory=lambda: [0, 0, 0])
    accums: List[float] = field(default_factory=list)
    accum_index: int = 0
    letter: int = 0
    scrub: float = 0.0
    scrub_time: float = 0.0
    progress: float = 0.0
    regex_cache: Dict[str, List[str]] = field(default_factory=dict)


@dataclass
class Live:
    """Live input data for real-time interaction"""
    keys: List[str] = field(default_factory=lambda: [''])


class Parser:
    """
    Main Asemic Parser class

    Translates Asemic graphics language into renderable output.
    This is a Python port of the TypeScript Parser class.

    The Parser handles:
    - Parsing Asemic source code
    - Managing animation state and progress
    - Evaluating expressions and constants
    - Drawing curves and shapes
    - Scene management and timing
    """

    # Class-level default settings
    default_settings = default_settings()

    def __init__(self, additional_constants: Optional[Dict[str, Callable]] = None):
        """
        Initialize the Parser

        Args:
            additional_constants: Optional dict of additional constant functions
        """
        # Core properties
        self.raw_source: str = ''
        self.presets: Dict[str, Dict] = {}
        self.mode: str = 'normal'  # 'normal' or 'blank'
        self.adding: int = 0
        self.debugged: Dict[str, Dict[str, List[str]]] = {}
        self.groups: List[List[AsemicPt]] = []
        self.settings: Settings = default_settings()
        self.current_curve: List[AsemicPt] = []
        self.current_transform: Transform = default_transform()
        self.transform_stack: List[Transform] = []
        self.named_transforms: Dict[str, Transform] = {}
        self.total_length: float = 0.0
        self.paused_at: List[str] = []
        self.pause_at: Union[str, bool] = False
        self.scene_list: List[SceneItem] = []
        self.params: Dict = {}
        self.progress: Progress = Progress()
        self.live: Live = Live()

        # Font management (placeholder)
        self.fonts: Dict[str, Any] = {}
        self.current_font: str = 'default'

        # Point tracking
        self.last_point: AsemicPt = AsemicPt(self, 0, 0)

        # Noise generation
        self.noise_table: List[Callable[[float], float]] = []
        self.noise_values: List[float] = []
        self.noise_index: int = 0

        # Image data
        self.images: Dict[str, List[Any]] = {}

        # Output
        self.output: Output = default_output()
        self.pre_processing: PreProcessing = default_pre_process()

        # Initialize constants
        self._init_constants()
        self._init_point_constants()

        # Add additional constants if provided
        if additional_constants:
            for key, func in additional_constants.items():
                if key in self.reserved_constants:
                    raise ValueError(f"Reserved constant: {key}")
                self.constants[key] = func

    def _init_point_constants(self):
        """Initialize point constant functions (operators that return points)"""
        self.point_constants: Dict[str, Callable] = {
            '>': self._point_bezier_interpolate
        }

    def _point_bezier_interpolate(self, progress: str, *points: str) -> BasicPt:
        """
        Bezier interpolation between points using the '>' operator

        Args:
            progress: Expression for interpolation progress (0-1)
            points: Variable number of point expressions

        Returns:
            Interpolated point on bezier curve
        """
        expr_points = [self.eval_point(x, basic=True) for x in points]
        expr_fade = self.expr(progress)

        # Clamp fade value
        if expr_fade >= 1:
            expr_fade = 0.999
        elif expr_fade < 0:
            expr_fade = 0

        index = (len(expr_points) - 2) * expr_fade
        start = math.floor(index)

        def bezier(point1: BasicPt, point2: BasicPt, point3: BasicPt, amount: float) -> BasicPt:
            """Calculate quadratic bezier point"""
            t = amount % 1
            u = 1 - t

            # Adjust control points at boundaries
            if amount >= 1:
                point1 = point1.clone().lerp(point2, 0.5)
            if amount < len(points) - 3:
                point3 = point3.clone().lerp(point2, 0.5)

            # Quadratic bezier formula: B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
            return (point1.clone().scale([u**2, u**2])
                    .add(point2.clone().scale([2 * u * t, 2 * u * t])
                         .add(point3.clone().scale([t**2, t**2]))))

        return bezier(expr_points[start], expr_points[start + 1], expr_points[start + 2], index)

    def _init_constants(self):
        """Initialize all built-in constant functions"""
        self.constants: Dict[str, Callable] = {}

        # Basic math operations
        self.constants['-'] = lambda x: -1 * self.expr(x)
        self.constants['abs'] = lambda value: abs(self.expr(value))
        self.constants['sin'] = lambda x: math.sin(
            self.expr(x, False) * math.pi * 2)

        # Index and counter accessors
        self.constants['N'] = lambda index='1': self.progress.count_nums[int(
            self.expr(index, False)) - 1]
        self.constants['I'] = lambda index='1': self.progress.indexes[int(
            self.expr(index, False)) - 1]
        self.constants['i'] = lambda index='1': (
            self.progress.indexes[int(self.expr(index, False)) - 1] /
            max(1, self.progress.count_nums[int(
                self.expr(index, False)) - 1] - 1)
        )

        # Time and progress
        self.constants['T'] = lambda: self.progress.time
        self.constants['S'] = lambda: self.progress.scrub
        self.constants['ST'] = lambda: self.progress.scrub_time

        # Canvas properties
        self.constants['H'] = lambda: self.pre_processing.height / \
            self.pre_processing.width
        self.constants['Hpx'] = lambda: self.pre_processing.height
        self.constants['Wpx'] = lambda: self.pre_processing.width
        self.constants['px'] = lambda i='1': (
            1 / self.pre_processing.width) * self.expr(i, False)

        # Curve properties
        self.constants['C'] = lambda: len(
            self.groups[-1]) if self.groups else 0
        self.constants['L'] = lambda: self.progress.letter
        self.constants['P'] = lambda: self.progress.point

        # Logical operations
        self.constants['!'] = lambda continuing: 0 if self.expr(
            continuing, False) else 1
        self.constants['or'] = lambda *args: self.expr(args[1], False) if self.expr(
            args[0], False) > 0 else self.expr(args[2], False)

        # Advanced functions
        self.constants['acc'] = self._accumulator
        self.constants['>'] = self._numeric_interpolate
        self.constants['choose'] = self._choose
        self.constants['~'] = self._noise_gen
        self.constants['tangent'] = self._tangent
        self.constants['hash'] = lambda x=None: self.hash(self.expr(x or 'C'))
        self.constants['peaks'] = self._peaks
        self.constants['table'] = lambda name, point, channel: self.table(
            str(name), point, channel)

        self.reserved_constants = list(self.constants.keys())

    def _accumulator(self, x: str) -> float:
        """
        Accumulator function - accumulates values over time

        Args:
            x: Expression to accumulate

        Returns:
            Current accumulated value
        """
        if self.progress.accum_index >= len(self.progress.accums):
            self.progress.accums.append(0.0)

        value = self.expr(x, False)
        # Correct for 60fps
        self.progress.accums[self.progress.accum_index] += value / 60
        current_accum = self.progress.accums[self.progress.accum_index]
        self.progress.accum_index += 1
        return current_accum

    def _numeric_interpolate(self, *args: str) -> float:
        """
        Numeric interpolation using the '>' operator

        Args:
            args: First arg is progress (0-1), rest are values to interpolate between

        Returns:
            Interpolated value
        """
        expr_fade = self.expr(args[0])

        # Clamp fade value
        if expr_fade >= 1:
            expr_fade = 0.999
        elif expr_fade < 0:
            expr_fade = 0

        expr_points = [self.expr(x, False) for x in args[1:]]
        index = (len(expr_points) - 1) * expr_fade

        floor_idx = math.floor(index)
        return lerp(
            expr_points[floor_idx],
            expr_points[min(floor_idx + 1, len(expr_points) - 1)],
            index % 1
        )

    def _choose(self, *args: str) -> float:
        """
        Choose function - select value from array by index

        Args:
            args: First arg is index, rest are values to choose from

        Returns:
            Selected value
        """
        index = math.floor(self.expr(args[0], False))
        saved_args = args[1:]

        if index < 0 or index >= len(saved_args):
            raise ValueError(
                f"Choose index out of range for args, {' '.join(args)}: {index}")

        return self.expr(saved_args[index])

    def _noise_gen(self, speed: str = '1', *freqs: str) -> float:
        """
        Noise generator function

        Args:
            speed: Speed of noise evolution
            freqs: Frequency points for noise generation

        Returns:
            Noise value (0-1)
        """
        sample_index = self.noise_index

        # Create noise function if needed
        while sample_index >= len(self.noise_table):
            if freqs:
                frequencies = [self.eval_point(
                    x, basic=True, default_y=1) for x in freqs]
            else:
                frequencies = [
                    BasicPt(random.random(), random.random()) for _ in range(3)]

            # Create closure with frequency copy
            freq_copy = frequencies.copy()
            self.noise_table.append(
                lambda x, f=freq_copy: self.noise(x, f) * 0.5 + 0.5)
            self.noise_values.append(0.0)

        # Update noise position
        value = self.expr(speed) / 60
        self.noise_values[self.noise_index] += value

        # Get noise value
        noise = self.noise_table[self.noise_index](
            self.noise_values[self.noise_index])
        self.noise_index += 1

        return noise

    def _tangent(self, progress: str, curve: Optional[str] = None) -> float:
        """
        Calculate tangent angle at point on curve

        Args:
            progress: Position along curve (0-1)
            curve: Optional curve index, defaults to current curve

        Returns:
            Normalized tangent angle (0-1)
        """
        # Get the curve to analyze
        last_curve: List[AsemicPt]
        if curve is None:
            last_curve = self.current_curve
        else:
            expr_n = self.expr(curve)
            index = int(expr_n)
            if expr_n < 0:
                index = len(self.groups[-1]) + index
            last_curve = self.groups[-1][index]  # type: ignore

        # Need at least 3 points for tangent
        if not last_curve or len(last_curve) < 3:
            return 0.0

        # Calculate position on curve
        expr_fade = self.expr(progress)
        if expr_fade >= 1:
            expr_fade = 0.999
        elif expr_fade < 0:
            expr_fade = 0

        index_float = (len(last_curve) - 2) * expr_fade
        start = math.floor(index_float)
        local_t = index_float % 1

        # Get control points for this segment
        p0: AsemicPt = last_curve[start]
        p1: AsemicPt = last_curve[start + 1]
        p2: AsemicPt = last_curve[start + 2]

        # Quadratic Bezier tangent: derivative of B(t) = (1-t)²P₀ + 2(1-t)tP₁ + t²P₂
        # B'(t) = 2(1-t)(P₁ - P₀) + 2t(P₂ - P₁)
        tangent_x = 2 * (1 - local_t) * (p1.x - p0.x) + \
            2 * local_t * (p2.x - p1.x)
        tangent_y = 2 * (1 - local_t) * (p1.y - p0.y) + \
            2 * local_t * (p2.y - p1.y)

        # Normalize the tangent vector
        magnitude = math.sqrt(tangent_x * tangent_x + tangent_y * tangent_y)
        if magnitude == 0:
            return 0.0

        normalized_tangent_x = tangent_x / magnitude
        normalized_tangent_y = tangent_y / magnitude

        # Calculate angle in radians and normalize to 0-1
        angle = math.atan2(normalized_tangent_y, normalized_tangent_x)
        normalized_angle = (angle + math.pi) / (2 * math.pi)

        return normalized_angle

    def _peaks(self, position: str, *peaks: str) -> float:
        """
        Peak function for position-based values

        Args:
            position: Current position
            peaks: Peak points with position and width

        Returns:
            Peak value (0-1)
        """
        values = [self.eval_point(p, basic=True, default_y=1) for p in peaks]
        pos = self.expr(position)

        for value in values:
            if abs(pos - value[0]) < value[1]:
                return 1 - abs(pos - value[0]) / value[1]

        return 0.0

    # Core methods

    def get_dynamic_value(self, value: Union[float, Callable[[], float]]) -> float:
        """Get value from either a static number or a callable"""
        return value() if callable(value) else value

    def error(self, text: str):
        """Add an error message to the output"""
        if text not in self.output.errors:
            self.output.errors.append(text)

    def reset(self, new_frame: bool = True):
        """
        Reset parser state for new frame or scene

        Args:
            new_frame: If True, advance to next frame
        """
        if new_frame:
            self.groups = []
            self.progress.time = time.time()
            self.progress.progress += 0 if self.pause_at is not False else ONE_FRAME

            if self.progress.progress >= self.total_length - ONE_FRAME:
                self.paused_at = []
                self.progress.progress = 0

            self.output = default_output()
            self.output.pauseAt = self.pause_at

        self.transform_stack = []
        self.last_point = AsemicPt(self, 0, 0)
        self.current_transform = default_transform()
        self.current_curve = []
        self.current_font = 'default'
        self.progress.point = 0
        self.progress.curve = 0

        for i in range(3):
            self.progress.indexes[i] = 0
            self.progress.count_nums[i] = 0

        self.noise_index = 0
        self.progress.accum_index = 0
        self.progress.seed = 1.0

    def draw(self):
        """
        Draw the current frame based on scene list and progress

        Iterates through scenes and executes draw functions for active scenes.
        Handles pause points and error catching.
        """
        self.reset()
        i = 0

        for obj in self.scene_list:
            # Check if this scene is active at current progress
            if (self.progress.progress >= obj.start and
                    self.progress.progress < obj.start + obj.length):

                self.reset(new_frame=False)
                self.progress.scrub = (
                    self.progress.progress - obj.start) / obj.length
                self.progress.scrub_time = self.progress.progress - obj.start

                try:
                    # Run setup if not yet done
                    if not obj.is_setup:
                        if obj.setup:
                            obj.setup()
                        obj.is_setup = True
                    # Execute scene draw function
                    obj.draw()
                except Exception as e:
                    import traceback
                    tb = traceback.format_exc().split('\n')
                    tb_line = tb[1] if len(tb) > 1 else ''
                    self.error(f"Scene {i} failed: {str(e)} {tb_line}")

                i += 1

                # Check for pause point in this scene
                if (self.pause_at is False and
                    obj.pause is not False and
                        self.progress.progress >= obj.start + obj.pause):

                    pause = f"{obj.start + obj.pause:.5f}"
                    if pause not in self.paused_at:
                        self.pause_at = pause
                        break

    def debug(self, slice_val: int = 0) -> str:
        """
        Generate debug output for curves

        Args:
            slice_val: Starting index for curve slice

        Returns:
            Formatted string of curve points
        """
        def to_fixed(x: float) -> str:
            return f"{x:.2f}"

        # Flatten all curves - groups is List[List[AsemicPt]]
        all_curves: List[List[AsemicPt]] = self.groups.copy()
        all_curves.append(self.current_curve)

        # Format curves as strings
        c = '\n'.join([
            f"[{' '.join([f'{to_fixed(pt.x)},{to_fixed(pt.y)}' for pt in curve])}]"
            for curve in all_curves[slice_val:]
        ])
        self.output.errors.append(c)
        return c

    def log(self, label: str, callback: Callable[[], Any]) -> 'Parser':
        """
        Log a labeled value (for debugging)

        Args:
            label: Label for the log output
            callback: Function that returns value to log

        Returns:
            self for chaining
        """
        print(label, callback())
        return self

    def set(self, **settings) -> 'Parser':
        """
        Update parser settings

        Args:
            **settings: Keyword arguments matching Settings fields

        Returns:
            self for chaining
        """
        for key, value in settings.items():
            if hasattr(self.settings, key):
                setattr(self.settings, key, value)
        return self

    def setup(self, source: str):
        """
        Setup parser with source code

        Args:
            source: Asemic source code to parse
        """
        self.progress.seed = random.random()
        self.fonts = {}  # Would initialize with default font
        self.total_length = 0.0

        self.settings = default_settings()
        self.scene_list = []
        self.raw_source = source

        for font in self.fonts:
            self.reset_font(font)

        self.output.resetParams = True
        self.output.resetPresets = True

        try:
            self.parse(source)
        except Exception as e:
            print(f"Setup error: {e}")
            self.output.errors.append(f"Setup failed: {str(e)}")

    def hash(self, n: float) -> float:
        """
        Hash function for pseudo-random values based on seed

        Args:
            n: Input value to hash

        Returns:
            Hash value (0-1)
        """
        val = math.sin(n * (43758.5453123 + self.progress.seed))
        return abs(val - math.floor(val))

    def seed(self, seed_val: Union[float, str, None] = None) -> 'Parser':
        """
        Set random seed for reproducible randomness

        Args:
            seed_val: Seed value or expression

        Returns:
            self for chaining
        """
        if seed_val:
            if isinstance(seed_val, (int, float)):
                new_seed = float(seed_val)
            else:
                new_seed = self.expr(str(seed_val))
        else:
            new_seed = random.random()
        self.progress.seed = new_seed
        return self

    def clone_transform(self, transform: Transform) -> Transform:
        """Clone a transform object"""
        return clone_transform(transform)

    @property
    def duration(self) -> float:
        """Get total animation duration"""
        return self.total_length

    # Placeholder methods (would be implemented in separate method modules)

    def expr(self, expression: str, evaluate: bool = True) -> float:
        """
        Evaluate an expression

        Args:
            expression: String expression to evaluate
            evaluate: Whether to evaluate or just parse

        Returns:
            Numeric result of expression
        """
        if not expression or expression.strip() == '':
            return 0.0

        expression = expression.strip()

        # Try direct numeric conversion first
        try:
            return float(expression)
        except ValueError:
            pass

        # Parse and evaluate the expression
        try:
            return self._eval_expr(expression)
        except Exception as e:
            self.error(f"Expression error in '{expression}': {str(e)}")
            return 0.0

    def _tokenize_expr(self, expr: str) -> List[str]:
        """
        Tokenize an expression into operators, numbers, and identifiers

        Args:
            expr: Expression string to tokenize

        Returns:
            List of tokens
        """
        tokens = []
        i = 0
        expr = expr.strip()

        while i < len(expr):
            # Skip whitespace
            if expr[i].isspace():
                i += 1
                continue

            # Numbers (including decimals and negatives)
            if expr[i].isdigit() or (expr[i] == '.' and i + 1 < len(expr) and expr[i + 1].isdigit()):
                start = i
                has_dot = False
                while i < len(expr) and (expr[i].isdigit() or (expr[i] == '.' and not has_dot)):
                    if expr[i] == '.':
                        has_dot = True
                    i += 1
                tokens.append(expr[start:i])
                continue

            # Identifiers and function names
            if expr[i].isalpha() or expr[i] == '_':
                start = i
                while i < len(expr) and (expr[i].isalnum() or expr[i] == '_'):
                    i += 1
                tokens.append(expr[start:i])
                continue

            # Multi-character operators
            if i + 1 < len(expr):
                two_char = expr[i:i+2]
                if two_char in ['==', '!=', '<=', '>=', '&&', '||', '**']:
                    tokens.append(two_char)
                    i += 2
                    continue

            # Single character operators and punctuation
            if expr[i] in '+-*/^(),%<>!~':
                tokens.append(expr[i])
                i += 1
                continue

            # Unknown character, skip it
            i += 1

        return tokens

    def _eval_expr(self, expr: str) -> float:
        """
        Evaluate a tokenized expression using recursive descent parsing

        Args:
            expr: Expression string

        Returns:
            Evaluated numeric result
        """
        tokens = self._tokenize_expr(expr)
        if not tokens:
            return 0.0

        self._token_pos = 0
        self._tokens = tokens

        result = self._parse_comparison()
        return result

    def _current_token(self) -> Optional[str]:
        """Get current token without consuming it"""
        if self._token_pos < len(self._tokens):
            return self._tokens[self._token_pos]
        return None

    def _consume_token(self) -> Optional[str]:
        """Consume and return current token"""
        if self._token_pos < len(self._tokens):
            token = self._tokens[self._token_pos]
            self._token_pos += 1
            return token
        return None

    def _parse_comparison(self) -> float:
        """Parse comparison operators (==, !=, <, >, <=, >=)"""
        left = self._parse_additive()

        while self._current_token() in ['<', '>', '<=', '>=', '==', '!=']:
            op = self._consume_token()
            right = self._parse_additive()

            if op == '<':
                left = 1.0 if left < right else 0.0
            elif op == '>':
                left = 1.0 if left > right else 0.0
            elif op == '<=':
                left = 1.0 if left <= right else 0.0
            elif op == '>=':
                left = 1.0 if left >= right else 0.0
            elif op == '==':
                left = 1.0 if abs(left - right) < 1e-10 else 0.0
            elif op == '!=':
                left = 1.0 if abs(left - right) >= 1e-10 else 0.0

        return left

    def _parse_additive(self) -> float:
        """Parse addition and subtraction"""
        left = self._parse_multiplicative()

        while self._current_token() in ['+', '-']:
            op = self._consume_token()
            right = self._parse_multiplicative()

            if op == '+':
                left = left + right
            elif op == '-':
                left = left - right

        return left

    def _parse_multiplicative(self) -> float:
        """Parse multiplication, division, and modulo"""
        left = self._parse_power()

        while self._current_token() in ['*', '/', '%']:
            op = self._consume_token()
            right = self._parse_power()

            if op == '*':
                left = left * right
            elif op == '/':
                if right != 0:
                    left = left / right
                else:
                    self.error("Division by zero")
                    left = 0.0
            elif op == '%':
                if right != 0:
                    left = left % right
                else:
                    self.error("Modulo by zero")
                    left = 0.0

        return left

    def _parse_power(self) -> float:
        """Parse exponentiation (^)"""
        left = self._parse_unary()

        if self._current_token() in ['^', '**']:
            self._consume_token()
            right = self._parse_power()  # Right associative
            left = left ** right

        return left

    def _parse_unary(self) -> float:
        """Parse unary operators (-, +, !)"""
        token = self._current_token()

        if token == '-':
            self._consume_token()
            return -self._parse_unary()
        elif token == '+':
            self._consume_token()
            return self._parse_unary()
        elif token == '!':
            self._consume_token()
            value = self._parse_unary()
            return 1.0 if value == 0.0 else 0.0

        return self._parse_primary()

    def _parse_primary(self) -> float:
        """Parse primary expressions (numbers, identifiers, function calls, parentheses)"""
        token = self._current_token()

        if token is None:
            return 0.0

        # Parentheses
        if token == '(':
            self._consume_token()
            result = self._parse_comparison()
            if self._current_token() == ')':
                self._consume_token()
            return result

        # Numbers
        try:
            value = float(token)
            self._consume_token()
            return value
        except ValueError:
            pass

        # Identifiers and function calls
        if token.replace('_', '').isalnum():
            identifier = self._consume_token()

            if identifier is None:
                return 0.0

            # Check if it's a function call
            if self._current_token() == '(':
                return self._parse_function_call(identifier)

            # Check if it's a constant
            if identifier in self.constants:
                const_func = self.constants[identifier]
                # Call with no arguments if it's a zero-arg function
                try:
                    return const_func()
                except TypeError:
                    # Function requires arguments, return 0
                    return 0.0

            # Check if it's a parameter
            if identifier in self.params:
                param_value = self.params[identifier]
                if isinstance(param_value, (int, float)):
                    return float(param_value)
                elif callable(param_value):
                    result = param_value()
                    return float(result) if isinstance(result, (int, float)) else 0.0

            # Unknown identifier
            return 0.0

        # Unknown token
        self._consume_token()
        return 0.0

    def _parse_function_call(self, func_name: str) -> float:
        """
        Parse a function call with arguments

        Args:
            func_name: Name of the function

        Returns:
            Result of function call
        """
        self._consume_token()  # consume '('

        args = []

        # Parse arguments
        if self._current_token() != ')':
            while True:
                # Parse each argument as a sub-expression
                arg_tokens = []
                paren_depth = 0

                while self._current_token() is not None:
                    token = self._current_token()

                    if token == '(':
                        paren_depth += 1
                        arg_tokens.append(self._consume_token())
                    elif token == ')':
                        if paren_depth == 0:
                            break
                        paren_depth -= 1
                        arg_tokens.append(self._consume_token())
                    elif token == ',' and paren_depth == 0:
                        break
                    else:
                        arg_tokens.append(self._consume_token())

                # Evaluate the argument
                if arg_tokens:
                    arg_expr = ' '.join(arg_tokens)
                    args.append(arg_expr)

                if self._current_token() == ',':
                    self._consume_token()
                else:
                    break

        if self._current_token() == ')':
            self._consume_token()

        # Call the function
        if func_name in self.constants:
            try:
                func = self.constants[func_name]
                return func(*args)
            except Exception as e:
                self.error(f"Error calling function '{func_name}': {str(e)}")
                return 0.0

        return 0.0

    def eval_point(self, expr: str, basic: bool = False, default_y: float = 0.0) -> BasicPt:
        """
        Evaluate a point expression

        Args:
            expr: Point expression string (e.g., "0.5 0.5" or "0.5" or ">(...)")
            basic: If True, return BasicPt instead of AsemicPt
            default_y: Default y value if not specified

        Returns:
            Evaluated point
        """
        if not expr or expr.strip() == '':
            return BasicPt(0, default_y)

        expr = expr.strip()

        # Check if it's a point constant function (like '>')
        for const_name, const_func in self.point_constants.items():
            if expr.startswith(const_name):
                # Extract arguments from parentheses or space-separated
                rest = expr[len(const_name):].strip()
                if rest.startswith('(') and rest.endswith(')'):
                    args_str = rest[1:-1]
                    args = [arg.strip() for arg in self._split_args(args_str)]
                    try:
                        result = const_func(*args)
                        return result if isinstance(result, BasicPt) else BasicPt(0, default_y)
                    except Exception as e:
                        self.error(
                            f"Error in point constant '{const_name}': {str(e)}")
                        return BasicPt(0, default_y)

        # Split by whitespace to get x and y values
        parts = expr.split()

        if len(parts) == 0:
            return BasicPt(0, default_y)
        elif len(parts) == 1:
            # Single value - use as x, default_y as y
            x = self.expr(parts[0])
            return BasicPt(x, default_y)
        else:
            # Two or more values - use first two as x, y
            x = self.expr(parts[0])
            y = self.expr(parts[1])
            return BasicPt(x, y)

    def _split_args(self, args_str: str) -> List[str]:
        """
        Split function arguments by comma, respecting parentheses

        Args:
            args_str: String of comma-separated arguments

        Returns:
            List of argument strings
        """
        args = []
        current_arg = []
        paren_depth = 0

        for char in args_str:
            if char == '(' or char == '[':
                paren_depth += 1
                current_arg.append(char)
            elif char == ')' or char == ']':
                paren_depth -= 1
                current_arg.append(char)
            elif char == ',' and paren_depth == 0:
                if current_arg:
                    args.append(''.join(current_arg).strip())
                    current_arg = []
            else:
                current_arg.append(char)

        if current_arg:
            args.append(''.join(current_arg).strip())

        return args

    def parse(self, source: str):
        """
        Parse Asemic source code and create scenes

        Args:
            source: Source code to parse

        The parser handles:
        - Scene definitions: # or \n#
        - Scene settings: {length=5 offset=0}
        - Drawing code within scenes
        """
        # Split by scene markers
        scenes = source.split('\n#')
        scene_list = []

        for scene_text in scenes:
            scene_text = scene_text.strip()
            if not scene_text:
                continue

            # Split first line (settings) from rest (drawing code)
            lines = scene_text.split('\n', 1)
            first_line = lines[0] if lines else ''
            rest = lines[1] if len(lines) > 1 else ''

            # Create scene settings
            scene_settings = {
                'draw': lambda code=rest: self.text(code)
            }

            # Parse scene settings from first line {length=5 offset=0}
            settings_match = re.search(r'\{(.+?)\}', first_line)
            if settings_match:
                settings_str = settings_match.group(1)
                for setting in self.tokenize(settings_str):
                    if '=' not in setting:
                        continue
                    key, value = setting.split('=', 1)
                    key = key.strip()
                    try:
                        scene_settings[key] = self.expr(  # type: ignore
                            value.strip())
                    except:
                        scene_settings[key] = value.strip()  # type: ignore

            scene_list.append(scene_settings)

        # Create scenes
        if scene_list:
            self.scene(*scene_list)

        return self

    def tokenize(self, text: str, separate_points: bool = False) -> List[str]:
        """
        Tokenize text into components

        Args:
            text: Text to tokenize
            separate_points: Whether to separate point syntax (split on spaces only, not commas)

        Returns:
            List of tokens
        """
        # Simple tokenization:
        # - separate_points=False: split on whitespace and commas (default)
        # - separate_points=True: split on whitespace only (preserve commas in point notation)
        tokens = []
        current = []

        for char in text:
            if separate_points:
                # Only split on whitespace, keep commas
                if char in ' \t\n':
                    if current:
                        tokens.append(''.join(current))
                        current = []
                else:
                    current.append(char)
            else:
                # Split on both whitespace and commas
                if char in ' \t\n,':
                    if current:
                        tokens.append(''.join(current))
                        current = []
                else:
                    current.append(char)

        if current:
            tokens.append(''.join(current))

        return tokens

    def parse_point(self, coord: str) -> Tuple[float, float]:
        """
        Parse a point coordinate string

        Args:
            coord: Coordinate string

        Returns:
            Tuple of (x, y) values
        """
        pt = self.eval_point(coord, basic=True)
        return (pt.x, pt.y)

    def reset_font(self, font_name: str):
        """Reset font to default state"""
        if font_name in self.fonts:
            self.fonts[font_name] = {}

    def table(self, name: str, point: str, channel: str = 'brightness') -> float:
        """
        Look up a pixel value from a loaded image

        Args:
            name: The name of the loaded image
            point: Coordinate expression to evaluate
            channel: Which channel to return: 'r', 'g', 'b', 'a', or 'brightness'

        Returns:
            Normalized pixel value (0-1)
        """
        pt = self.eval_point(point, basic=True)
        x, y = pt.x, pt.y

        # Get resolved name with folder
        resolved_name = self.resolve_name(name)

        # Try to get from images cache
        bitmaps = self.images.get(resolved_name)
        if not bitmaps:
            self.error(f"Data is not available for {resolved_name}")
            return 0.0

        # Use progress or time to select frame for videos
        frame_index = 0
        if len(bitmaps) > 1:
            frame_index = int(self.progress.scrub_time * 60) % len(bitmaps)

        bitmap = bitmaps[frame_index]

        # Normalize coordinates and get pixel
        normalized_x = max(0, min(1, x))
        normalized_y = max(0, min(1, y))

        # Access pixel data (assuming bitmap has width, height, and data attributes)
        if hasattr(bitmap, 'width') and hasattr(bitmap, 'height') and hasattr(bitmap, 'data'):
            pixel_x = int(normalized_x * (bitmap.width - 1))
            pixel_y = int(normalized_y * (bitmap.height - 1))

            start = pixel_y * bitmap.width * 4 + pixel_x * 4
            r = bitmap.data[start] / 255.0
            g = bitmap.data[start + 1] / 255.0
            b = bitmap.data[start + 2] / 255.0
            a = bitmap.data[start + 3] / 255.0

            if channel == 'r':
                return r
            elif channel == 'g':
                return g
            elif channel == 'b':
                return b
            elif channel == 'a':
                return a
            else:  # brightness or default
                return (0.299 * r + 0.587 * g + 0.114 * b) * a

        return 0.0

    def resolve_name(self, name: str) -> str:
        """
        Resolve a file name with the current folder setting

        Args:
            name: File name to resolve

        Returns:
            Full path with folder prefix
        """
        folder = self.settings.folder
        if folder and not folder.endswith('/'):
            folder += '/'
        return folder + name

    def load_files(self, files: Dict[str, List[Any]]):
        """
        Load multiple files into the image store

        Args:
            files: Dictionary of filename to image data arrays

        Returns:
            self for chaining
        """
        self.images.update(files)
        return self

    def noise(self, x: float, frequencies: List[BasicPt]) -> float:
        """
        Generate noise value using sum of cosines

        Args:
            x: Input value
            frequencies: Frequency points for noise generation

        Returns:
            Noise value (-1 to 1)
        """
        if not frequencies:
            return 0.0

        sum_val = 0.0
        for i, freq in enumerate(frequencies):
            offset = freq.y if freq.y != 1.0 else self.hash(i + 10)
            sum_val += math.cos(freq.x * (i + 1) * (x + offset)) / (i + 1)

        # Normalize by sum of 1/i series
        normalizer = sum(1.0 / (i + 1) for i in range(len(frequencies)))
        return sum_val / normalizer

    def play(self, play_value: Union[bool, Dict]):
        """
        Play/pause control

        Args:
            play_value: True to play, False to pause, or dict with scene number
        """
        if isinstance(play_value, bool):
            if play_value and self.pause_at and isinstance(self.pause_at, str):
                # Resume from pause
                self.paused_at.append(self.pause_at)
                self.pause_at = False
        elif isinstance(play_value, dict) and 'scene' in play_value:
            scene_num = play_value['scene']
            if 0 <= scene_num < len(self.scene_list):
                # Reset and jump to scene
                self.reset()
                self.setup(self.raw_source)

                # Setup all scenes before target
                for i in range(scene_num):
                    try:
                        setup_func = self.scene_list[i].setup
                        if setup_func is not None:
                            setup_func()
                        self.scene_list[i].is_setup = True
                    except Exception as e:
                        self.error(f"Error in scene {i}: {str(e)}")

                self.mode = 'normal'
                self.progress.progress = self.scene_list[scene_num].start + \
                    self.scene_list[scene_num].offset

                # Clean up paused_at list
                fixed_progress = f"{self.progress.progress:.5f}"
                self.paused_at = [
                    x for x in self.paused_at if x <= fixed_progress]
                self.pause_at = False

    def scrub(self, position: float):
        """
        Scrub to specific timeline position

        Args:
            position: Timeline position to jump to
        """
        # Clamp progress to valid range
        position = max(0, min(position, self.total_length))

        # Reset and set the progress directly
        self.reset()
        self.progress.progress = position

    def scene(self, *scenes):
        """
        Define one or more scenes

        Args:
            *scenes: Scene definitions with draw, setup, length, offset, pause

        Returns:
            self for chaining
        """
        for scene_def in scenes:
            if callable(scene_def):
                # Simple function, use defaults
                draw_func = scene_def
                setup_func = None
                length = 0.1
                offset = 0.0
                pause = False
            elif isinstance(scene_def, dict):
                # Dict with options
                draw_func = scene_def.get('draw', lambda: None)
                setup_func = scene_def.get('setup')
                length = scene_def.get('length', 0.1)
                offset = scene_def.get('offset', 0.0)
                pause = scene_def.get('pause', False)
            else:
                continue

            self.scene_list.append(SceneItem(
                draw=draw_func,  # type: ignore
                setup=setup_func,
                is_setup=False,
                start=self.total_length,
                length=length,
                offset=offset,
                pause=pause
            ))
            self.total_length += length - offset

        return self

    def param(self, param_name: str, value: Optional[float] = None,
              min_val: float = 0.0, max_val: float = 1.0, exponent: float = 1.0):
        """
        Define a parameter

        Args:
            param_name: Name of the parameter
            value: Default value
            min_val: Minimum value
            max_val: Maximum value
            exponent: Exponent for scaling

        Returns:
            self for chaining
        """
        # If parameter exists, keep its current value
        if param_name in self.params:
            current_value = self.params[param_name].get('value', 0.0)
        else:
            current_value = self.expr(str(value)) if value is not None else 0.0

        self.params[param_name] = {
            'type': 'number',
            'value': current_value,
            'min': self.expr(str(min_val)),
            'max': self.expr(str(max_val)),
            'exponent': self.expr(str(exponent))
        }

        # Add to output
        if not hasattr(self.output, 'params') or self.output.params is None:
            self.output.params = {}
        self.output.params[param_name] = self.params[param_name]

        # Add as constant
        self.constants[param_name] = lambda: self.params[param_name]['value']

        return self

    def preset(self, preset_name: str, values: str):
        """
        Define a preset with parameter values

        Args:
            preset_name: Name of the preset
            values: String of param=value pairs

        Returns:
            self for chaining
        """
        tokens = self.tokenize(values)

        if preset_name not in self.presets:
            self.presets[preset_name] = {}

        for token in tokens:
            if '=' not in token:
                continue

            param_name, value_str = token.split('=', 1)
            param_name = param_name.strip()
            value_str = value_str.strip()

            if param_name not in self.params:
                self.error(
                    f"Parameter '{param_name}' must be defined before creating preset")
                continue

            self.presets[preset_name][param_name] = {
                **self.params[param_name],
                'value': self.expr(value_str)
            }

        # Add to output
        if not hasattr(self.output, 'presets') or self.output.presets is None:
            self.output.presets = {}
        self.output.presets[preset_name] = self.presets[preset_name]

        return self

    def to_preset(self, preset_name: str, amount: Union[str, float] = 1.0):
        """
        Interpolate current parameters toward a preset

        Args:
            preset_name: Name of the preset to interpolate toward
            amount: Amount to interpolate (0-1)

        Returns:
            self for chaining
        """
        if preset_name not in self.presets:
            self.error(f"Preset '{preset_name}' not found")
            return self

        lerp_amount = self.expr(str(amount)) if isinstance(
            amount, str) else amount

        for param_name in self.presets[preset_name]:
            if param_name not in self.params:
                self.error(
                    f"Parameter '{param_name}' not found for preset '{preset_name}'")
                continue

            target_value = self.presets[preset_name][param_name]['value']
            current_value = self.params[param_name]['value']
            self.params[param_name]['value'] = current_value + \
                (target_value - current_value) * lerp_amount

        return self

    # Utility methods

    def repeat(self, count: str, callback: Union[Callable, str]):
        """
        Repeat a callback for nested loops

        Args:
            count: Count expression (e.g., "5" or "3 4" for nested loops)
            callback: Function or text to execute

        Returns:
            self for chaining
        """
        counts = [int(self.expr(x))
                  for x in self.tokenize(count, separate_points=True)]

        # Ensure indexes and count_nums are large enough
        while len(self.progress.indexes) < len(counts):
            self.progress.indexes.append(0)
        while len(self.progress.count_nums) < len(counts):
            self.progress.count_nums.append(0)

        def iterate(index: int):
            prev_index = self.progress.indexes[index]
            prev_count_num = self.progress.count_nums[index]
            self.progress.count_nums[index] = counts[index]

            for i in range(self.progress.count_nums[index]):
                self.progress.indexes[index] = i

                # Only call callback if we're at the deepest level
                if index + 1 < len(counts):
                    # There are more nesting levels, recurse
                    iterate(index + 1)
                else:
                    # We're at the innermost level, call the callback
                    if callable(callback):
                        callback()
                    else:
                        self.text(callback)

            self.progress.indexes[index] = prev_index
            self.progress.count_nums[index] = prev_count_num

        iterate(0)
        return self

    def get_bounds(self, from_curve: int = 0, to_curve: Optional[int] = None) -> Tuple[float, float, float, float]:
        """
        Get bounding box of curves

        Args:
            from_curve: Starting curve index
            to_curve: Ending curve index (None = all)

        Returns:
            Tuple of (minX, minY, maxX, maxY)
        """
        min_x = min_y = max_x = max_y = None

        if not self.groups:
            return (0.0, 0.0, 0.0, 0.0)

        last_group = self.groups[-1]
        curves_slice = last_group[from_curve:to_curve]

        for curve in curves_slice:
            # Each curve is a List[AsemicPt]
            curve_points: List[AsemicPt] = curve  # type: ignore
            for pt in curve_points:
                if min_x is None or pt.x < min_x:
                    min_x = pt.x
                if max_x is None or pt.x > max_x:
                    max_x = pt.x
                if min_y is None or pt.y < min_y:
                    min_y = pt.y
                if max_y is None or pt.y > max_y:
                    max_y = pt.y

        return (min_x or 0.0, min_y or 0.0, max_x or 0.0, max_y or 0.0)

    def within(self, points: str, callback: Callable):
        """
        Scale content to fit within bounds

        Args:
            points: Two points defining the bounding box
            callback: Function to execute

        Returns:
            self for chaining
        """
        tokens = self.tokenize(points)
        if len(tokens) < 2:
            return self

        x, y = self.parse_point(tokens[0])
        x2, y2 = self.parse_point(tokens[1])

        start_group = len(self.groups)
        callback()

        min_x, min_y, max_x, max_y = self.get_bounds(start_group)

        new_width = x2 - x
        new_height = y2 - y
        old_width = max_x - min_x
        old_height = max_y - min_y

        scale_x = new_width / (old_width or 1)
        scale_y = new_height / (old_height or 1)

        # Transform all curves in range
        for i in range(start_group, len(self.groups)):
            for curve in self.groups[i]:
                curve_points: List[AsemicPt] = curve  # type: ignore
                for pt in curve_points:
                    pt.x = x + (pt.x - min_x) * scale_x
                    pt.y = y + (pt.y - min_y) * scale_y

        # Transform current curve if it exists
        if self.current_curve:
            for pt in self.current_curve:
                pt.x = x + (pt.x - min_x) * scale_x
                pt.y = y + (pt.y - min_y) * scale_y

        return self

    def align(self, coords: str, align_type: str, callback: Union[str, Callable]):
        """
        Align content relative to a center point

        Args:
            coords: Center point coordinates
            align_type: Alignment type as point (e.g., "0.5 0.5" for center)
            callback: Function or text to execute

        Returns:
            self for chaining
        """
        center_x, center_y = self.parse_point(coords)
        align_pt = self.eval_point(align_type, basic=True)
        align_x, align_y = align_pt.x, align_pt.y

        # Ensure we have a group
        if not self.groups:
            self.group()

        last_group = self.groups[-1]
        start_curve = len(last_group)

        # Execute callback
        if isinstance(callback, str):
            self.text(callback)
        else:
            callback()

        # Get added curves
        added_curves = last_group[start_curve:]

        # Get bounds of added content
        min_x, min_y, max_x, max_y = self.get_bounds(start_curve)

        # Calculate alignment offset
        change_x = (max_x - min_x) * align_x
        change_y = (max_y - min_y) * align_y

        # Apply transformation
        for curve in added_curves:
            curve_points: List[AsemicPt] = curve  # type: ignore
            for pt in curve_points:
                pt.x = pt.x - min_x + center_x - change_x
                pt.y = pt.y - min_y + center_y - change_y

        return self

    def test(self, condition: Union[str, float],
             callback: Optional[Callable] = None,
             callback2: Optional[Callable] = None):
        """
        Conditional execution

        Args:
            condition: Condition to test
            callback: Function to call if true
            callback2: Function to call if false

        Returns:
            self for chaining
        """
        expr_condition = self.expr(str(condition)) if isinstance(
            condition, str) else condition

        if expr_condition:
            if callback:
                callback()
        else:
            if callback2:
                callback2()

        return self

    def group(self, **kwargs):
        """
        Create a new group (placeholder for full implementation)

        Returns:
            self for chaining
        """
        # This would create a new curve group with specified parameters
        # For now, just ensure groups list exists
        if not self.groups:
            self.groups.append([])
        else:
            self.groups.append([])
        return self

    # Helper methods for drawing and parsing

    def end(self):
        """End the current curve and add it to the current group"""
        if not self.current_curve:
            return self

        # If curve only has 2 points, interpolate a middle point
        if len(self.current_curve) == 2:
            self.progress.point = 0.5
            p1 = self.current_curve[0]
            p2 = self.current_curve[1]
            interpolated = AsemicPt(self, p1.x, p1.y)
            interpolated.lerp(p2, 0.5)
            self.current_curve.insert(1, interpolated)

        # Ensure we have a group to add to
        if not self.groups:
            self.groups.append([])

        # Add curve to current group
        self.groups[-1].append(self.current_curve)  # type: ignore

        # Reset for next curve
        self.current_curve = []
        self.progress.point = 0.0
        self.adding = 0

        return self

    def points(self, token: str):
        """Add multiple points from a token string to the current curve"""
        # Use separate_points to preserve commas in point coordinates
        point_tokens = self.tokenize(token, separate_points=True)

        # Count non-transform tokens
        total_length = sum(1 for t in point_tokens if not t.startswith('{'))
        if total_length == 0:
            total_length = 1

        original_end = self.adding
        self.adding += total_length

        for i, point_token in enumerate(point_tokens):
            if point_token.startswith('{') and point_token.endswith('}'):
                # Transform token
                self.to(point_token[1:-1])
            else:
                # Point token
                self.progress.point = (original_end + i) / self.adding
                point = self.parse_point_advanced(point_token)
                self.current_curve.append(point)

        return self

    def parse_point_advanced(self, notation: str) -> AsemicPt:
        """Advanced point parser supporting various notations"""
        # Relative coordinates: +x,y
        if notation.startswith('+'):
            point = self.eval_point(notation[1:], basic=False)
            return self.apply_transform(point)  # type: ignore

        # Polar coordinates: @angle,radius
        elif notation.startswith('@'):
            parts = self.tokenize(notation[1:], separate_points=True)
            theta = self.expr(parts[0])
            radius = self.expr(parts[1]) if len(parts) > 1 else 1.0
            point = AsemicPt(self, radius, 0.0)
            point.rotate(theta)
            return self.apply_transform(point)

        # Regular point parsing
        else:
            # Split on comma to get x,y coordinates
            if ',' in notation:
                parts = notation.split(',')
                x = self.expr(parts[0])
                y = self.expr(parts[1]) if len(parts) > 1 else x
                point = AsemicPt(self, x, y)
            else:
                # Single value - use for both x and y
                coord = self.expr(notation)
                point = AsemicPt(self, coord, coord)

            return self.apply_transform(point)

    def parse_args(self, args: List[str]) -> Tuple[AsemicPt, AsemicPt, float, float]:
        """Parse standard drawing arguments (start, end, height, width)"""
        # Parse start and end points
        self.progress.point = 0.0
        start_point = self.parse_point_advanced(args[0])
        self.progress.point = 1.0
        end_point = self.parse_point_advanced(args[1])

        # Reverse transform to get local coordinates
        start_point = self.reverse_transform(start_point)
        end_point = self.reverse_transform(end_point)

        # Parse height and width if provided
        h = 0.0
        w = 0.0
        if len(args) >= 3:
            # Split on comma to get height and width
            if ',' in args[2]:
                hw_parts = args[2].split(',')
                h = self.expr(hw_parts[0])
                w = self.expr(hw_parts[1]) if len(hw_parts) > 1 else 0.0
            else:
                h = self.expr(args[2])
                w = 0.0

        return start_point, end_point, h, w

    def apply_transform(self, point: AsemicPt, relative: bool = False) -> AsemicPt:
        """Apply current transform to a point"""
        # Apply scale
        point.scale([self.current_transform.scale.x,
                    self.current_transform.scale.y])

        # Apply rotation
        if self.current_transform.rotation != 0:
            point.rotate(self.current_transform.rotation)

        # Apply translation (unless relative)
        if not relative:
            point.add(self.current_transform.translation)

        return point

    def reverse_transform(self, point: AsemicPt) -> AsemicPt:
        """Reverse current transform on a point"""
        # Reverse translation
        point.subtract(self.current_transform.translation)

        # Reverse rotation
        if self.current_transform.rotation != 0:
            point.rotate(-self.current_transform.rotation)

        # Reverse scale
        if self.current_transform.scale.x != 0 and self.current_transform.scale.y != 0:
            point.scale([1.0 / self.current_transform.scale.x,
                        1.0 / self.current_transform.scale.y])

        return point

    def to(self, token: str):
        """Apply transformation to current transform state"""
        # Parse transform tokens - use separate_points to preserve commas in coordinates
        tokens = self.tokenize(token, separate_points=True)

        for transform in tokens:
            if not transform:
                continue

            first_char = transform[0]
            rest = transform[1:]

            # Handle transform operations
            if first_char == '*':
                # Scale - split on comma to get x,y
                if ',' in rest:
                    parts = rest.split(',')
                    self.current_transform.scale.x = self.expr(parts[0])
                    self.current_transform.scale.y = self.expr(parts[1]) if len(
                        parts) > 1 else self.current_transform.scale.x
                else:
                    scale = self.expr(rest)
                    self.current_transform.scale.x = scale
                    self.current_transform.scale.y = scale

            elif first_char == '+':
                # Translation - split on comma to get x,y
                if ',' in rest:
                    parts = rest.split(',')
                    self.current_transform.translation.x = self.expr(parts[0])
                    self.current_transform.translation.y = self.expr(
                        parts[1]) if len(parts) > 1 else 0.0
                else:
                    self.current_transform.translation.x = self.expr(rest)
                    self.current_transform.translation.y = 0.0

            elif first_char == '@':
                # Rotation
                self.current_transform.rotation = self.expr(rest)

            elif first_char == '!':
                # Reset transform
                self.current_transform = default_transform()

        return self

    # Drawing methods

    def map_curve(self, multiply_points: List[AsemicPt], add_points: List[AsemicPt],
                  start: AsemicPt, end: AsemicPt, add: bool = False):
        """Map a curve between two points with transformations"""
        # Calculate angle and distance between start and end
        angle = end.clone().subtract(start).angle0to1()
        distance = end.clone().subtract(start).magnitude()

        # Transform points
        previous_length = self.adding
        self.adding += len(multiply_points) + 2

        transformed_points = []
        for i, pt in enumerate(multiply_points):
            self.progress.point = (previous_length + 1 + i) / self.adding

            # Clone and transform
            new_pt = AsemicPt(self, pt.x, pt.y)
            new_pt.scale([distance, 1.0])
            new_pt.add(add_points[i])
            new_pt.rotate(angle)
            new_pt.add(start)

            # Apply current transform
            self.apply_transform(new_pt, relative=False)
            transformed_points.append(new_pt)

        # Build curve
        mapped_curve = [start] + transformed_points + \
            ([end] if not add else [])

        # Add to current curve
        self.current_curve.extend(mapped_curve)

        if not add:
            self.end()

    def tri(self, args_str: str, add: bool = False):
        """Draw a triangle"""
        args = self.tokenize(args_str)
        start, end, h, w = self.parse_args(args)

        points = [AsemicPt(self, 0.5, h * 2)]
        base_points = [AsemicPt(self, 0.0, 0.0)]

        self.map_curve(points, base_points, start, end, add)
        return self

    def squ(self, args_str: str, add: bool = False):
        """Draw a square/rectangle"""
        args = self.tokenize(args_str)
        start, end, h, w = self.parse_args(args)

        points = [
            AsemicPt(self, 0.0, h),
            AsemicPt(self, 1.0, h)
        ]
        base_points = [
            AsemicPt(self, -w, 0.0),
            AsemicPt(self, w, 0.0)
        ]

        self.map_curve(points, base_points, start, end, add)
        return self

    def pen(self, args_str: str, add: bool = False):
        """Draw a pentagon-like shape"""
        args = self.tokenize(args_str)
        start, end, h, w = self.parse_args(args)

        h05 = h * 0.5
        h11 = h * 1.1
        w2 = w * 2

        points = [
            AsemicPt(self, 0.0, h05),
            AsemicPt(self, 0.5, h11),
            AsemicPt(self, 1.0, h05)
        ]
        base_points = [
            AsemicPt(self, -w2, 0.0),
            AsemicPt(self, 0.0, 0.0),
            AsemicPt(self, w2, 0.0)
        ]

        self.map_curve(points, base_points, start, end, add)
        return self

    def hex(self, args_str: str):
        """Draw a hexagon"""
        args = self.tokenize(args_str)
        start, end, h, w = self.parse_args(args)

        points = [
            AsemicPt(self, 0.0, 0.0),
            AsemicPt(self, 0.0, h),
            AsemicPt(self, 1.0, h),
            AsemicPt(self, 1.0, 0.0)
        ]
        base_points = [
            AsemicPt(self, -w, 0.0),
            AsemicPt(self, -w, 0.0),
            AsemicPt(self, w, 0.0),
            AsemicPt(self, w, 0.0)
        ]

        self.map_curve(points, base_points, start, end)
        return self

    def circle(self, args_str: str):
        """Draw a circle"""
        tokens = self.tokenize(args_str)
        if len(tokens) < 2:
            return self

        # Save current transform
        last_to = clone_transform(self.current_transform)

        # Parse center and size
        center = self.eval_point(tokens[0], basic=True)
        wh = self.eval_point(tokens[1], basic=True)
        w, h = wh.x, wh.y

        # Translate to center
        self.to(f"+{center.x},{center.y}")

        # Create circle points
        points = [
            self.apply_transform(AsemicPt(self, w, 0.0)),
            self.apply_transform(AsemicPt(self, w, h)),
            self.apply_transform(AsemicPt(self, -w, h)),
            self.apply_transform(AsemicPt(self, -w, -h)),
            self.apply_transform(AsemicPt(self, w, -h)),
            self.apply_transform(AsemicPt(self, w, 0.0))
        ]

        # Add points to curve
        points_length = len(points)
        for i, pt in enumerate(points):
            self.progress.point = 0.0 if i == points_length - \
                1 else i / (points_length - 2)
            self.current_curve.append(pt)

        if points:
            self.last_point = points[-1]
        self.end()

        # Restore transform
        self.current_transform = last_to
        return self

    def seq(self, count_a: str, expression_a: str, closed: bool = False, end: bool = True):
        """Create a sequence of points"""
        self.repeat(count_a, lambda: self.points(expression_a))

        if closed and self.current_curve:
            first_pt = self.current_curve[0]
            self.current_curve.append(AsemicPt(self, first_pt.x, first_pt.y))

        if end:
            self.end()

        return self

    def line(self, *tokens: str):
        """Draw lines through multiple points"""
        for token in tokens:
            self.points(token)
            self.end()

        return self

    def text(self, text: str):
        """
        Process text and execute drawing commands

        Args:
            text: Text to process (can be drawing commands or character rendering)

        Returns:
            self for chaining
        """
        # Remove comments
        text = re.sub(r'//.*', '', text)

        if not text.strip():
            return self

        # Check if this is a font command
        lines = text.strip().split('\n')

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Check for font commands: fontname char=expression
            space_idx = line.find(' ')
            if space_idx > 0:
                first_word = line[:space_idx]
                # Check if it's a font name (lowercase letters only)
                if first_word.isalpha() and first_word.islower():
                    self._process_font_command(first_word, line[space_idx+1:])
                    continue

            # Otherwise, try to execute as drawing command
            try:
                # Try to execute as method call
                self._execute_command(line)
            except Exception as e:
                # If not a method, try rendering as text with current font
                self._render_text_string(line)

        return self

    def _process_font_command(self, font_name: str, command: str):
        """Process font definition commands"""
        if font_name not in self.fonts:
            self.fonts[font_name] = {}

        # Parse character definitions: char=expression or char=>expression
        tokens = self.tokenize(command)

        for token in tokens:
            if '=' in token:
                # Character definition
                if '=>' in token:
                    # Dynamic character
                    char, expr = token.split('=>', 1)
                    self.fonts[font_name][char.strip()] = {
                        'type': 'dynamic',
                        'expression': expr.strip()
                    }
                else:
                    # Static character
                    char, expr = token.split('=', 1)
                    self.fonts[font_name][char.strip()] = {
                        'type': 'static',
                        'expression': expr.strip()
                    }

    def _execute_command(self, command: str):
        """Execute a drawing command"""
        # Parse method call: methodname(args)
        match = re.match(r'([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)', command)
        if match:
            method_name = match.group(1)
            args_str = match.group(2)

            # Get the method
            if hasattr(self, method_name):
                method = getattr(self, method_name)

                # Parse arguments
                if args_str.strip():
                    # Simple argument parsing
                    args = [arg.strip() for arg in args_str.split(',')]
                    method(*args)
                else:
                    method()
        else:
            # Try executing as a simple statement
            # Could be: method args (without parens)
            parts = command.split(None, 1)
            if len(parts) == 2:
                method_name, args_str = parts
                if hasattr(self, method_name):
                    method = getattr(self, method_name)
                    method(args_str)

    def _render_text_string(self, text: str):
        """Render a text string using the current font"""
        if not self.current_font or self.current_font not in self.fonts:
            return

        font = self.fonts[self.current_font]

        # Track position for character spacing
        char_index = 0
        total_chars = len(text)

        for char in text:
            if char in font:
                char_def = font[char]

                # Set progress for this character
                self.progress.letter = char_index

                # Execute the character's expression
                expr = char_def['expression']
                try:
                    # Try executing as command
                    self._execute_command(expr)
                except:
                    # Try evaluating as expression
                    try:
                        self.expr(expr)
                    except:
                        pass

            char_index += 1

    # Text/Font methods (placeholders)

    def font(self, font_name: str, **kwargs):
        """
        Set current font for text rendering

        Args:
            font_name: Name of font to use
            **kwargs: Font parameters (currently unused)

        Returns:
            self for chaining
        """
        # Create font if it doesn't exist
        if font_name not in self.fonts:
            self.fonts[font_name] = {}

        # Switch to this font
        self.current_font = font_name
        return self

    def keys(self, key_string: str):
        """
        Process keyboard input (placeholder)

        Args:
            key_string: Key input string

        Returns:
            self for chaining
        """
        # Would handle keyboard input for live coding
        self.live.keys = [key_string]
        return self

    def regex(self, pattern: str, seed: Union[str, float] = 0):
        """
        Generate text from regex pattern (placeholder)

        Args:
            pattern: Regular expression pattern
            seed: Random seed

        Returns:
            self for chaining
        """
        # Would generate text matching regex pattern
        # For now, just use the pattern as text
        self.text(f'"{pattern}"')
        return self

    def linden(self, iterations: str, text: str, rules: Dict[str, str]):
        """
        Generate L-system text

        Args:
            iterations: Number of iterations
            text: Initial text
            rules: Replacement rules dict

        Returns:
            self for chaining
        """
        def apply_rules(current_text: str) -> str:
            result = []
            for char in current_text:
                result.append(rules.get(char, char))
            return ''.join(result)

        # Apply L-system rules
        for _ in range(int(self.expr(iterations))):
            text = apply_rules(text)

        # Process the generated text
        self.text(text)
        return self

    # OSC / Communication methods

    def osc(self, args: str):
        """
        Send OSC message

        Args:
            args: OSC path and arguments

        Returns:
            self for chaining
        """
        parts = args.split(' ', 1)
        if len(parts) < 2:
            return self

        path = parts[0]
        arg_str = parts[1]

        # Parse arguments
        arg_values = []
        for arg in arg_str.split():
            if arg.startswith("'"):
                arg_values.append(arg[1:])
            elif arg.startswith('"'):
                arg_values.append(arg[1:-1])
            elif ',' in arg:
                pt = self.eval_point(arg, basic=True)
                arg_values.append([pt.x, pt.y])
            else:
                try:
                    arg_values.append(self.expr(arg))
                except:
                    arg_values.append(arg)

        self.output.osc.append({'path': path, 'args': arg_values})

        # Also send via OSC client if available
        # if hasattr(self, 'osc_client') and self.osc_client:
        #     try:
        #         builder = osc_message_builder.OscMessageBuilder(address=path)
        #         for arg_value in arg_values:
        #             builder.add_arg(arg_value)
        #         msg = builder.build()
        #         self.osc_client.send(msg)
        #     except ImportError:
        #         pass  # pythonosc not available
        #     except Exception as e:
        #         pass  # Ignore send errors

        return self

    def setup_osc(self, host: str = '127.0.0.1', port: int = 57120):
        """
        Initialize OSC client for sending messages

        Args:
            host: OSC server hostname/IP
            port: OSC server port

        Returns:
            self for chaining
        """
        # try:
        #     from pythonosc import udp_client
        #     self.osc_client = udp_client.SimpleUDPClient(host, port)
        # except ImportError:
        print(
            "Warning: pythonosc not installed. Install with: pip install python-osc")
        self.osc_client = None
        return self

    def sc(self, args: str):
        """
        Send SuperCollider message

        Args:
            args: SC path and value

        Returns:
            self for chaining
        """
        parts = args.split(' ', 1)
        if len(parts) < 2:
            return self

        path = parts[0]
        value = self.expr(parts[1])

        self.output.sc.append({'path': path, 'value': value})
        return self

    def synth(self, name: str, code: str):
        """
        Define SuperCollider synth

        Args:
            name: Synth name
            code: Synth definition code

        Returns:
            self for chaining
        """
        self.output.sc_synth_defs[name] = code
        return self

    def file(self, file_path: str):
        """
        Reference external file

        Args:
            file_path: Path to file

        Returns:
            self for chaining
        """
        resolved_path = self.resolve_name(file_path)
        self.output.files.append(resolved_path)
        return self


# Export main classes
__all__ = ['Parser', 'AsemicGroup', 'AsemicPt',
           'BasicPt', 'Transform', 'Settings']
