"""Diagnose arrow-key bug after clickable link navigation (goto_comp) and jumplist (ctrl+o/i).

After jumping between blocks via component links or jumplist, arrow keys (up/down/left/right)
stop working on the row line. Tests record the focused widget, cursor state, and line
properties at failure point to identify root cause.
"""

import asyncio
import time
from pathlib import Path

import pytest

from asemic_py.app import AsemicApp
from asemic_py.client import Client
from asemic_py.columns import BlockColumns


FIXTURE_CODE = '''
with block("controls", loop="loop"):
    with block("noise"):
        noise("chaos_lfo", "lfo")
    param("gain", 0, 1, default=0.5)

with block("drawing"):
    proc("word", "glyph", text="ASEMIC")
'''


def _load_startup_code() -> str:
    """Nav-test fixture: a deep component (controls.noise.chaos_lfo), a flat param (gain),
    and a single-row level (drawing.word) -- enough shape to exercise goto_comp/arrow/jumplist
    without depending on any particular example's content (purely a TUI-mechanics test)."""
    return FIXTURE_CODE


@pytest.fixture
def app():
    """AsemicApp with startup.py code, no brain/zenoh needed."""
    code = _load_startup_code()
    return AsemicApp(client=Client(), code=code)


async def _ready(pilot):
    """Setup: disable cursor blink, return BlockColumns."""
    app = pilot.app
    cols = app.query_one("#cols", BlockColumns)
    cols.line.cursor_blink = False
    return cols


async def settle(pilot, cond, timeout=3.0):
    """Wait for a condition with timeout."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        await pilot.pause(0.05)
        if cond():
            return True
    return False


@pytest.mark.asyncio
async def test_arrow_after_goto_comp_deep(app):
    """Goto a deep component (controls.noise.chaos_lfo), then test arrow keys."""
    async with app.run_test(size=(140, 40)) as pilot:
        cols = await _ready(pilot)

        # Navigate to deep component via goto_comp
        app.action_goto_comp("chaos_lfo")
        await pilot.pause(0.1)

        # Record state after jump
        focused_after_jump = app.focused
        parent_path_after_jump = cols.parent_path
        cursor_after_jump = cols.cursor
        visible_count = len(cols.visible)

        print(
            f"After goto_comp(chaos_lfo):\n"
            f"  focused: {focused_after_jump}\n"
            f"  parent_path: {parent_path_after_jump}\n"
            f"  cursor: {cursor_after_jump}\n"
            f"  visible rows: {visible_count}\n"
            f"  line.read_only: {cols.line.read_only}\n"
            f"  cursor_peeked: {cols.cursor_peeked}\n"
        )

        # Move down first to get away from position 0
        if visible_count > 1:
            await pilot.press("down")
            await pilot.pause(0.05)
            cursor_after_down = cols.cursor
            print(f"After down: cursor={cursor_after_down}")

            # Now test up arrow from non-zero position
            await pilot.press("up")
            await pilot.pause(0.05)
            cursor_after_up = cols.cursor
            focused_after_up = app.focused

            print(
                f"After up arrow (from cursor={cursor_after_down}):\n"
                f"  cursor: {cursor_after_up} (should be {cursor_after_down - 1})\n"
                f"  focused: {focused_after_up}\n"
                f"  line.read_only: {cols.line.read_only}\n"
            )

            # Arrow should move cursor back
            assert (
                cursor_after_up == cursor_after_down - 1
            ), f"up arrow should move back; got {cursor_after_up}, was {cursor_after_down}"

        # Test left arrow (should attempt enter_level)
        await pilot.press("left")
        await pilot.pause(0.05)
        # Just check no crash and state is consistent
        assert cols.parent_path is not None


@pytest.mark.asyncio
async def test_arrow_after_goto_comp_single_row(app):
    """Goto a single-row level (drawing.drawing.word), test arrows."""
    async with app.run_test(size=(140, 40)) as pilot:
        cols = await _ready(pilot)

        # Navigate to a single-row level
        app.action_goto_comp("word")
        await pilot.pause(0.1)

        focused_after_jump = app.focused
        parent_path_after_jump = cols.parent_path
        cursor_after_jump = cols.cursor
        line_focused = cols.line.has_focus

        print(
            f"After goto_comp(word) [single row level]:\n"
            f"  focused: {focused_after_jump}\n"
            f"  parent_path: {parent_path_after_jump}\n"
            f"  cursor: {cursor_after_jump}\n"
            f"  line has focus: {line_focused}\n"
            f"  line.read_only: {cols.line.read_only}\n"
        )

        # Try arrow key
        await pilot.press("up")
        await pilot.pause(0.05)

        print(f"After up arrow on single-row level:")
        print(f"  cursor: {cols.cursor}")
        print(f"  line.has_focus: {cols.line.has_focus}")
        print(f"  focused widget: {app.focused}")


@pytest.mark.asyncio
async def test_arrow_after_ctrl_o(app):
    """Navigate forward, then ctrl+o back, test arrows."""
    async with app.run_test(size=(140, 40)) as pilot:
        cols = await _ready(pilot)

        # First navigation
        app.action_goto_comp("chaos_lfo")
        await pilot.pause(0.1)

        # Record state after first jump
        state_after_first = (cols.parent_path, cols.cursor)

        # Second navigation
        app.action_goto_comp("word")
        await pilot.pause(0.1)

        state_after_second = (cols.parent_path, cols.cursor)

        # Jump back with ctrl+o
        await pilot.press("ctrl+o")
        await pilot.pause(0.1)

        state_after_ctrl_o = (cols.parent_path, cols.cursor)

        print(
            f"After first goto(chaos_lfo): {state_after_first}\n"
            f"After second goto(word): {state_after_second}\n"
            f"After ctrl+o: {state_after_ctrl_o}\n"
            f"Line focus: {cols.line.has_focus}\n"
            f"Focused widget: {app.focused}\n"
        )

        # ctrl+o should restore previous position
        assert (
            state_after_ctrl_o == state_after_first
        ), f"ctrl+o should jump back to first position"

        # Now test arrow
        await pilot.press("up")
        await pilot.pause(0.05)

        cursor_after_up = cols.cursor

        print(f"After up arrow following ctrl+o: cursor={cursor_after_up}")


@pytest.mark.asyncio
async def test_arrow_after_ctrl_i(app):
    """Navigate forward, back with ctrl+o, then forward again with ctrl+i, test arrows."""
    async with app.run_test(size=(140, 40)) as pilot:
        cols = await _ready(pilot)

        # First navigation
        app.action_goto_comp("chaos_lfo")
        await pilot.pause(0.1)

        state_after_first = (cols.parent_path, cols.cursor)

        # Second navigation
        app.action_goto_comp("word")
        await pilot.pause(0.1)

        state_after_second = (cols.parent_path, cols.cursor)

        # Jump back with ctrl+o
        await pilot.press("ctrl+o")
        await pilot.pause(0.1)

        # Jump forward with ctrl+i
        await pilot.press("ctrl+i")
        await pilot.pause(0.1)

        state_after_ctrl_i = (cols.parent_path, cols.cursor)

        print(
            f"After first goto: {state_after_first}\n"
            f"After second goto: {state_after_second}\n"
            f"After ctrl+o: jumped back\n"
            f"After ctrl+i: {state_after_ctrl_i}\n"
            f"Line focus: {cols.line.has_focus}\n"
            f"Focused widget: {app.focused}\n"
        )

        # ctrl+i should restore second position
        assert (
            state_after_ctrl_i == state_after_second
        ), f"ctrl+i should jump forward to second position"

        # Now test arrow
        await pilot.press("down")
        await pilot.pause(0.05)

        cursor_after_down = cols.cursor

        print(f"After down arrow following ctrl+i: cursor={cursor_after_down}")


@pytest.mark.asyncio
async def test_arrow_after_multiple_rapid_navs(app):
    """Multiple rapid navigations via goto_comp, then test arrows."""
    async with app.run_test(size=(140, 40)) as pilot:
        cols = await _ready(pilot)

        # Rapid series of navigations
        navs = ["chaos_lfo", "word", "gain", "chaos_lfo", "word"]
        for nav_id in navs:
            app.action_goto_comp(nav_id)
            await pilot.pause(0.05)

        print(
            f"After {len(navs)} rapid navigations:\n"
            f"  parent_path: {cols.parent_path}\n"
            f"  cursor: {cols.cursor}\n"
            f"  line.has_focus: {cols.line.has_focus}\n"
            f"  focused widget: {app.focused}\n"
            f"  visible rows: {len(cols.visible)}\n"
        )

        # Move down
        await pilot.press("down")
        await pilot.pause(0.05)
        cursor_after_down = cols.cursor

        print(f"After down: cursor={cursor_after_down}")

        # Move up
        await pilot.press("up")
        await pilot.pause(0.05)
        cursor_after_up = cols.cursor

        print(
            f"After up: cursor={cursor_after_up}\n"
            f"  Expected: {cursor_after_down - 1}\n"
            f"  Match: {cursor_after_up == cursor_after_down - 1}\n"
        )

        # At least one should have moved
        assert (
            cursor_after_down != cols.cursor or cursor_after_up != cursor_after_down
        ), "arrows should move cursor at some point"


@pytest.mark.asyncio
async def test_arrow_after_goto_comp_in_normal_mode(app):
    """Navigate via goto_comp while in NORMAL mode, then test arrows."""
    async with app.run_test(size=(140, 40)) as pilot:
        cols = await _ready(pilot)

        # Enter NORMAL mode first
        await pilot.press("escape")
        await pilot.pause(0.05)

        from textual_vim_textarea import Mode
        assert cols.line.mode is Mode.NORMAL, "Should be in NORMAL mode"

        # Navigate via goto_comp
        app.action_goto_comp("chaos_lfo")
        await pilot.pause(0.1)

        print(
            f"After goto_comp in NORMAL mode:\n"
            f"  line.mode: {cols.line.mode}\n"
            f"  line.has_focus: {cols.line.has_focus}\n"
            f"  focused widget: {app.focused}\n"
            f"  cursor: {cols.cursor}\n"
            f"  visible rows: {len(cols.visible)}\n"
        )

        # Test down arrow
        await pilot.press("down")
        await pilot.pause(0.05)
        cursor_after_down = cols.cursor

        print(f"After down in NORMAL mode: cursor={cursor_after_down}")

        # Test up arrow
        await pilot.press("up")
        await pilot.pause(0.05)
        cursor_after_up = cols.cursor

        print(f"After up in NORMAL mode: cursor={cursor_after_up}")

        # Should have moved
        visible_count = len(cols.visible)
        if visible_count > 1:
            assert (
                cursor_after_down != 0 or cursor_after_up != 0
            ), f"arrows should move cursor in NORMAL mode"
