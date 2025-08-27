"""
Example usage of the AsemicParser for TouchDesigner
This shows how to integrate the parser with the TouchDesigner extension
"""

import math
import time
import random
from AsemicParser import AsemicParser, AsemicPt, AsemicGroup


def example_usage():
    """Example of how to use the AsemicParser"""

    # Create parser instance
    parser = AsemicParser()

    # Example Asemic source code
    source_code = """
# Simple drawing example
scene {
    repeat 10 {
        pen 0.1*I,0.1*I
        to 0.5,0.5
        circle 0.1
    }
}
"""

    # Setup the parser with source code
    parser.setup(source_code)

    # Simulate animation frames
    for frame in range(300):  # 5 seconds at 60fps
        parser.draw()

        # Access the generated geometry
        for group in parser.groups:
            points = group.flat()
            print(f"Frame {frame}: Generated {len(points)} points")

        # Check for errors
        if parser.output.errors:
            print(f"Errors: {parser.output.errors}")
            parser.output.errors.clear()

        # Access current transform state
        transform = parser.currentTransform


def touchdesigner_integration_example():
    """
    Example of how this would integrate with the TouchDesigner extension
    """
    from types import TouchDesignerOutput, TouchDesignerParams
    from AsemicExtension import AsemicExtension

    class MockTouchDesignerComponent:
        """Mock TouchDesigner component for testing"""

        def __init__(self):
            self.customPages = []
            self.par = type('Par', (), {})()

        def op(self, path: str):
            return None

        def appendCustomPage(self, name: str):
            return type('Page', (), {
                'appendToggle': lambda n, label: [type('Par', (), {'default': False})()],
                'appendFloat': lambda n, label: [type('Par', (), {'default': 0.0})()],
                'appendInt': lambda n, label: [type('Par', (), {'default': 1920})()]
            })()

        def save(self, filename: str):
            print(f"Would save to {filename}")

    # Create mock component
    mock_comp = MockTouchDesignerComponent()

    # Create extension
    extension = AsemicExtension(mock_comp)
    extension.Initialize()

    # Example source code
    source = """
scene 3 {
    repeat 10 {
        pen 0.1*I,0.1*I
        to 0.5+0.1*sin(I),0.5+0.1*cos(I)
    }
}
"""

    # Setup parser
    extension.parser.setup(source)

    # Simulate frames
    for frame in range(180):  # 3 seconds at 60fps
        extension.parser.draw()
        output = extension.getOutput()

        if frame % 60 == 0:  # Every second
            print(
                f"Frame {frame}: {len(output.geometry.points)} points, {len(output.errors)} errors")


def custom_constants_example():
    """Example of adding custom constants to the parser"""

    # Define custom constants
    custom_constants = {
        "myConstant": lambda: 42.0,
        "randomWalk": lambda: random.random() * 2 - 1,
        "timeBasedValue": lambda: math.sin(time.time()) * 0.5 + 0.5
    }

    # Create parser with custom constants
    parser = AsemicParser(custom_constants)

    # Source code using custom constants
    source = """
scene 3 {
    pen myConstant/100, myConstant/100
    circle timeBasedValue
}
"""

    parser.setup(source)
    parser.draw()

    print(f"Generated {len(parser.groups)} groups with custom constants")


def debugging_example():
    """Example of debugging and error handling"""

    parser = AsemicParser()

    # Intentionally problematic source code
    source = """
scene 2 {
    pen undefinedVariable, 0.5
    circle invalidExpression
}
"""

    parser.setup(source)
    parser.draw()

    # Check for errors
    if parser.output.errors:
        print("Errors encountered:")
        for error in parser.output.errors:
            print(f"  - {error}")
    else:
        print("No errors found")

    # Use debug function
    debug_output = parser.debug()
    print(f"Debug output: {debug_output}")


if __name__ == "__main__":
    print("Running AsemicParser examples...")

    print("\n1. Basic Usage:")
    example_usage()

    print("\n2. Custom Constants:")
    custom_constants_example()

    print("\n3. Debugging:")
    debugging_example()

    print("\nExamples complete!")

if '__name__' == '__main__':
    print("Running AsemicParser examples...")

    print("\n1. Basic Usage:")
    example_usage()

    print("\n2. Custom Constants:")
    custom_constants_example()

    print("\n3. Debugging:")
    debugging_example()
    print("\n1. Basic Usage:")
    example_usage()

    print("\n2. Custom Constants:")
    custom_constants_example()

    print("\n3. Debugging:")
    debugging_example()
