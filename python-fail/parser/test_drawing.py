#!/usr/bin/env python3
"""
Comprehensive test suite for drawing, transform, text, and OSC methods
"""

from parser import Parser, AsemicPt, BasicPt
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))


def test_basic_pt_methods():
    """Test BasicPt helper methods"""
    print("\nTesting BasicPt Methods")
    print("=" * 70)

    # Test magnitude
    pt = BasicPt(3.0, 4.0)
    mag = pt.magnitude()
    print(f"  ✓ magnitude(3, 4) = {mag:.2f} (expected 5.00)")
    assert abs(mag - 5.0) < 0.01

    # Test angle
    pt = BasicPt(1.0, 0.0)
    angle = pt.angle0to1()
    print(f"  ✓ angle0to1(1, 0) = {angle:.2f} (expected 0.00)")
    assert abs(angle) < 0.01

    # Test subtract
    pt1 = BasicPt(5.0, 3.0)
    pt2 = BasicPt(2.0, 1.0)
    pt1.subtract(pt2)
    print(f"  ✓ subtract: ({pt1.x}, {pt1.y}) (expected 3, 2)")
    assert pt1.x == 3.0 and pt1.y == 2.0

    # Test rotate
    pt = BasicPt(1.0, 0.0)
    pt.rotate(0.25)  # 90 degrees
    print(f"  ✓ rotate(0.25): ({pt.x:.2f}, {pt.y:.2f}) (expected 0, 1)")
    assert abs(pt.x) < 0.01 and abs(pt.y - 1.0) < 0.01

    # Test scale with center
    pt = BasicPt(2.0, 2.0)
    center = BasicPt(1.0, 1.0)
    pt.scale([2.0, 2.0], center)
    print(f"  ✓ scale around center: ({pt.x}, {pt.y}) (expected 3, 3)")
    assert pt.x == 3.0 and pt.y == 3.0

    print("  ✓ BasicPt method tests passed!\n")


def test_transform_methods():
    """Test transformation methods"""
    print("Testing Transform Methods")
    print("=" * 70)

    parser = Parser()

    # Test scale transform
    parser.to("*2")
    print(
        f"  ✓ Scale transform: scale=({parser.current_transform.scale.x}, {parser.current_transform.scale.y})")
    assert parser.current_transform.scale.x == 2.0
    assert parser.current_transform.scale.y == 2.0

    # Test translation
    parser.to("+0.5,0.25")
    print(
        f"  ✓ Translation: ({parser.current_transform.translation.x}, {parser.current_transform.translation.y})")
    assert parser.current_transform.translation.x == 0.5
    assert parser.current_transform.translation.y == 0.25

    # Test rotation
    parser.to("@0.25")
    print(f"  ✓ Rotation: {parser.current_transform.rotation}")
    assert parser.current_transform.rotation == 0.25

    # Test reset
    parser.to("!")
    print(f"  ✓ Reset transform")
    assert parser.current_transform.scale.x == 1.0
    assert parser.current_transform.translation.x == 0.0

    # Test apply_transform
    pt = AsemicPt(parser, 1.0, 1.0)
    parser.to("*2 +1,0.5")
    transformed = parser.apply_transform(pt)
    print(
        f"  ✓ Apply transform: ({transformed.x}, {transformed.y}) (expected 3, 2.5)")
    assert transformed.x == 3.0 and transformed.y == 2.5

    print("  ✓ Transform method tests passed!\n")


def test_drawing_methods():
    """Test drawing shape methods"""
    print("Testing Drawing Methods")
    print("=" * 70)

    parser = Parser()

    # Test triangle
    parser.tri("0,0 1,0 0.5")
    print(f"  ✓ tri(): created {len(parser.groups)} groups")
    assert len(parser.groups) > 0
    assert len(parser.groups[-1]) > 0

    # Test square
    parser.reset()
    parser.squ("0,0 1,0 0.5,0.1")
    print(f"  ✓ squ(): created {len(parser.groups)} groups")
    assert len(parser.groups) > 0

    # Test pentagon
    parser.reset()
    parser.pen("0,0 1,0 0.5,0.1")
    print(f"  ✓ pen(): created {len(parser.groups)} groups")
    assert len(parser.groups) > 0

    # Test hexagon
    parser.reset()
    parser.hex("0,0 1,0 0.5,0.1")
    print(f"  ✓ hex(): created {len(parser.groups)} groups")
    assert len(parser.groups) > 0

    # Test circle
    parser.reset()
    parser.circle("0.5,0.5 0.25,0.25")
    curves = parser.groups[-1] if parser.groups else []
    points_in_curve = len(curves[0]) if curves else 0  # type: ignore
    print(
        f"  ✓ circle(): created {len(parser.groups)} groups with {points_in_curve} points")
    assert len(parser.groups) > 0
    assert points_in_curve > 4  # Circle should have multiple points

    # Test sequence
    parser.reset()
    parser.seq("5", "i,i")
    curves = parser.groups[-1] if parser.groups else []
    points_count = len(curves[0]) if curves else 0  # type: ignore
    print(f"  ✓ seq(): created sequence with {points_count} points")
    assert len(parser.groups) > 0

    # Test line
    parser.reset()
    parser.line("0,0", "1,1", "0.5,0.5")
    print(f"  ✓ line(): created {len(parser.groups[-1])} curves")
    assert len(parser.groups[-1]) == 3  # 3 separate lines

    print("  ✓ Drawing method tests passed!\n")


def test_points_and_end():
    """Test points() and end() methods"""
    print("Testing Points & End Methods")
    print("=" * 70)

    parser = Parser()

    # Test adding points
    parser.points("0,0 0.5,0.5 1,1")
    print(
        f"  ✓ points(): added {len(parser.current_curve)} points to current curve")
    assert len(parser.current_curve) == 3

    # Test end
    parser.end()
    print(
        f"  ✓ end(): finalized curve, groups now has {len(parser.groups[-1])} curves")
    assert len(parser.current_curve) == 0  # Current curve should be cleared
    assert len(parser.groups[-1]) == 1  # Should have 1 completed curve

    # Test end with 2 points (should interpolate middle)
    parser.points("0,0 1,1")
    assert len(parser.current_curve) == 2
    parser.end()
    last_curve = parser.groups[-1][-1]  # type: ignore
    points_in_last_curve = len(last_curve)  # type: ignore
    print(
        f"  ✓ end() with 2 points: interpolated to {points_in_last_curve} points")
    assert points_in_last_curve == 3  # Should interpolate to 3 points

    print("  ✓ Points & end method tests passed!\n")


def test_text_methods():
    """Test text and L-system methods"""
    print("Testing Text Methods")
    print("=" * 70)

    parser = Parser()

    # Test L-system (linden)
    result = parser.linden("3", "A", {"A": "AB", "B": "A"})
    print(f"  ✓ linden(): generated L-system text")
    assert result == parser

    # Test regex (placeholder)
    result = parser.regex("[a-z]{3}")
    print(f"  ✓ regex(): processed pattern")
    assert result == parser

    # Test keys
    result = parser.keys("test")
    print(f"  ✓ keys(): set keys to {parser.live.keys}")
    assert parser.live.keys == ["test"]

    # Test font (placeholder)
    result = parser.font("Arial")
    print(f"  ✓ font(): set font")
    assert result == parser

    print("  ✓ Text method tests passed!\n")


def test_osc_methods():
    """Test OSC and SuperCollider methods"""
    print("Testing OSC Methods")
    print("=" * 70)

    parser = Parser()

    # Test OSC message
    parser.osc("/test/path 42 'hello")
    print(f"  ✓ osc(): sent message to {parser.output.osc[-1]['path']}")
    assert len(parser.output.osc) == 1
    assert parser.output.osc[0]['path'] == '/test/path'
    print(f"    Args: {parser.output.osc[0]['args']}")

    # Test SuperCollider message
    parser.sc("/synth/freq 440")
    print(f"  ✓ sc(): sent SC message to {parser.output.sc[-1]['path']}")
    assert len(parser.output.sc) == 1
    assert parser.output.sc[0]['path'] == '/synth/freq'
    assert parser.output.sc[0]['value'] == 440

    # Test synth definition
    parser.synth("test_synth", "{ SinOsc.ar(440) }")
    print(
        f"  ✓ synth(): defined synth '{list(parser.output.sc_synth_defs.keys())[-1]}'")
    assert 'test_synth' in parser.output.sc_synth_defs

    # Test file reference
    parser.settings.folder = 'assets'
    parser.file("test.png")
    print(f"  ✓ file(): referenced {parser.output.files[-1]}")
    assert len(parser.output.files) == 1
    assert parser.output.files[0] == 'assets/test.png'

    print("  ✓ OSC method tests passed!\n")


def test_parse_args():
    """Test parseArgs helper method"""
    print("Testing parseArgs Method")
    print("=" * 70)

    parser = Parser()

    # Test basic args
    start, end, h, w = parser.parse_args(['0,0', '1,1', '0.5,0.25'])
    print(
        f"  ✓ parse_args: start=({start.x}, {start.y}), end=({end.x}, {end.y}), h={h}, w={w}")
    assert isinstance(start, AsemicPt)
    assert isinstance(end, AsemicPt)
    assert h == 0.5
    assert w == 0.25

    # Test with expressions
    parser.progress.time = 0.5
    start, end, h, w = parser.parse_args(['T,0', '1,T', 'T'])
    print(f"  ✓ parse_args with expressions: h={h}")
    assert h == 0.5  # T should evaluate to time

    print("  ✓ parseArgs tests passed!\n")


def test_advanced_point_parsing():
    """Test advanced point notation"""
    print("Testing Advanced Point Parsing")
    print("=" * 70)

    parser = Parser()

    # Test polar coordinates
    pt = parser.parse_point_advanced("@0,1")
    print(f"  ✓ Polar @0,1: ({pt.x:.2f}, {pt.y:.2f}) (expected 1, 0)")
    assert abs(pt.x - 1.0) < 0.01
    assert abs(pt.y) < 0.01

    # Test relative coordinates
    parser.to("+0.5,0.5")
    pt = parser.parse_point_advanced("+0.25,0.25")
    print(
        f"  ✓ Relative +0.25,0.25 with translation: ({pt.x:.2f}, {pt.y:.2f})")
    # Should apply translation

    # Test expression coordinates
    parser.reset()
    pt = parser.parse_point_advanced("1+1,2*2")
    print(f"  ✓ Expression 1+1,2*2: ({pt.x}, {pt.y}) (expected 2, 4)")
    assert pt.x == 2.0 and pt.y == 4.0

    print("  ✓ Advanced point parsing tests passed!\n")


def test_integration():
    """Test integration of multiple methods"""
    print("Testing Method Integration")
    print("=" * 70)

    parser = Parser()

    # Create a simple scene with transformations and drawing
    parser.to("*2 +0.5,0.5")
    parser.tri("0,0 1,0 0.5")
    parser.to("!")
    parser.squ("0,0 1,1 0.25,0.1")

    print(f"  ✓ Created scene with {len(parser.groups[-1])} shapes")
    assert len(parser.groups[-1]) == 2

    # Test with parameters
    parser.param('size', value=0.5, min_val=0.1, max_val=1.0)
    parser.to("*size")
    parser.circle("0.5,0.5 size,size")

    print(f"  ✓ Used parameter in drawing")
    assert 'size' in parser.params

    # Test with scene and repeat
    parser.reset()
    parser.repeat("3", lambda: parser.line("i,0", "i,1"))

    # line("i,0", "i,1") creates 2 curves per iteration, so 3 iterations = 6 curves
    print(f"  ✓ Repeated drawing {len(parser.groups[-1])} curves")
    assert len(parser.groups[-1]) == 6  # 2 curves per iteration × 3 iterations

    print("  ✓ Integration tests passed!\n")


def run_all_tests():
    """Run all test suites"""
    print("\n" + "=" * 70)
    print("COMPREHENSIVE TEST SUITE - NEW METHODS")
    print("=" * 70)

    try:
        test_basic_pt_methods()
        test_transform_methods()
        test_drawing_methods()
        test_points_and_end()
        test_text_methods()
        test_osc_methods()
        test_parse_args()
        test_advanced_point_parsing()
        test_integration()

        print("=" * 70)
        print("✅ ALL TESTS PASSED!")
        print("=" * 70)
        return True
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
