#!/usr/bin/env python3
"""
Comprehensive example demonstrating the Asemic Parser expression evaluator
with built-in constants and functions
"""

import math
from parser import Parser
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))


def demo_constants():
    """Demonstrate all built-in constants"""

    parser = Parser()

    print("Asemic Parser - Expression Evaluator Demo")
    print("=" * 70)

    # Set some context for constants
    parser.progress.time = 1.5
    parser.progress.scrub = 0.75
    parser.progress.indexes = [3, 5, 7]
    parser.progress.count_nums = [10, 20, 30]
    parser.pre_processing.width = 800
    parser.pre_processing.height = 600

    print("\n1. BASIC ARITHMETIC")
    print("-" * 70)
    examples = [
        ("2 + 3 * 4", "Order of operations"),
        ("(2 + 3) * 4", "Parentheses grouping"),
        ("10 / 2 + 3", "Division and addition"),
        ("2 ^ 3", "Exponentiation"),
        ("15 % 4", "Modulo"),
    ]
    for expr, desc in examples:
        result = parser.expr(expr)
        print(f"  {expr:20s} = {result:8.3f}  # {desc}")

    print("\n2. COMPARISON OPERATORS")
    print("-" * 70)
    examples = [
        ("5 > 3", "Greater than"),
        ("5 < 3", "Less than"),
        ("5 >= 5", "Greater or equal"),
        ("5 == 5", "Equal"),
        ("5 != 3", "Not equal"),
    ]
    for expr, desc in examples:
        result = parser.expr(expr)
        status = "TRUE" if result == 1.0 else "FALSE"
        print(f"  {expr:20s} = {status:8s}  # {desc}")

    print("\n3. MATH FUNCTIONS")
    print("-" * 70)
    examples = [
        ("sin(0)", "Sine of 0"),
        ("sin(0.25)", "Sine of 0.25 (quarter turn)"),
        ("abs(-5.5)", "Absolute value"),
        ("-1 * 7", "Negation"),
    ]
    for expr, desc in examples:
        result = parser.expr(expr)
        print(f"  {expr:20s} = {result:8.3f}  # {desc}")

    print("\n4. TIME & PROGRESS CONSTANTS")
    print("-" * 70)
    print(
        f"  Progress state: time={parser.progress.time}, scrub={parser.progress.scrub}")
    examples = [
        ("T", "Current time"),
        ("S", "Scrub progress (0-1 in scene)"),
        ("T + S", "Combined time and scrub"),
    ]
    for expr, desc in examples:
        result = parser.expr(expr)
        print(f"  {expr:20s} = {result:8.3f}  # {desc}")

    print("\n5. INDEX & COUNTER CONSTANTS")
    print("-" * 70)
    print(
        f"  Indexes: {parser.progress.indexes}, Counts: {parser.progress.count_nums}")
    examples = [
        ("I(1)", "Current index in loop 1"),
        ("I(2)", "Current index in loop 2"),
        ("N(1)", "Count in loop 1"),
        ("i(1)", "Normalized index (0-1) in loop 1"),
    ]
    for expr, desc in examples:
        result = parser.expr(expr)
        print(f"  {expr:20s} = {result:8.3f}  # {desc}")

    print("\n6. CANVAS PROPERTIES")
    print("-" * 70)
    print(
        f"  Canvas: {parser.pre_processing.width}x{parser.pre_processing.height}")
    examples = [
        ("Wpx", "Width in pixels"),
        ("Hpx", "Height in pixels"),
        ("H", "Aspect ratio (height/width)"),
        ("px(10)", "10 pixels as normalized units"),
    ]
    for expr, desc in examples:
        result = parser.expr(expr)
        print(f"  {expr:20s} = {result:8.3f}  # {desc}")

    print("\n7. INTERPOLATION & SELECTION")
    print("-" * 70)
    examples = [
        (">(0.5, 0, 10, 20)", "Interpolate: 50% between 0,10,20"),
        (">(0.25, 0, 100)", "Interpolate: 25% between 0,100"),
        ("choose(1, 10, 20, 30)", "Choose index 1: returns 20"),
        ("choose(0, 5, 15, 25)", "Choose index 0: returns 5"),
    ]
    for expr, desc in examples:
        result = parser.expr(expr)
        print(f"  {expr:20s} = {result:8.3f}  # {desc}")

    print("\n8. LOGICAL OPERATIONS")
    print("-" * 70)
    examples = [
        ("!(0)", "NOT false = true"),
        ("!(1)", "NOT true = false"),
        ("or(1, 100, 200)", "Ternary: condition true, return 100"),
        ("or(0, 100, 200)", "Ternary: condition false, return 200"),
    ]
    for expr, desc in examples:
        result = parser.expr(expr)
        print(f"  {expr:20s} = {result:8.3f}  # {desc}")

    print("\n9. HASH FUNCTION (Pseudo-random)")
    print("-" * 70)
    examples = [
        ("hash(1)", "Hash of 1"),
        ("hash(2)", "Hash of 2"),
        ("hash(3)", "Hash of 3"),
        ("hash(1 + 2)", "Hash of expression"),
    ]
    for expr, desc in examples:
        result = parser.expr(expr)
        print(f"  {expr:20s} = {result:8.3f}  # {desc}")

    print("\n10. COMPLEX EXPRESSIONS")
    print("-" * 70)
    examples = [
        ("2 * sin(T) + 3", "Animated value"),
        ("or(S > 0.5, 1, 0)", "Conditional based on scrub"),
        ("abs(sin(T * 2)) * 10", "Complex animation"),
        (">(i(1), 0, 50, 100)", "Interpolate using normalized index"),
    ]
    for expr, desc in examples:
        result = parser.expr(expr)
        print(f"  {expr:20s} = {result:8.3f}  # {desc}")

    print("\n11. POINT EXPRESSIONS")
    print("-" * 70)
    point_examples = [
        ("0.5 0.5", "Center point"),
        ("sin(T) cos(T)", "Animated point"),
        ("0.5", "X only (y=0 default)"),
        ("I(1)/N(1) S", "Index-based point"),
    ]
    for expr, desc in point_examples:
        result = parser.eval_point(expr)
        print(f"  {expr:20s} = ({result.x:6.3f}, {result.y:6.3f})  # {desc}")

    print("\n" + "=" * 70)
    print("Demo complete! All expressions evaluated successfully.")
    print("\nNote: Some constants like C, P, L depend on curve/drawing state")
    print("and would have different values during actual scene rendering.")


def demo_custom_constants():
    """Demonstrate adding custom constants"""

    print("\n" + "=" * 70)
    print("CUSTOM CONSTANTS EXAMPLE")
    print("=" * 70)

    # Add custom constants
    custom = {
        'double': lambda x: parser.expr(x) * 2,
        'average': lambda *args: sum(parser.expr(arg) for arg in args) / len(args),
        'clamp': lambda x, min_val, max_val: max(parser.expr(min_val),
                                                 min(parser.expr(max_val),
                                                     parser.expr(x)))
    }

    parser = Parser(additional_constants=custom)

    examples = [
        ("double(5)", "Double function: 5 * 2"),
        ("average(10, 20, 30)", "Average of three numbers"),
        ("clamp(15, 0, 10)", "Clamp 15 between 0-10"),
        ("clamp(5, 0, 10)", "Clamp 5 between 0-10"),
    ]

    for expr, desc in examples:
        result = parser.expr(expr)
        print(f"  {expr:30s} = {result:8.3f}  # {desc}")

    print("=" * 70)


if __name__ == "__main__":
    demo_constants()
    demo_custom_constants()
