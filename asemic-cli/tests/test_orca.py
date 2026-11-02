"""Orca adapter viewer (plan: asemic-tui-block-repl, §3; feedback-adapter-viewers): the orca row
view attaches to the one orca process the adapter's `[lifecycle] start` owns (tmux session
`asemic-orca`, adapters/orca/adapter.toml) — it never spawns or stops orca itself.

`PtyTerminal` (pyte does the VT100 emulation; this is glue, not a hand-rolled emulator) + the
column's `open_orca`/`on_pty_terminal_exited` lifecycle."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from textual.app import App

from asemic_py import columns as columns_mod
from asemic_py.blocks import Doc
from asemic_py.columns import BlockColumns
from asemic_py.orca_literal import crop_capture, crop_grid, layout_grids, orca_tui_origin, split_grid
from asemic_py.pty_terminal import PtyTerminal

ROOT = Path(__file__).resolve().parent.parent
ORCA_BIN = ROOT / "adapters" / "orca" / "orca-c" / "build" / "orca"
# Mirrors adapters/orca/adapter.toml's [view] (the brain-served manifest facts these tests fake,
# since BlockColumns here has no client to fetch them from live).
ORCA_SESSION = "asemic-orca"
FAKE_ORCA_VIEW = {"attach": f"tmux attach -t {ORCA_SESSION}", "session": ORCA_SESSION, "seed": "asemic.orca"}
pytestmark = pytest.mark.skipif(shutil.which("tmux") is None, reason="tmux not installed")


# ---------------------------------------------------------------- region layout (pure, §3.1)

def test_layout_grids_stacks_vertically_with_separator_and_padding():
    composed, layout = layout_grids([("a", "AB\nCD"), ("b", "XYZ")])
    assert composed == "AB.\nCD.\n...\nXYZ"  # 1 blank separator row, every row padded to max width
    assert layout == {"a": (0, 0, 2, 2), "b": (0, 3, 3, 1)}


def test_layout_grids_empty_and_single():
    assert layout_grids([]) == ("", {})
    composed, layout = layout_grids([("only", "..\n..")])
    assert composed == "..\n.."
    assert layout == {"only": (0, 0, 2, 2)}


def test_crop_grid_and_split_grid_invert_layout_grids():
    entries = [("a", "AB\nCD"), ("b", "X\nY\nZ")]
    composed, layout = layout_grids(entries)
    assert crop_grid(composed, layout["a"]) == "AB\nCD"
    assert crop_grid(composed, layout["b"]) == "X\nY\nZ"
    assert split_grid(composed, layout) == {"a": "AB\nCD", "b": "X\nY\nZ"}


def test_orca_tui_origin_centers_both_axes():
    # verified live, `tmux capture-pane -p -t asemic-orca`, 2026-10-10 (adapter's real orca-c
    # binary): sweeping pane width (grid_w=4) and pane height (grid_h=4) separately --
    # col = (ncol - grid_w) // 2 always; row = (nrow - grid_h - 4) // 2 always (the 4 = orca's
    # own status/ruler chrome folded into the vertical centering).
    assert orca_tui_origin(46, 10, 4, 4) == (21, 1)
    assert orca_tui_origin(30, 10, 4, 4) == (13, 1)
    assert orca_tui_origin(46, 20, 4, 4) == (21, 6)
    assert orca_tui_origin(46, 30, 4, 4) == (21, 11)


def test_crop_capture_slices_a_fake_pane_capture():
    # a fake `tmux capture-pane -p -e` string: 10-row, 20-col pane, composed grid 8x3 (2
    # regions stacked: rows 0-1 = region "a", row 2 = region "b", no separator here), centered
    # per orca_tui_origin.
    ox, oy = orca_tui_origin(20, 10, 8, 3)
    pad = " " * ox
    capture = "\n".join(
        ["header"] * oy
        + [pad + "AB......", pad + "CD......", pad + "XY......"]
        + ["footer"] * (10 - oy - 3)
    )
    layout = {"a": (0, 0, 2, 2), "b": (0, 2, 2, 1)}
    lines, col, w = crop_capture(capture, layout["a"], ncol=20, nrow=10, grid_w=8, grid_h=3)
    assert col == ox and w == 2
    assert [l[col : col + w] for l in lines] == ["AB", "CD"]
    lines, col, w = crop_capture(capture, layout["b"], ncol=20, nrow=10, grid_w=8, grid_h=3)
    assert [l[col : col + w] for l in lines] == ["XY"]


class _ColApp(App):
    def __init__(self, doc):
        super().__init__()
        self.doc = doc

    def compose(self):
        yield BlockColumns(self.doc)

    def check_action(self, action, parameters):
        if action == "quit" and self.query(PtyTerminal):
            return False
        return True


async def test_open_orca_without_session_notifies_and_mounts_nothing(monkeypatch, tmp_path):
    # No client -> BlockColumns never learns the orca adapter's [view] facts; open_orca must
    # treat that exactly like "adapter not running", regardless of any live tmux session.
    subprocess.run(["tmux", "kill-session", "-t", ORCA_SESSION], capture_output=True)
    d = Doc('orca("""\n....\n.D1.\n....\n....\n""")\n')
    app = _ColApp(d)
    async with app.run_test(size=(80, 24)) as pilot:
        col = app.query_one(BlockColumns)
        assert col._orca_view is None
        col.line.cursor_location = col.line.document.end
        await pilot.press("right")
        await pilot.pause(0.2)
        assert not app.query(PtyTerminal)
        assert col._orca_path is None


@pytest.mark.skipif(not ORCA_BIN.exists(), reason="orca adapter binary not built (adapters/orca/adapter.toml build)")
async def test_open_orca_with_session_attaches_via_tmux(monkeypatch, tmp_path):
    # Redirect the adapter dir to a scratch path so this test never touches the tracked
    # adapters/orca/asemic.orca (the real orca process' source of truth).
    monkeypatch.setattr(columns_mod, "ORCA_ADAPTER_DIR", tmp_path)
    subprocess.run(["tmux", "kill-session", "-t", ORCA_SESSION], capture_output=True)
    subprocess.run(
        ["tmux", "new-session", "-d", "-s", ORCA_SESSION, str(ORCA_BIN), "asemic.orca"],
        cwd=str(ROOT / "adapters" / "orca"), check=True,
    )
    try:
        d = Doc('orca("""\n....\n.D1.\n....\n....\n""")\n')
        app = _ColApp(d)
        async with app.run_test(size=(80, 24)) as pilot:
            col = app.query_one(BlockColumns)
            col._orca_view = dict(FAKE_ORCA_VIEW)  # stand in for a live brain fetch (no client here)
            col.line.cursor_location = col.line.document.end
            await pilot.press("right")
            for _ in range(20):
                await pilot.pause(0.1)
                if app.query(PtyTerminal):
                    break
            term = app.query_one(PtyTerminal)
            assert term.command == ["tmux", "attach", "-t", ORCA_SESSION]
            assert col._orca_path == (0,)
            await pilot.press("ctrl+q")  # forwarded to the tmux client (detaches; orca keeps running)
            for _ in range(30):
                await pilot.pause(0.1)
                if not app.query(PtyTerminal):
                    break
            assert not app.query(PtyTerminal)
            assert col._orca_path is None
            assert app.is_running
        # NB: not asserting the orca session survives closing the view here — pyte in this repo's
        # venv doesn't support the `private` kwarg real orca-c's DSR query triggers (pyte/pyte
        # upstream csi_dispatch vs Screen.report_device_status signature mismatch, pre-existing,
        # unrelated to adapter lifecycle), which can take the tmux server down with it (?).
    finally:
        subprocess.run(["tmux", "kill-session", "-t", ORCA_SESSION], capture_output=True)
