"""Fold-peek (`za`): expand a nest row to show its children inline, read-only, under the
current level -- fast deep navigation (`l`/`→` on a peeked row zooms straight to its own
level, cursor on it) without leaving the column. Reuses `test_vim_modes.py`'s harness
(pure; no zenoh/brain)."""

import pytest
from textual.app import App, ComposeResult
from textual.widgets import Static
from textual_vim_textarea import Mode

from asemic_py.blocks import Doc
from asemic_py.columns import BlockColumns

SRC = '''x = 1
with block("inner"):
    a = 1
    b = 2
y = 2
'''


class _Harness(App):
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
    cols = app.query_one("#cols", BlockColumns)
    cols.line.cursor_blink = False
    return cols


@pytest.mark.asyncio
async def test_za_expands_and_collapses(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("j")  # row 1: the nest
        assert cols.path == (1,)
        assert cols._expanded == set()
        await pilot.press("z", "a")
        assert cols._expanded == {(1,)}
        # visible now interleaves the nest's 2 children right after it
        vis = cols.visible
        assert [p for p, _, _ in vis] == [(0,), (1,), (1, 0), (1, 1), (2,)]
        assert [d for _, _, d in vis] == [0, 0, 1, 1, 0]
        # cursor stayed on the nest row itself (toggling doesn't move it)
        assert cols.path == (1,)
        await pilot.press("z", "a")
        assert cols._expanded == set()
        assert [p for p, _, _ in cols.visible] == [(0,), (1,), (2,)]


@pytest.mark.asyncio
async def test_peeked_rows_mount_no_panels(cols_app):
    """Peeked rows render in a separate `rl-peek-*` id space from current-level `rl-{i}` rows
    -- `anchor_widget` (app.py's panel-mount hook) only ever matches the latter, so peeked
    rows never get a component/param/tex/view panel."""
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("j")
        await pilot.press("z", "a")
        rows_w = cols.query_one("#rows")
        ids = {w.id for w in rows_w.query(Static) if (w.id or "").startswith("rl-")}  # 1 per RowBox
        assert "rl-0" in ids and "rl-1" in ids and "rl-2" in ids
        assert "rl-peek-1-0" in ids and "rl-peek-1-1" in ids
        # the depth-0 ids are untouched by peeking (app.py's anchor_widget keys off these)
        assert cols.anchor_widget("component", "nonexistent") is None


@pytest.mark.asyncio
async def test_l_on_peeked_row_zooms_to_its_level(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("j")  # the nest row
        await pilot.press("z", "a")
        await pilot.press("j")  # onto the 1st peeked child, a = 1
        assert cols.cursor_peeked
        assert cols.path == (1, 0)
        await pilot.press("l")
        assert cols.parent_path == (1,)
        assert not cols.cursor_peeked
        assert cols.path == (1, 0)
        assert cols.line.text == "a = 1"


@pytest.mark.asyncio
async def test_typing_on_peeked_row_does_not_change_doc(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("j")
        await pilot.press("z", "a")
        await pilot.press("j")  # a = 1, peeked
        assert cols.cursor_peeked
        assert cols.line.read_only
        await pilot.press("i")
        await pilot.press(*"XXX")
        await pilot.press("escape")
        assert cols.doc.rows((1,))[0].src == "a = 1"
        await pilot.press("enter")  # NORMAL enter -> no-op; INSERT enter already handled above
        assert cols.doc.rows((1,))[0].src == "a = 1"


@pytest.mark.asyncio
async def test_za_recurses_on_peeked_nest(cols_app):
    src = '''with block("outer"):
    with block("inner"):
        a = 1
'''
    app = _Harness(src)
    async with app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("z", "a")  # expand outer
        assert cols._expanded == {(0,)}
        await pilot.press("j")  # onto peeked "inner" nest, depth 1
        assert cols.path == (0, 0)
        assert cols.cursor_peeked
        await pilot.press("z", "a")  # recurse: expand the peeked nest too
        assert cols._expanded == {(0,), (0, 0)}
        vis = cols.visible
        assert [p for p, _, _ in vis] == [(0,), (0, 0), (0, 0, 0)]
        assert [d for _, _, d in vis] == [0, 1, 2]
