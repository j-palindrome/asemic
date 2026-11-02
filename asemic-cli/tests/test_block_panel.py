"""Block preview panel (J 2026-10-12): every `block(...)` nest row exposes its timing as a
`timestretch` number parameter (a `BlockPanel`), replacing the old global `▶`/`⏸` glyph and
NORMAL `<Space>` toggle (`AsemicApp._place_blocks` mounts one under each nest row). Pure, no
zenoh/brain: mirrors `test_param_focus.py`'s manual mounting of `app.py` panels into the row's
own `RowBox`, so it stays independent of the live rig.
"""

import pytest
from textual.app import App, ComposeResult

from asemic_py.app import BlockPanel, TreeNavApp
from asemic_py.blocks import Doc
from asemic_py.columns import BlockColumns
from asemic_py.lib.textual_number_box import TextualNumberBox as NumberBox
from asemic_py.lib.textual_choice_input import TextualChoiceInput

SRC = '''with block("a", timestretch="1.0"):
    x = 1
with block("b"):
    y = 2
'''


class _Harness(App):
    """Hosts a `BlockColumns` + records `BlockPanel` callbacks (no brain)."""

    def __init__(self, src: str = SRC) -> None:
        super().__init__()
        self.doc = Doc(src)
        self.calls: list[tuple[tuple[int, ...], float]] = []
        self.loop_calls: list[tuple[tuple[int, ...], str]] = []

    def compose(self) -> ComposeResult:
        yield BlockColumns(self.doc, id="cols")

    def action_set_timestretch(self, path, value) -> None:
        self.calls.append((tuple(path), float(value)))

    def action_set_block_loop(self, path, value) -> None:
        self.loop_calls.append((tuple(path), str(value)))

    def on_mount(self) -> None:
        self.query_one("#cols", BlockColumns).line.focus()


@pytest.fixture
def app():
    return _Harness()


async def test_block_panel_per_nest_row(app):
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause(0.1)
        cols = app.query_one("#cols", BlockColumns)
        # depth-0 rows: 2 nests ("a", "b"), no leaves
        assert [r.name for r in cols.rows] == ["a", "b"]
        for i, r in enumerate(cols.rows):
            cols.row_box(i).mount(BlockPanel(r, app, id=f"block-{i}"))
        await pilot.pause(0.1)

        panels = list(app.query(BlockPanel))
        assert [p.row.name for p in panels] == ["a", "b"]
        a, b = panels
        assert a.box.value == 1.0 and b.box.value == 0.0  # effective timestretch
        assert "playing" in a._title() and "frozen" in b._title()

        # editing the box writes through to the app (which owns doc + brain)
        a.box._set_value(0.0)
        assert app.calls == [((0,), 0.0)]


class _NavHarness(TreeNavApp):
    """Adds the window-level arrow bindings so `→`/`⇧→` dispatch like the real app."""

    def __init__(self, src: str = SRC) -> None:
        super().__init__()
        self.doc = Doc(src)

    def compose(self) -> ComposeResult:
        yield BlockColumns(self.doc, id="cols")


async def test_shift_right_focuses_controls_arrows_nav_levels():
    app = _NavHarness()
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause(0.1)
        cols = app.query_one("#cols", BlockColumns)
        cols.line.focus()
        for i, r in enumerate(cols.rows):
            cols.row_box(i).mount(BlockPanel(r, app, id=f"block-{i}"))
        await pilot.pause(0.1)

        # regular → = tree nav: enters the block's child level (never focuses controls)
        await pilot.press("right")
        await pilot.pause(0.1)
        assert cols.parent_path == (0,)
        assert app.focused is cols.line
        # regular ← / ⇧← = back out one level
        await pilot.press("shift+left")
        await pilot.pause(0.1)
        assert cols.parent_path == ()
        # ⇧→ = the row's own controls (the block's timestretch box), stays at this level
        await pilot.press("shift+right")
        await pilot.pause(0.1)
        assert isinstance(app.focused, NumberBox)
        assert cols.parent_path == ()
        # Escape blurs back to the row line
        await pilot.press("escape")
        await pilot.pause(0.1)
        assert app.focused is cols.line
        # Tab = iOS-friendly alias of ⇧→
        await pilot.press("tab")
        await pilot.pause(0.1)
        assert isinstance(app.focused, NumberBox)


async def test_loop_field_is_choice_input_with_enum_autocomplete(app):
    """The LOOP field is a `TextualChoiceInput` (J 2026-10-13: no `Select`) -- a text
    input whose dropdown autocompletes the enum; Tab accepts the highlighted option."""
    async with app.run_test(size=(80, 30)) as pilot:
        await pilot.pause(0.1)
        cols = app.query_one("#cols", BlockColumns)
        for i, r in enumerate(cols.rows):
            cols.row_box(i).mount(BlockPanel(r, app, id=f"block-{i}"))
        await pilot.pause(0.1)
        a = list(app.query(BlockPanel))[0]
        fi = a.loop_input
        assert isinstance(fi, TextualChoiceInput)
        assert fi.value == "loop" and list(fi.options) == ["off", "loop", "pingpong"]

        # type a prefix -> the dropdown narrows to the matching enum, Tab accepts it
        fi.focus()
        await pilot.pause(0.1)
        await pilot.press("p", "i")
        await pilot.pause(0.1)
        assert [o.id for o in fi._list.options] == ["pingpong"]
        await pilot.press("tab")
        await pilot.pause(0.1)
        assert fi.value == "pingpong"
        assert app.loop_calls == [((0,), "pingpong")]


async def test_choice_input_string_field_allows_free_text():
    """No `options` -> the same widget is a plain string field: free text, no dropdown,
    committed on Enter."""
    from textual.app import App, ComposeResult

    got: list[str] = []

    class H(App):
        def compose(self) -> ComposeResult:
            yield TextualChoiceInput("hi", label="TEXT", id="f", on_change=got.append)

    async with H().run_test(size=(40, 10)) as pilot:
        fi = pilot.app.query_one("#f", TextualChoiceInput)
        fi.focus()
        await pilot.pause(0.1)
        assert not fi._list.display  # nothing to suggest
        fi.input.value = "hello world"
        await pilot.press("enter")
        await pilot.pause(0.1)
        assert fi.value == "hello world" and got == ["hello world"]


