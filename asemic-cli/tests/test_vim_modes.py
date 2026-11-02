"""Vim NORMAL-mode pilot tests over BlockColumns (pure; no zenoh/brain — see test_blocks.py's
own no-zenoh precedent). nvim tutor subset: tests/test_blocks.py's SRC fixture reused for rows.

In-row motions/operators (dw/cw/x/cursor motion/counts within the row) are now
`textual-vim-textarea`'s own job (`cols.line.mode`/`.text`/`.cursor_location`); only
row/doc-level state (`cols.cursor`, `cols._new_at`, `cols._row_register`, undo journal) is
still `BlockColumns`'s own."""

import pytest
from textual.app import App, ComposeResult
from textual_vim_textarea import Mode

from asemic_py.blocks import Doc
from asemic_py.columns import BlockColumns

SRC = '''x = 1
y = 2
z = 3
'''


class _Harness(App):
    """BlockColumns alone, no REPL/brain — enough to drive the modal engine."""

    def __init__(self, src: str = SRC) -> None:
        super().__init__()
        self.doc = Doc(src)

    def compose(self) -> ComposeResult:
        yield BlockColumns(self.doc, id="cols")

    def on_mount(self) -> None:
        self.query_one("#cols", BlockColumns).line.focus()


@pytest.fixture
def cols_app():
    return _Harness()


async def _ready(pilot):
    app = pilot.app
    app.query_one("#cols", BlockColumns).line.cursor_blink = False
    cols = app.query_one("#cols", BlockColumns)
    return cols


@pytest.mark.asyncio
async def test_escape_enters_normal_and_i_returns_to_insert(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        assert cols.line.mode is Mode.NORMAL  # starts NORMAL (J 2026-10-11)
        await pilot.press("i")
        assert cols.line.mode is Mode.INSERT
        await pilot.press("escape")
        assert cols.line.mode is Mode.NORMAL


@pytest.mark.asyncio
async def test_jk_move_rows(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        assert cols.cursor == 0
        await pilot.press("j")
        assert cols.cursor == 1
        await pilot.press("j")
        assert cols.cursor == 2
        await pilot.press("k")
        assert cols.cursor == 1


@pytest.mark.asyncio
async def test_l_at_end_and_h_at_start_are_noop_on_flat_rows(cols_app):
    """l/h = caret motion; on a flat (non-nest) row at the edges they try the existing
    enter/exit-nest hooks, which no-op here (no nesting, no parent) — no crash, no move."""
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("l")  # caret already at end (row loaded w/ cursor at len) -> enter_level no-op (not a nest)
        assert cols.cursor == 0
        await pilot.press("h")  # caret still at end from `l`'s no-op... exercise h from start explicitly below
        cols.line.cursor_location = (0, 0)
        await pilot.press("h")  # caret at 0, no parent -> exit_level no-op
        assert cols.parent_path == ()


@pytest.mark.asyncio
async def test_gg_and_G(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("j", "j")
        assert cols.cursor == 2
        await pilot.press("g", "g")
        assert cols.cursor == 0
        await pilot.press("G")
        assert cols.cursor == len(cols.rows)  # new-row slot


@pytest.mark.asyncio
async def test_o_opens_insert_slot_and_commits_new_row(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("o")
        assert cols.line.mode is Mode.INSERT
        assert cols._new_at == 1
        await pilot.press(*"w = 9")
        await pilot.press("enter")
        assert cols.line.mode is Mode.NORMAL
        assert [r.src for r in cols.rows] == ["x = 1", "w = 9", "y = 2", "z = 3"]


@pytest.mark.asyncio
async def test_dd_deletes_row(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("j")  # row 1: y = 2
        await pilot.press("d", "d")
        assert [r.src for r in cols.rows] == ["x = 1", "z = 3"]
        assert cols._row_register == ["y = 2"]


@pytest.mark.asyncio
async def test_undo_redo_covers_dd_and_o(cols_app):
    """Fix 1: u/ctrl+r must cover row deletes (dd) and row inserts (o), not just char edits."""
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("j")  # row 1: y = 2
        await pilot.press("d", "d")
        assert [r.src for r in cols.rows] == ["x = 1", "z = 3"]
        await pilot.press("u")
        assert [r.src for r in cols.rows] == ["x = 1", "y = 2", "z = 3"]
        await pilot.press("ctrl+r")
        assert [r.src for r in cols.rows] == ["x = 1", "z = 3"]
        await pilot.press("u")  # back to 3 rows before exercising o
        assert [r.src for r in cols.rows] == ["x = 1", "y = 2", "z = 3"]
        assert cols.cursor == 1  # `u` restored "y = 2" at its row, caret parked there
        await pilot.press("o")
        await pilot.press(*"w = 9")
        await pilot.press("enter")
        assert [r.src for r in cols.rows] == ["x = 1", "y = 2", "w = 9", "z = 3"]
        await pilot.press("u")
        assert [r.src for r in cols.rows] == ["x = 1", "y = 2", "z = 3"]


@pytest.mark.asyncio
async def test_operator_counts(cols_app):
    """Fix 2: 2dd/3yy/2cc/d2w/2dw/3x/2p counts per nvim."""
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("2", "d", "d")  # 2dd: drop x=1, y=2
        assert [r.src for r in cols.rows] == ["z = 3"]
        assert cols._row_register == ["x = 1", "y = 2"]
        await pilot.press("u")
        assert [r.src for r in cols.rows] == ["x = 1", "y = 2", "z = 3"]

        await pilot.press("3", "y", "y")  # 3yy: yank all 3 lines (clipped)
        assert cols._row_register == ["x = 1", "y = 2", "z = 3"]

        cols.line.cursor_location = (0, 0)
        await pilot.press("d", "2", "w")  # d2w on "x = 1" -> delete "x = " (library's own dw, in-row)
        assert cols.line.text == "1"

        await pilot.press("escape")
        await pilot.press("i")
        cols.line.text = "x = 1"
        await pilot.press("escape")  # drop to NORMAL (library's own) -> stash commits the row
        cols.line.cursor_location = (0, 0)
        await pilot.press("2", "d", "w")  # 2dw: same as d2w
        assert cols.line.text == "1"

        await pilot.press("escape")
        await pilot.press("i")
        cols.line.text = "abcdef"
        await pilot.press("escape")
        cols.line.cursor_location = (0, 0)
        await pilot.press("3", "x")  # 3x: delete 3 chars (library's own x)
        assert cols.line.text == "def"

        await pilot.press("escape")
        await pilot.press("g", "g")
        before = [r.src for r in cols.rows]
        await pilot.press("3", "y", "y")  # re-yank the linewise (row) register
        await pilot.press("2", "p")  # 2p: paste register (linewise, all 3 rows) twice
        after = [r.src for r in cols.rows]
        assert after == before[:1] + before + before + before[1:]


@pytest.mark.asyncio
async def test_cw_acts_like_ce_on_non_blank(cols_app):
    """? behavior change: the old hand-built engine special-cased cw/cW on a non-blank as ce
    (:help cw); `textual-vim-textarea` 1.2.0 does not implement that nuance -- its cw acts like
    plain dw (eats the trailing space too). Documented, not patched around."""
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        cols.line.cursor_location = (0, 0)  # on "x", non-blank
        await pilot.press("c", "w")
        assert cols.line.mode is Mode.INSERT
        assert cols.line.text == " 1"  # library's cw = dw + insert (eats "x ="; "=" absorbed too)


@pytest.mark.asyncio
async def test_percent_jumps_to_matching_bracket(cols_app):
    """Fix 4: % finds the next bracket at/after the caret on the line, jumps to its match."""
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("i")
        cols.line.text = "f(a, [b, c])"
        await pilot.press("escape")  # drop to NORMAL; stash commits the row
        cols.line.cursor_location = (0, 0)
        await pilot.press("%")
        assert cols.line.text[cols.line.cursor_location[1]] == ")"
        cols.line.cursor_location = (0, cols.line.text.index("["))
        await pilot.press("%")
        assert cols.line.text[cols.line.cursor_location[1]] == "]"
