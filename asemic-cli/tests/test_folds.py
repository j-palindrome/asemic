"""Vim fold keys beyond `za` (`test_fold_peek.py`): `zA` (recursive toggle), `zR`/`zM`
(open/close all -- foldlevel max/0), `zr`/`zm` (foldlevel +/-1), `zj`/`zk` (next fold
start / previous fold end). Same pure harness as `test_fold_peek.py` (no zenoh/brain)."""

import pytest
from textual.app import App, ComposeResult

from asemic_py.blocks import Doc
from asemic_py.columns import BlockColumns

# 2 top-level nests ("inner", "other"), "inner" itself nests a 3rd ("deep") -- gives 2
# depth levels under root to step `zr`/`zm` across.
SRC = '''x = 1
with block("inner"):
    a = 1
    with block("deep"):
        c = 1
    b = 2
with block("other"):
    d = 1
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
    await pilot.press("escape")
    return cols


@pytest.mark.asyncio
async def test_zA_toggles_recursively(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("j")  # row 1: "inner"
        assert cols.path == (1,)
        await pilot.press("z", "A")
        # inner itself + its own nested nest ("deep") both expanded; "other"/"deep"'s
        # non-nest children are not fold-rows, so don't appear in `_expanded`
        assert cols._expanded == {(1,), (1, 1)}
        vis = [p for p, _, _ in cols.visible]
        assert vis == [(0,), (1,), (1, 0), (1, 1), (1, 1, 0), (1, 2), (2,), (3,)]
        await pilot.press("z", "A")
        assert cols._expanded == set()


@pytest.mark.asyncio
async def test_zR_opens_all(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("z", "R")
        assert cols._foldlevel == 2
        assert cols._expanded == {(1,), (1, 1), (2,)}


@pytest.mark.asyncio
async def test_zM_closes_all(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("z", "R")  # open first so zM has something to close
        await pilot.press("z", "M")
        assert cols._foldlevel == 0
        assert cols._expanded == set()


@pytest.mark.asyncio
async def test_zr_zm_step_across_2_levels(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        assert cols._foldlevel == 0
        assert cols._expanded == set()
        await pilot.press("z", "r")  # foldlevel 1: top-level nests open, "deep" still closed
        assert cols._foldlevel == 1
        assert cols._expanded == {(1,), (2,)}
        await pilot.press("z", "r")  # foldlevel 2: "deep" (nested inside "inner") opens too
        assert cols._foldlevel == 2
        assert cols._expanded == {(1,), (1, 1), (2,)}
        await pilot.press("z", "r")  # clamped at max depth present
        assert cols._foldlevel == 2
        await pilot.press("z", "m")  # back down 1
        assert cols._foldlevel == 1
        assert cols._expanded == {(1,), (2,)}
        await pilot.press("z", "m")
        assert cols._foldlevel == 0
        assert cols._expanded == set()
        await pilot.press("z", "m")  # clamped at 0
        assert cols._foldlevel == 0


@pytest.mark.asyncio
async def test_zj_moves_to_next_fold_start(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        assert cols.path == (0,)  # x = 1
        await pilot.press("z", "j")
        assert cols.path == (1,)  # "inner" -- next nest row below
        await pilot.press("z", "j")
        assert cols.path == (2,)  # "other"
        await pilot.press("z", "j")  # no nest row below "other" (only "y = 2") -- no-op
        assert cols.path == (2,)


@pytest.mark.asyncio
async def test_zk_moves_to_prev_fold_end(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("j", "j")  # row 2: "other"
        assert cols.path == (2,)
        await pilot.press("z", "k")
        assert cols.path == (1,)  # "inner" (collapsed -- its own row is its fold end)


@pytest.mark.asyncio
async def test_zk_skips_own_enclosing_fold(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("j")  # "inner"
        await pilot.press("z", "a")  # peek it open
        await pilot.press("j")  # onto its 1st peeked child, a = 1
        assert cols.path == (1, 0)
        await pilot.press("z", "k")  # previous block before "inner" itself -- none; no-op
        assert cols.path == (1, 0)


# ------------------------------------------------------------ zf/zd/zD/[z/]z (2026-10-11)

@pytest.mark.asyncio
async def test_zfj_wraps_2_rows_into_a_block(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        assert cols.path == (0,)  # x = 1
        await pilot.press("z", "f", "j")  # wrap this row + the next ("inner") into a block
        assert cols.rows[0].name == "block"
        children = cols.doc.rows((0,))
        assert [c.src for c in children] == ["x = 1", 'with block("inner"):']
        # "inner" (now the 2nd child) kept its own nested body untouched
        inner = children[1]
        assert inner.name == "inner"
        assert [r.src for r in cols.doc.rows((0, 1))] == ["a = 1", 'with block("deep"):', "b = 2"]


@pytest.mark.asyncio
async def test_zd_restores_the_original_text(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        before = cols.doc.code
        await pilot.press("z", "f", "j")
        await pilot.press("z", "d")
        assert cols.doc.code == before


@pytest.mark.asyncio
async def test_zD_flattens_nested_blocks(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("j")  # "inner" (nests "deep")
        assert cols.path == (1,)
        await pilot.press("z", "D")
        # "inner"'s own body (a=1, deep's body c=1, b=2) + "deep" both gone -- fully flat;
        # "other" is untouched (zD only recurses into the target block's own descendants)
        assert [r.src for r in cols.rows] == [
            "x = 1", "a = 1", "c = 1", "b = 2", 'with block("other"):', "y = 2",
        ]
        assert [r.name for r in cols.rows] == [None, None, None, None, "other", None]


@pytest.mark.asyncio
async def test_bracket_z_jumps_to_block_start_and_end(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("j")  # row 1: "inner"
        await pilot.press("]", "z")
        assert cols.path == (3,)  # last row at this level: "y = 2" ("inner"/"other" are rows 1/2)
        await pilot.press("[", "z")
        assert cols.path == (0,)  # first row at this level: x = 1
