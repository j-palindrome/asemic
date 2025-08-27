"""
TouchDesigner-specific types for Asemic Parser
"""

from typing import Protocol, Any, List, Dict, Optional, Union
from abc import ABC, abstractmethod


class TDOperator(Protocol):
    """TouchDesigner Operator interface"""

    def op(self, path: str) -> Optional['TDOperator']:
        """Get child operator by path"""
        ...

    def clear(self) -> None:
        """Clear operator content"""
        ...

    def appendPoint(self) -> 'TDPoint':
        """Append a new point"""
        ...

    def appendPrim(self) -> 'TDPrimitive':
        """Append a new primitive"""
        ...

    @property
    def points(self) -> List['TDPoint']:
        """Get all points"""
        ...

    @property
    def text(self) -> str:
        """Get/set text content"""
        ...

    @text.setter
    def text(self, value: str) -> None:
        ...


class TDPoint(Protocol):
    """TouchDesigner Point interface"""

    @property
    def P(self) -> List[float]:
        """Point position"""
        ...

    @P.setter
    def P(self, value: List[float]) -> None:
        ...


class TDPrimitive(Protocol):
    """TouchDesigner Primitive interface"""

    def addVertex(self, point: TDPoint) -> None:
        """Add vertex to primitive"""
        ...


class TDParameter(Protocol):
    """TouchDesigner Parameter interface"""

    @property
    def name(self) -> str:
        """Parameter name"""
        ...

    @property
    def default(self) -> Any:
        """Default value"""
        ...

    @default.setter
    def default(self, value: Any) -> None:
        ...

    def eval(self) -> Any:
        """Evaluate parameter value"""
        ...


class TDCustomPage(Protocol):
    """TouchDesigner Custom Parameter Page interface"""

    def appendToggle(self, name: str, label: str) -> List[TDParameter]:
        """Append toggle parameter"""
        ...

    def appendFloat(self, name: str, label: str) -> List[TDParameter]:
        """Append float parameter"""
        ...

    def appendInt(self, name: str, label: str) -> List[TDParameter]:
        """Append integer parameter"""
        ...

    def appendPulse(self, name: str, label: str) -> List[TDParameter]:
        """Append pulse parameter"""
        ...


class TDComponent(Protocol):
    """TouchDesigner Component interface"""

    @property
    def par(self) -> Any:
        """Access to parameters"""
        ...

    @property
    def customPages(self) -> List[TDCustomPage]:
        """Custom parameter pages"""
        ...

    def appendCustomPage(self, name: str) -> TDCustomPage:
        """Append custom parameter page"""
        ...

    def op(self, path: str) -> Optional[TDOperator]:
        """Get child operator"""
        ...

    def save(self, filename: str) -> None:
        """Save component"""
        ...


class TDTimer(Protocol):
    """TouchDesigner Timer interface"""

    def destroy(self) -> None:
        """Destroy timer"""
        ...


# TouchDesigner global functions
def run(code: str, *args, delayFrames: int = 1, delayRef: Optional[TDOperator] = None) -> TDTimer:
    """Run code with delay"""
    ...


def op(path: str) -> Optional[TDOperator]:
    """Get operator by path"""
    ...


# TouchDesigner utility module
class TDU:
    """TouchDesigner Utility functions"""

    @staticmethod
    def digits(count: int) -> str:
        """Generate timestamp digits"""
        import time
        return str(int(time.time() * 1000))[-count:]


# Global instance
tdu = TDU()

# Geometry types for SOP operations


class AsemicGeometry:
    """Asemic-specific geometry representation for TouchDesigner"""

    def __init__(self):
        self.points: List[List[float]] = []
        self.primitives: List[List[int]] = []
        self.attributes: Dict[str, List[Any]] = {}

    def add_point(self, x: float, y: float, z: float = 0.0) -> int:
        """Add point and return index"""
        self.points.append([x, y, z])
        return len(self.points) - 1

    def add_primitive(self, point_indices: List[int]) -> None:
        """Add primitive connecting points"""
        self.primitives.append(point_indices)

    def add_attribute(self, name: str, values: List[Any]) -> None:
        """Add point or primitive attribute"""
        self.attributes[name] = values

    def clear(self) -> None:
        """Clear all geometry"""
        self.points.clear()
        self.primitives.clear()
        self.attributes.clear()


# CHOP types for audio/control data
class AsemicCHOP:
    """Asemic-specific CHOP data for TouchDesigner"""

    def __init__(self):
        self.channels: Dict[str, List[float]] = {}
        self.sample_rate: float = 44100.0
        self.length: int = 0

    def add_channel(self, name: str, samples: List[float]) -> None:
        """Add channel data"""
        self.channels[name] = samples
        self.length = max(self.length, len(samples))

    def get_channel(self, name: str) -> List[float]:
        """Get channel data"""
        return self.channels.get(name, [])

    def clear(self) -> None:
        """Clear all channels"""
        self.channels.clear()
        self.length = 0


# DAT types for text/data
class AsemicDAT:
    """Asemic-specific DAT data for TouchDesigner"""

    def __init__(self):
        self.text: str = ""
        self.rows: List[List[str]] = []

    def set_text(self, text: str) -> None:
        """Set text content"""
        self.text = text

    def set_table(self, data: List[List[str]]) -> None:
        """Set table data"""
        self.rows = data

    def get_cell(self, row: int, col: int) -> str:
        """Get cell value"""
        if 0 <= row < len(self.rows) and 0 <= col < len(self.rows[row]):
            return self.rows[row][col]
        return ""

    def clear(self) -> None:
        """Clear all data"""
        self.text = ""
        self.rows.clear()


# Output data structure for TouchDesigner integration
class TouchDesignerOutput:
    """Output data structure for TouchDesigner"""

    def __init__(self):
        self.geometry = AsemicGeometry()
        self.audio = AsemicCHOP()
        self.data = AsemicDAT()
        self.osc_messages: List[Dict[str, Any]] = []
        self.errors: List[str] = []

    def clear(self) -> None:
        """Clear all output data"""
        self.geometry.clear()
        self.audio.clear()
        self.data.clear()
        self.osc_messages.clear()
        self.errors.clear()


# Parameter schema for TouchDesigner
class TouchDesignerParams:
    """Parameter definitions for TouchDesigner component"""

    def __init__(self):
        self.play: bool = False
        self.progress: float = 0.0
        self.record: bool = False
        self.width: int = 1920
        self.height: int = 1080
        self.fps: float = 60.0
        self.duration: float = 10.0
        self.reset: bool = False
        self.export: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary"""
        return {
            'play': self.play,
            'progress': self.progress,
            'record': self.record,
            'width': self.width,
            'height': self.height,
            'fps': self.fps,
            'duration': self.duration,
            'reset': self.reset,
            'export': self.export
        }

    def from_dict(self, data: Dict[str, Any]) -> None:
        """Update from dictionary"""
        for key, value in data.items():
            if hasattr(self, key):
                setattr(self, key, value)
