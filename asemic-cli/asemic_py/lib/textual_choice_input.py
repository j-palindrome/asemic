"""
textual_choice_input.py - the one Textual field for free-form strings *and* fixed
choices (enums).

J (2026-10-13) rejected `textual.widgets.Select`: a modal-ish picker that can't be
typed into and swallows the row's own key handling. This widget replaces it with a
plain editable `Input` that offers an autocomplete dropdown of the allowed values as
you type -- so a choice field is still a text field, and a plain string field (no
`options`) is just the same widget with nothing to suggest.

    yield TextualChoiceInput("loop", options=("off", "loop", "pingpong"), label="LOOP")
    yield TextualChoiceInput("hello world", label="TEXT")  # a string field

Keyboard (no mouse needed): ↓/↑ move the highlight, Tab/Enter accept it, Esc closes
the dropdown (a second Esc reaches the owning panel's own binding); free text is kept
unless `strict=True`, which snaps a bare value to the closest option on commit. The
widget posts `Changed` when the value is committed (accepted, submitted, or blurred).
"""

from __future__ import annotations

from typing import Callable, Iterable

from textual import events
from textual.app import ComposeResult
from textual.containers import Horizontal, Vertical
from textual.message import Message
from textual.widgets import Input, OptionList, Static
from textual.widgets.option_list import Option

__all__ = ["TextualChoiceInput"]


class TextualChoiceInput(Vertical):
    """`Input` + an autocomplete `OptionList` of `options`. The single component for
    string and choice (enum) fields; a plain string field is one with no `options`."""

    DEFAULT_CSS = """
    TextualChoiceInput { height: auto; width: auto; }
    TextualChoiceInput > Horizontal { height: 1; }
    TextualChoiceInput .choice-label { color: $text-muted; width: auto; padding: 0 1 0 0; }
    TextualChoiceInput .choice-input {
        width: 1fr; min-width: 8; height: 1; padding: 0 1;
        border: none; background: transparent;
    }
    TextualChoiceInput .choice-input:focus { background: #1a1a00; }
    TextualChoiceInput .choice-list {
        display: none; height: auto; max-height: 8;
        border: round $panel; margin: 0 0 0 1; padding: 0 1;
    }
    TextualChoiceInput .choice-list.shown { display: block; }
    """

    can_focus = False  # the inner Input is the focus stop (keeps `_panel_focusables` = [Input])

    class Changed(Message):
        """The value was committed (accepted / submitted / blurred)."""

        def __init__(self, field: "TextualChoiceInput", value: str) -> None:
            super().__init__()
            self.field = field
            self.value = value

    def __init__(
        self,
        value: str = "",
        *,
        options: Iterable[str] = (),
        label: str = "",
        placeholder: str = "",
        strict: bool = False,
        on_change: Callable[[str], None] | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(id=id, classes=classes)
        self.options: list[str] = list(options)
        self.label = label
        self.strict = strict
        self.on_change_cb = on_change
        self._committed = value
        # Textual classes starting with `-` are reserved (the DOM strips `-textual-compact`),
        # so the single-row styling is done in `DEFAULT_CSS` below: the default `Input` is a
        # 3-row tall-bordered box that overflows and is clipped to nothing inside this widget.
        self._input = Input(
            value=value,
            placeholder=placeholder or "|".join(self.options),
            classes="choice-input",
        )
        self._list = OptionList(classes="choice-list")
        self._list.can_focus = False  # keyboard is driven from here, the list never takes focus

    # -- composition -------------------------------------------------------------

    def compose(self) -> ComposeResult:
        with Horizontal():
            if self.label:
                yield Static(f"{self.label}:", classes="choice-label")
            yield self._input
        yield self._list

    def on_mount(self) -> None:
        self._refill(self._input.value)
        self._list.display = False

    # -- value access ------------------------------------------------------------

    @property
    def input(self) -> Input:
        """The editable half (the focus stop)."""
        return self._input

    @property
    def value(self) -> str:
        return self._input.value

    @value.setter
    def value(self, v: str) -> None:
        self.set_value(v)

    def set_value(self, v: str) -> None:
        """Update the text without emitting `Changed` (used by external sync)."""
        self._committed = str(v)
        self._input.value = str(v)

    @property
    def has_focus(self) -> bool:  # type: ignore[override]
        return self._input.has_focus

    def focus(self, *a, **kw):  # noqa: ANN002, ANN003 - focus lands on the editable half
        return self._input.focus(*a, **kw)

    # -- dropdown ----------------------------------------------------------------

    def _refill(self, typed: str) -> None:
        """Populate the dropdown with the options matching `typed` (prefix first, then
        substring); empty input shows all options. No `options` -> an inert plain field."""
        if not self.options:
            self._list.display = False
            return
        t = typed.strip().lower()
        if not t:
            matches = list(self.options)
        else:
            prefix = [o for o in self.options if o.lower().startswith(t)]
            sub = [o for o in self.options if t in o.lower() and o not in prefix]
            matches = prefix + sub
        self._list.clear_options()
        if matches:
            self._list.add_options([Option(o, id=o) for o in matches])
            self._list.highlighted = 0

    def _show_list(self) -> None:
        if self._list.option_count:
            self._list.display = True
            self._list.add_class("shown")

    def _hide_list(self) -> None:
        self._list.remove_class("shown")
        self._list.display = False

    def _accept(self) -> None:
        """Commit the highlighted option (Tab / ↓ then Enter)."""
        opt = self._list.get_option_at_index(self._list.highlighted or 0) if self._list.option_count else None
        if opt is not None:
            self._input.value = str(opt.id)  # not set_value: keep _committed stale so _commit emits
        self._commit()

    def _commit(self) -> None:
        """Emit `Changed` if the value moved since the last commit (accepted / submitted / blur)."""
        v = self.value
        if self.strict and self.options and v not in self.options:
            best = next((o for o in self.options if o.lower().startswith(v.strip().lower())), self.options[0])
            self.set_value(best)
            v = self.value
        self._hide_list()
        if v != self._committed:
            self._committed = v
            self.post_message(self.Changed(self, v))
            if self.on_change_cb is not None:
                self.on_change_cb(v)

    # -- events ------------------------------------------------------------------

    def on_input_changed(self, ev: Input.Changed) -> None:
        if self._input.has_focus:
            self._refill(ev.value)
            if self._list.option_count and not self._list.display:
                self._show_list()

    def on_input_submitted(self, _ev: Input.Submitted) -> None:
        self._accept()

    def on_input_blurred(self, _ev: Input.Blurred) -> None:
        self._commit()

    def on_focus(self, _ev: events.Focus) -> None:
        if self._input.has_focus:
            self._refill(self._input.value)
            self._show_list()

    def on_key(self, event: events.Key) -> None:
        """↓/↑ drive the dropdown, Tab accepts, Esc closes it (second Esc reaches the panel)."""
        if not self._input.has_focus:
            return
        if event.key == "down":
            if not self._list.display:
                self._show_list()
            else:
                self._list.action_cursor_down()
            event.stop()
            event.prevent_default()
            return
        elif event.key == "up":
            if not self._list.display:
                self._show_list()
            else:
                self._list.action_cursor_up()
            event.stop()
            event.prevent_default()
            return
        elif event.key == "tab":
            if self._list.display and self._list.option_count:
                self._accept()
                event.stop()
                event.prevent_default()
        elif event.key == "escape":
            if self._list.display:
                self._hide_list()
                event.stop()
                event.prevent_default()

    def on_option_list_option_selected(self, ev: OptionList.OptionSelected) -> None:
        self._input.value = str(ev.option_id)  # not set_value: let _commit emit Changed
        self._commit()
        self._input.focus()
        ev.stop()
