#!/usr/bin/env python3
"""
Test suite for newly implemented Parser methods
Tests utility methods, scene management, and data methods
"""

from parser import Parser, BasicPt, AsemicPt
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))


def test_scene_management():
    """Test scene, play, scrub methods"""
    print("\nTesting Scene Management")
    print("=" * 70)

    parser = Parser()

    # Define some scenes
    scene_executed = {'scene1': False, 'scene2': False, 'scene3': False}

    def scene1_draw():
        scene_executed['scene1'] = True

    def scene2_draw():
        scene_executed['scene2'] = True

    def scene3_draw():
        scene_executed['scene3'] = True

    # Add scenes
    parser.scene(
        {'draw': scene1_draw, 'length': 1.0},
        {'draw': scene2_draw, 'length': 2.0},
        {'draw': scene3_draw, 'length': 1.5}
    )

    print(f"  ✓ Created 3 scenes")
    print(f"  ✓ Total length: {parser.total_length:.1f} seconds")
    assert len(parser.scene_list) == 3
    assert parser.total_length == 4.5

    # Test scrubbing
    parser.scrub(1.5)
    parser.draw()

    print(f"  ✓ Scrubbed to 1.5s, executed scene: {scene_executed}")
    assert scene_executed['scene2'] == True

    print("  ✓ Scene management tests passed!\n")


def test_parameters():
    """Test param, preset, to_preset methods"""
    print("Testing Parameters & Presets")
    print("=" * 70)

    parser = Parser()

    # Define parameters
    parser.param('speed', value=0.5, min_val=0.0, max_val=2.0)
    parser.param('size', value=1.0, min_val=0.1, max_val=5.0)

    print(f"  ✓ Created parameters: speed={parser.params['speed']['value']:.1f}, "
          f"size={parser.params['size']['value']:.1f}")

    # Create presets
    parser.preset('fast', 'speed=2.0 size=0.5')
    parser.preset('slow', 'speed=0.1 size=3.0')

    print(f"  ✓ Created presets: fast, slow")

    # Test preset interpolation
    original_speed = parser.params['speed']['value']
    parser.to_preset('fast', 0.5)
    new_speed = parser.params['speed']['value']

    print(
        f"  ✓ Interpolated to 'fast' by 50%: speed {original_speed:.1f} → {new_speed:.1f}")
    assert new_speed > original_speed

    # Test parameter as constant
    result = parser.expr('speed * 2')
    print(f"  ✓ Parameters work as constants: speed * 2 = {result:.2f}")

    print("  ✓ Parameter tests passed!\n")


def test_utility_methods():
    """Test repeat, test, get_bounds methods"""
    print("Testing Utility Methods")
    print("=" * 70)

    parser = Parser()

    # Test repeat
    counter = {'value': 0}

    def count_callback():
        counter['value'] += 1

    parser.repeat('3', count_callback)
    print(f"  ✓ repeat('3', callback): executed {counter['value']} times")
    assert counter['value'] == 3

    # Test nested repeat
    counter['value'] = 0
    parser.repeat('2 3', count_callback)
    print(
        f"  ✓ repeat('2 3', callback): executed {counter['value']} times (2x3)")
    assert counter['value'] == 6

    # Test conditional
    true_called = {'value': False}
    false_called = {'value': False}

    parser.test('1', lambda: true_called.update(value=True),
                lambda: false_called.update(value=True))
    print(
        f"  ✓ test(true, callback1, callback2): called callback1={true_called['value']}")
    assert true_called['value'] == True
    assert false_called['value'] == False

    true_called['value'] = False
    parser.test('0', lambda: true_called.update(value=True),
                lambda: false_called.update(value=True))
    print(
        f"  ✓ test(false, callback1, callback2): called callback2={false_called['value']}")
    assert true_called['value'] == False
    assert false_called['value'] == True

    # Test get_bounds with mock data
    parser.groups = [
        [AsemicPt(parser, 0, 0), AsemicPt(
            parser, 1, 0), AsemicPt(parser, 1, 1)],
        [AsemicPt(parser, 0.5, 0.5), AsemicPt(
            parser, 2, 2), AsemicPt(parser, 0, 1)]
    ]

    bounds = parser.get_bounds()
    print(f"  ✓ get_bounds(): {bounds}")
    assert bounds[0] == 0.0  # minX
    assert bounds[2] == 2.0  # maxX

    print("  ✓ Utility method tests passed!\n")


def test_noise():
    """Test noise generation"""
    print("Testing Noise Generation")
    print("=" * 70)

    parser = Parser()

    # Generate noise with different frequencies
    freqs = [BasicPt(1.0, 0.0), BasicPt(2.0, 0.5), BasicPt(4.0, 0.8)]

    noise1 = parser.noise(0.0, freqs)
    noise2 = parser.noise(0.5, freqs)
    noise3 = parser.noise(1.0, freqs)

    print(f"  ✓ noise(0.0) = {noise1:.3f}")
    print(f"  ✓ noise(0.5) = {noise2:.3f}")
    print(f"  ✓ noise(1.0) = {noise3:.3f}")

    # Values should be different
    assert noise1 != noise2
    assert noise2 != noise3

    # Test noise constant function
    parser.progress.time = 0.5
    result = parser.expr('~(1, 1 0)')
    print(f"  ✓ Noise constant '~(1, 1 0)' = {result:.3f}")

    print("  ✓ Noise tests passed!\n")


def test_data_methods():
    """Test table and file loading"""
    print("Testing Data Methods")
    print("=" * 70)

    parser = Parser()

    # Test resolve_name
    parser.settings.folder = 'assets/images'
    resolved = parser.resolve_name('test.png')
    print(f"  ✓ resolve_name('test.png') = '{resolved}'")
    assert resolved == 'assets/images/test.png'

    # Mock image data
    class MockImageData:
        def __init__(self):
            self.width = 2
            self.height = 2
            # RGBA data for 2x2 image: white, black, red, blue
            self.data = [
                255, 255, 255, 255,  # (0,0) white
                0, 0, 0, 255,        # (1,0) black
                255, 0, 0, 255,      # (0,1) red
                0, 0, 255, 255       # (1,1) blue
            ]

    parser.load_files({'assets/images/test.png': [MockImageData()]})
    print(f"  ✓ Loaded mock image data")

    # Sample pixels
    brightness = parser.table('test.png', '0 0', 'brightness')
    print(f"  ✓ table('test.png', '0 0', 'brightness') = {brightness:.2f}")
    assert brightness > 0.9  # White pixel

    red_channel = parser.table('test.png', '0 0.5', 'r')
    print(f"  ✓ table('test.png', '0 0.5', 'r') = {red_channel:.2f}")
    # This should be closer to red pixel

    print("  ✓ Data method tests passed!\n")


def test_tokenization():
    """Test tokenize and parse_point"""
    print("Testing Tokenization")
    print("=" * 70)

    parser = Parser()

    # Test tokenize
    tokens = parser.tokenize('hello world test')
    print(f"  ✓ tokenize('hello world test') = {tokens}")
    assert tokens == ['hello', 'world', 'test']

    tokens = parser.tokenize('a,b,c')
    print(f"  ✓ tokenize('a,b,c') = {tokens}")
    assert tokens == ['a', 'b', 'c']

    # Test parse_point
    x, y = parser.parse_point('0.5 0.75')
    print(f"  ✓ parse_point('0.5 0.75') = ({x}, {y})")
    assert x == 0.5 and y == 0.75

    print("  ✓ Tokenization tests passed!\n")


def run_all_tests():
    """Run all test suites"""
    print("\n" + "=" * 70)
    print("PARSER METHODS TEST SUITE")
    print("=" * 70)

    try:
        test_scene_management()
        test_parameters()
        test_utility_methods()
        test_noise()
        test_data_methods()
        test_tokenization()

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
