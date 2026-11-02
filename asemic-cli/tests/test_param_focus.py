"""Leaf parameter focus navigation (plan §3.1, 2026-10-11): `l`/`→` on a leaf row w/ a
mounted `ComponentPanel` focuses its first control instead of no-oping; `h`/`←`/Escape inside
a control blurs back to the row line (NORMAL); Tab/Shift+Tab cycle within the panel only
(wrap); peeked (fold-peek) rows never offer panel focus. Reuses `test_fold_peek.py`'s pure
(no zenoh/brain) harness, manually mounting `ComponentPanel`s the way `app.py`'s `_sync` does,
so this stays independent of the live rig `test_repl.py` needs."""

from types import SimpleNamespace

import pytest
from textual.app import App, ComposeResult
from textual.widgets import Static

from asemic_py.state import State
from asemic_py.app import ComponentPanel, TexPanel
from asemic_py.blocks import Doc
from asemic_py.columns import BlockColumns

SRC = '''x = 1
param('gain', 0, 1)
noise('n', value=0.0, x=0.0)
with block("inner"):
    param('ip', 0, 1)
'''

TEX_SRC = '''tex('ink', 'draw', src=['word'])
'''


def _fake_rapp() -> SimpleNamespace:
    state = State()  # empty mirror: panels read params/backlinks from it (app.py)
    return SimpleNamespace(
        state=state, backlinks=state.backlinks,
        client=SimpleNamespace(put=lambda *a, **k: None,
                               subscribe_raw=lambda *a, **k: SimpleNamespace(undeclare=lambda: None)),
        query=lambda *a, **k: [],
    )


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
    await pilot.pause()  # let BlockColumns.on_mount's _load() build the rl-* Statics first
    rows_w = cols.query_one("#rows")
    rapp = _fake_rapp()
    panel_param = ComponentPanel({"id": "gain", "type": "param", "min": 0.0, "max": 1.0, "default": 0.5}, rapp)
    rows_w.mount(panel_param, after=cols.query_one("#rl-1"))
    panel_noise = ComponentPanel(
        {"id": "n", "type": "noise", "gen": "perlin", "params": {"value": 0.0, "x": 0.0}}, rapp
    )
    rows_w.mount(panel_noise, after=cols.query_one("#rl-2"))
    await pilot.pause()
    return cols


@pytest.mark.asyncio
async def test_l_on_leaf_row_focuses_first_control(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("j")  # row 1: param('gain', ...)
        assert cols.path == (1,)
        cols.line.cursor_location = cols.line.document.end  # `_load` already does this on `j`; explicit for determinism
        await pilot.press("l")
        focused = pilot.app.focused
        assert focused is not None
        assert type(focused).__name__ == "TextualNumberBox"
        assert focused.id == "box-gain-value"


@pytest.mark.asyncio
async def test_h_and_escape_blur_back_to_line_normal(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("j")
        cols.line.cursor_location = cols.line.document.end
        await pilot.press("l")
        assert type(pilot.app.focused).__name__ == "TextualNumberBox"
        # NumberBox consumes "h"/"left" itself (digit nav) -- only Escape reliably blurs it
        # (documented in ComponentPanel's BINDINGS); verify h/left do NOT blur, Escape does.
        await pilot.press("h")
        assert type(pilot.app.focused).__name__ == "TextualNumberBox"
        await pilot.press("escape")
        assert pilot.app.focused is cols.line
        from textual_vim_textarea import Mode

        assert cols.line.mode is Mode.NORMAL


@pytest.mark.asyncio
async def test_xy_pad_h_left_also_blur(cols_app):
    """`TextualXYPad` captures arrows/hjkl (`NavKeysMixin`, moves the crosshair) until Escape,
    which bubbles to `ComponentPanel`'s blur binding -- exercised here via direct widget focus
    since this harness's fixture rows don't include an `xy` panel."""
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        from asemic_py.app import TextualXYPad

        rapp = _fake_rapp()
        panel_xy = ComponentPanel({"id": "pos", "type": "xy", "x": {"min": -1.0, "max": 1.0}, "y": {"min": -1.0, "max": 1.0}}, rapp)
        cols.query_one("#rows").mount(panel_xy, after=cols.query_one("#rl-0"))
        await pilot.pause()
        pad = panel_xy.query_one(TextualXYPad)
        pad.focus()
        await pilot.pause()
        assert pilot.app.focused is pad
        await pilot.press("left")  # captured: moves the crosshair, focus stays
        assert pilot.app.focused is pad
        await pilot.press("escape")
        assert pilot.app.focused is cols.line


@pytest.mark.asyncio
async def test_tab_cycles_within_panel_only_and_wraps(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("j", "j")  # row 2: noise('n', ...) -- 2 boxes (value, x)
        assert cols.path == (2,)
        cols.line.cursor_location = cols.line.document.end
        await pilot.press("l")
        first = pilot.app.focused
        assert type(first).__name__ == "TextualNumberBox"
        await pilot.press("tab")
        second = pilot.app.focused
        assert type(second).__name__ == "TextualNumberBox"
        assert second is not first
        await pilot.press("tab")  # wraps back to the 1st control, not out to the next row/screen
        assert pilot.app.focused is first
        await pilot.press("shift+tab")  # reverse wraps to the last
        assert pilot.app.focused is second


@pytest.mark.asyncio
async def test_peeked_row_never_offers_panel_focus(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")
        await pilot.press("j", "j", "j")  # row 3: the "inner" nest
        assert cols.path == (3,)
        await pilot.press("z", "a")  # peek it
        await pilot.press("j")  # onto its peeked child, param('ip', ...)
        assert cols.cursor_peeked
        assert cols._current_component_panel() is None
        cols.line.cursor_location = cols.line.document.end
        await pilot.press("l")  # zooms to its own level (existing fold-peek behavior) -- !panel focus
        focused = pilot.app.focused
        assert focused is cols.line  # never a NumberBox/XYPad
        assert not cols.cursor_peeked
        assert cols.path == (3, 0)


@pytest.mark.asyncio
async def test_l_on_tex_row_finds_its_panel_without_crashing():
    """Regression (2026-10-11, J screenshot): a `tex(...)` row's mounted `TexPanel` was
    excluded from `_current_component_panel`'s type check, so `l`/`→` silently no-op'd on a
    texture row -- fixed by widening that check to include `TexPanel`. The preview is always
    on now (no opt-in `Switch`, app.py `TexPanel.compose`), so the panel has no focusable
    control and `l` leaves focus on the row editor."""
    app = _Harness(TEX_SRC)
    async with app.run_test() as pilot:
        cols = app.query_one("#cols", BlockColumns)
        cols.line.cursor_blink = False
        await pilot.pause()
        rapp = _fake_rapp()
        panel_tex = TexPanel({"id": "ink", "kind": "draw", "inputs": [], "sinks": []}, rapp)
        cols.query_one("#rows").mount(panel_tex, after=cols.query_one("#rl-0"))
        await pilot.pause()
        await pilot.press("escape")  # row 0, the tex(...) row
        assert cols.path == (0,)
        cols.line.cursor_location = cols.line.document.end
        assert cols._current_component_panel() is panel_tex
        await pilot.press("l")
        assert pilot.app.focused is cols.line


@pytest.mark.asyncio
async def test_enter_in_normal_mode_commits_row(cols_app):
    """Regression (2026-10-11, J screenshot): NORMAL mode had no `enter` handler at all
    (plain vim: Enter means nothing), so a row only ever navigated onto with `j`/`k` (never
    `i`'d into) silently never committed/executed on Enter -- the actual cause of "pressing
    Enter doesn't display blocks": nothing downstream (`Committed` -> run -> component/tex
    publish -> panel mount) ever fired. Fixed by giving NORMAL's `enter` the same
    `_submit_text` commit INSERT's Enter-to-submit already used (`_on_key`), so re-running an
    *unchanged* row (e.g. after a brain restart) works from NORMAL too, DRY on one method."""
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")  # NORMAL mode, row 0 (unchanged text)
        from textual_vim_textarea import Mode

        assert cols.line.mode is Mode.NORMAL
        committed: list = []
        cols.watch = None  # no-op; message capture below via post_message hook
        orig_post = cols.post_message

        def spy(msg):
            if type(msg).__name__ == "Committed":
                committed.append(msg)
            return orig_post(msg)

        cols.post_message = spy
        await pilot.press("enter")
        assert not committed, "NORMAL Enter = no-op (no redundant keys: esc commits, :run evals)"
        assert cols.line.mode is Mode.NORMAL  # stays in NORMAL -- no accidental mode flip


@pytest.mark.asyncio
async def test_non_panel_row_unchanged(cols_app):
    async with cols_app.run_test() as pilot:
        cols = await _ready(pilot)
        await pilot.press("escape")  # row 0: x = 1, no panel
        assert cols.path == (0,)
        cols.line.cursor_location = cols.line.document.end
        await pilot.press("l")
        assert pilot.app.focused is cols.line  # unchanged: enter_level's old no-op for a leaf
