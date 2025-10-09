#!/usr/bin/env python3
"""
Test script for the Asemic Parser expression evaluator
"""

from parser import Parser, BasicPt
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))


def test_expr_parser():
    """Test the expression parser with various inputs"""

    parser = Parser()

    print("Testing Expression Parser")
    print("=" * 60)

    # Test cases: (expression, expected_result, description)
    test_cases = [
        # Basic numbers
        ("42", 42.0, "Integer"),
        ("3.14", 3.14, "Float"),
        ("-5", -5.0, "Negative"),

        # Basic arithmetic
        ("2 + 3", 5.0, "Addition"),
        ("10 - 4", 6.0, "Subtraction"),
        ("3 * 4", 12.0, "Multiplication"),
        ("15 / 3", 5.0, "Division"),
        ("2 ^ 3", 8.0, "Exponentiation"),
        ("10 % 3", 1.0, "Modulo"),

        # Order of operations
        ("2 + 3 * 4", 14.0, "Multiplication before addition"),
        ("(2 + 3) * 4", 20.0, "Parentheses"),
        ("2 ^ 3 ^ 2", 512.0, "Right-associative power"),

        # Unary operators
        ("-5 + 3", -2.0, "Unary minus"),
        ("--5", 5.0, "Double negative"),

        # Comparison operators
        ("5 > 3", 1.0, "Greater than (true)"),
        ("5 < 3", 0.0, "Less than (false)"),
        ("5 >= 5", 1.0, "Greater or equal (true)"),
        ("5 == 5", 1.0, "Equal (true)"),
        ("5 != 3", 1.0, "Not equal (true)"),

        # Complex expressions
        ("2 * (3 + 4) - 1", 13.0, "Complex expression"),
        ("(10 + 5) / 3", 5.0, "Division with parentheses"),

        # Built-in constants (these use parser state)
        ("sin(0)", 0.0, "Sine of 0"),
        ("abs(-5)", 5.0, "Absolute value"),

        # Math functions
        ("2 + sin(0) * 5", 2.0, "Function in expression"),
    ]

    passed = 0
    failed = 0

    for expr, expected, description in test_cases:
        try:
            result = parser.expr(expr)
            # Use approximate equality for floating point
            if abs(result - expected) < 1e-6:
                print(f"✓ {description:40s} | {expr:20s} = {result:.2f}")
                passed += 1
            else:
                print(
                    f"✗ {description:40s} | {expr:20s} = {result:.2f} (expected {expected:.2f})")
                failed += 1
        except Exception as e:
            print(f"✗ {description:40s} | {expr:20s} ERROR: {str(e)}")
            failed += 1

    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed")

    # Test point parsing
    print("\nTesting Point Parser")
    print("=" * 60)

    point_tests = [
        ("0.5 0.5", (0.5, 0.5), "Simple point"),
        ("0.5", (0.5, 0.0), "Single value (default y=0)"),
        ("1+1 2*2", (2.0, 4.0), "Expressions as coordinates"),
    ]

    for expr, expected, description in point_tests:
        try:
            result = parser.eval_point(expr)
            if abs(result.x - expected[0]) < 1e-6 and abs(result.y - expected[1]) < 1e-6:
                print(
                    f"✓ {description:40s} | {expr:20s} = ({result.x:.2f}, {result.y:.2f})")
                passed += 1
            else:
                print(
                    f"✗ {description:40s} | {expr:20s} = ({result.x:.2f}, {result.y:.2f}) (expected {expected})")
                failed += 1
        except Exception as e:
            print(f"✗ {description:40s} | {expr:20s} ERROR: {str(e)}")
            failed += 1

    print("=" * 60)
    print(f"Total Results: {passed} passed, {failed} failed")

    return failed == 0


if __name__ == "__main__":
    success = test_expr_parser()
    sys.exit(0 if success else 1)
