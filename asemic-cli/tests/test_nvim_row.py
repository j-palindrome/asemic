"""Per-row embedded-nvim editing (2026-10-11 design, supersedes whole-file `NvimView`-as-
`#cols`): `BlockColumns` stays the main UI (tree/folds/sliders/previews); nvim mode
swaps its `#line` row editor from `RowVimTextArea` to `NvimRowEditor`
(`asemic_py/nvim_view.py`), editing only the focused row -- 1 shared headless nvim for the
whole app, a scratch buffer per row. Pure harness (`BlockColumns` alone, no zenoh/brain),
mirroring `tests/test_vim_modes.py`/`test_fold_peek.py`'s precedent. Skips cleanly if nvim/
pynvim are missing."""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from textual.app import App, ComposeResult

pynvim = pytest.importorskip("pynvim")

from asemic_py.blocks import Doc
from asemic_py.app import TreeNavApp
from asemic_py.columns import BlockColumns
from asemic_py.nvim_server import socket_path
from asemic_py.nvim_view import NvimRowEditor, PUM_ROWS

pytestmark = pytest.mark.skipif(shutil.which("nvim") is None, reason="nvim not installed")

SRC = '''x = 1
y = 2
z = 3
'''


def _nvim_pids_for_socket(sock: Path) -> list[int]:
    try:
        out = subprocess.run(["pgrep", "-f", f"nvim --headless --listen {sock}"],
                              capture_output=True, text=True, timeout=5)
    except Exception:
        return []
    return [int(p) for p in out.stdout.split() if p.strip()]


@pytest.fixture
def scratch_file(tmp_path):
    f = tmp_path / "scratch.py"
    f.write_text(SRC)
    sock = socket_path(f)
    yield f
    for pid in _nvim_pids_for_socket(sock):
        try:
            os.kill(pid, 9)
        except ProcessLookupError:
            pass
    sock.unlink(missing_ok=True)


class _Harness(TreeNavApp):
    """`BlockColumns(nvim=True)` alone -- enough to drive the per-row nvim editor w/o the
    REPL/brain (same precedent as `test_vim_modes.py`'s `_Harness`)."""

    def __init__(self, path: Path) -> None:
        super().__init__()
        self.doc = Doc(path.read_text(), path=path)

    def compose(self) -> ComposeResult:
        yield BlockColumns(self.doc, id="cols", nvim=True)

    def on_mount(self) -> None:
        self.query_one("#cols", BlockColumns).line.focus()


async def _wait_attached(pilot, timeout: float = 10.0) -> BlockColumns:
    cols = pilot.app.query_one("#cols", BlockColumns)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if cols.line.nvim is not None:
            return cols
        await pilot.pause(0.1)
    raise AssertionError("nvim never attached to the row editor")


async def _wait_until(pilot, predicate, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        await pilot.pause(0.1)
    return False


@pytest.mark.asyncio
async def test_focused_row_renders_via_nvim(scratch_file):
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)

        def _grid_has_text() -> bool:
            text = "".join(ch for row in cols.line._grid for ch, _ in row)
            return "x = 1" in text

        ok = await _wait_until(pilot, _grid_has_text)
        assert ok, "".join(ch for row in cols.line._grid for ch, _ in row)


@pytest.mark.asyncio
async def test_ciw_then_enter_commits_row_and_file(scratch_file):
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)
        await pilot.pause(0.3)
        await pilot.press("escape")  # INSERT -> NORMAL (default start mode is INSERT)
        await pilot.press("0")  # cursor starts at `_load`'s doc-end; back to col 0 (native motion)
        await pilot.press("c", "i", "w", "f", "o", "o", "escape")
        ok = await _wait_until(pilot, lambda: cols.line.get_line(0) == "foo = 1")
        assert ok, cols.line.get_line(0)  # esc above committed
        await pilot.pause(0.3)
        assert scratch_file.read_text().splitlines()[0] == "foo = 1"
        assert cols.doc.rows(())[0].src == "foo = 1"


@pytest.mark.asyncio
async def test_normal_down_moves_to_next_row(scratch_file):
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)
        await pilot.pause(0.3)
        assert cols.cursor == 0
        await pilot.press("down")  # starts NORMAL
        ok = await _wait_until(pilot, lambda: cols.cursor == 1)
        assert ok, cols.cursor


@pytest.mark.asyncio
async def test_x_in_normal_deletes_char_natively(scratch_file):
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)
        await pilot.pause(0.3)
        await pilot.press("escape")  # INSERT -> NORMAL
        await pilot.press("0")  # cursor starts at `_load`'s doc-end; back to col 0 (native motion)
        await pilot.press("x")  # native nvim `x`, not a single-dispatch key
        ok = await _wait_until(pilot, lambda: cols.line.get_line(0) == " = 1")
        assert ok, cols.line.get_line(0)


@pytest.mark.asyncio
async def test_zM_folds_the_tree(scratch_file):
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)
        await pilot.pause(0.3)
        cols._foldlevel = 5  # start open, so zM closing to 0 is observable
        await pilot.press("escape")  # INSERT -> NORMAL
        await pilot.press("z", "M")
        ok = await _wait_until(pilot, lambda: cols._foldlevel == 0)
        assert ok, cols._foldlevel


@pytest.mark.asyncio
async def test_one_nvim_process_across_row_switches(scratch_file):
    """1 embedded nvim child per app (not per row, not a shared server): same session +
    same child pid across row switches."""
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)
        await pilot.pause(0.3)
        ed = cols.line
        first = ed.nvim
        kids = lambda: subprocess.run(["pgrep", "-P", str(os.getpid()), "nvim"], capture_output=True, text=True).stdout.split()
        assert len(kids()) == 1
        await pilot.press("escape", "down", "down", "up")
        await pilot.pause(0.3)
        assert cols.line.nvim is first
        assert len(kids()) == 1


@pytest.mark.asyncio
async def test_o_on_closed_row_creates_new_tree_row(scratch_file):
    """2026-10-11 "closed fold" redesign: a fresh row starts with the fold OPEN (default
    INSERT) -- closing it (Esc) makes `o`/`O`/dd/yy/p/P tree-level ops, like vim's own
    operator-on-a-closed-fold rule, regardless of cursor position inside the row."""
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)
        await pilot.pause(0.3)
        await pilot.press("escape")  # INSERT -> NORMAL: closes the fold (`_row_closed`)
        await pilot.press("o")  # closed-row `o` -> new tree row, not an in-row edit
        ok = await _wait_until(pilot, lambda: cols._new_at is not None)
        assert ok, "o on a closed row did not open a new tree-row slot"


@pytest.mark.asyncio
async def test_o_on_open_row_opens_line_inside_row(scratch_file):
    """`zo` reopens a closed row for native in-row editing (vim's own "open this fold");
    `o` there is then 100% native -- a new line inside this row, not a new tree row."""
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)
        await pilot.pause(0.3)
        await pilot.press("escape")  # INSERT -> NORMAL: closes the fold
        cols.line.set_row_text("one\ntwo\nthree")
        await pilot.pause(0.2)
        await pilot.press("z", "o")  # reopen the fold w/o entering INSERT
        assert not cols.line._row_closed
        await pilot.press("o")
        ok = await _wait_until(pilot, lambda: len(cols.line._lines) == 4)
        assert ok, cols.line._lines
        assert cols.cursor == 0  # stayed in the same tree row


@pytest.mark.asyncio
async def test_fast_enter_commits_authoritative_text(scratch_file):
    """`ihello<Esc>` immediately followed by Enter, no pause in between -- the commit must
    read the buffer authoritatively (`NvimRowEditor.sync_text`), not race the local cache's
    debounced `asemic_text` notification."""
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)
        await pilot.pause(0.3)
        await pilot.press("escape")
        await pilot.press("0")
        await pilot.press("i", "h", "e", "l", "l", "o", "escape", "enter")
        await pilot.pause(0.3)
        assert "hello" in cols.doc.rows(())[0].src


@pytest.mark.asyncio
async def test_zfj_wraps_rows_in_nvim_mode(scratch_file):
    """zf/zd/[z/]z are always tree-level (never affected by `_row_closed`) -- same
    `BlockColumns.fold_wrap_rows`/`fold_unwrap_block` as the default-mode `test_folds.py`."""
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)
        await pilot.pause(0.3)
        await pilot.press("escape")
        await pilot.press("0")
        before = cols.doc.code
        await pilot.press("z", "f", "j")  # wrap "x = 1" + "y = 2" into a block
        ok = await _wait_until(pilot, lambda: cols.rows[0].name == "block")
        assert ok, cols.rows
        await pilot.press("z", "d")
        ok = await _wait_until(pilot, lambda: cols.doc.code == before)
        assert ok, cols.doc.code


@pytest.mark.asyncio
async def test_editor_width_matches_content_width(scratch_file):
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)
        await pilot.pause(0.3)
        assert cols.line.cols == cols.line.content_size.width


@pytest.mark.asyncio
async def test_row_editor_grows_to_selected_row_capped_at_half_page(scratch_file):
    """The nvim row editor expands with the selected row's line count, capped at 1/2 page so a
    long multiline row never takes over the screen (J 2026-10-13)."""
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        cols = await _wait_attached(pilot)
        await pilot.pause(0.2)
        cols.line.set_row_text("one\ntwo")
        await pilot.pause(0.2)
        assert cols.line.rows == 2 + PUM_ROWS, cols.line.rows  # under the cap: row + popup slot
        cols.line.set_row_text("\n".join(f"l{i}" for i in range(40)))
        await pilot.pause(0.2)
        assert cols.line.rows == 12, cols.line.rows  # capped at 24 // 2
        assert cols.line.styles.height.value == 12  # widget actually rendered at the cap


@pytest.mark.asyncio
async def test_screenshot(scratch_file):
    app = _Harness(scratch_file)
    async with app.run_test(size=(80, 24)) as pilot:
        await _wait_attached(pilot)
        await pilot.pause(0.5)
        artifacts = Path(__file__).parent / "artifacts"
        artifacts.mkdir(exist_ok=True)
        app.save_screenshot(str(artifacts / "nvim_row.svg"))
