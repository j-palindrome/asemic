"""
Scripts/lib/textual_number_box.py - Shared Textual Place-Value NumberBox with Decimal-Zoomed Slider.

Provides a reusable Textual widget where focusing reveals an inline horizontal track slider below,
zoomed specifically to the active decimal place (0..9) with clickable tick steps, direct digit clicking,
instant cursor navigation, and SELECTION_COLOR styling.
"""

import math
from typing import Any, Optional, Tuple, Callable
from rich.text import Text
from textual import events
from textual.reactive import reactive
from textual.widget import Widget

from asemic_py.lib.textual_nav_keys import NavKeysMixin

SELECTION_COLOR = "bold reverse yellow"
FOCUS_COLOR = "bold yellow"
LABEL_COLOR = "bold white"
STEPPER_COLOR = "bold yellow"
arrow_smoother = None
def quadratic_smooth(v, s=0.5): return v


class TextualNumberBox(NavKeysMixin, Widget):
    """
    Textual Place-Value NumberBox with clickable steppers and direct digit editing.
    """
    DEFAULT_CSS = """
    TextualNumberBox {
        width: auto;
        min-width: 32;
        height: 1;
        padding: 0 1;
    }
    TextualNumberBox:focus {
        background: #1a1a00;
        height: 1;
    }
    TextualNumberBox.-multiselected {
        background: #1a1a00;
        height: 1;
    }
    """
    can_focus = True
    value = reactive(1.00)
    is_multiselected = reactive(False)

    def on_focus(self) -> None:
        self.refresh()

    def on_blur(self) -> None:
        self.commit_typed()
        self.refresh()

    def __init__(
        self,
        value: float = 1.00,
        label: str = "VALUE",
        min_val: float = 0.0,
        max_val: float = 99.99,
        decimals: int = 2,
        int_digits: int = 1,
        unit: str = "",
        on_change: Optional[Callable[[float], None]] = None,
        hotkey: str = "",
        default_val: Optional[float] = None,
        name: Optional[str] = None,
        id: Optional[str] = None,
        classes: Optional[str] = None,
        disabled: bool = False
    ):
        super().__init__(name=name, id=id, classes=classes, disabled=disabled)
        self.label_title = label
        self.min_val = min_val
        self.max_val = max_val
        self.default_val = default_val if default_val is not None else value
        self.decimals = decimals
        self.int_digits = int_digits
        self.unit = unit
        self.on_change = on_change
        self.value = value
        self.active_digit_idx = 0
        self.hotkey = hotkey
        # typed-entry buffer; None = not typing
        self.typed: Optional[str] = None

    def _get_digit_specs(self) -> Tuple[str, list]:
        """Returns (formatted_string, digit_positions_list)."""
        val_str = f"{self.value:.{self.decimals}f}"
        if "." in val_str:
            int_p, frac_p = val_str.split(".", 1)
        else:
            int_p, frac_p = val_str, ""
        int_p = int_p.zfill(self.int_digits)
        if len(int_p) > self.int_digits:
            int_p = int_p[-self.int_digits:]

        formatted = f"{int_p}.{frac_p}" if self.decimals > 0 else int_p

        digits_info = []
        digit_count = 0
        for idx, ch in enumerate(formatted):
            if ch.isdigit():
                if self.decimals > 0:
                    power = (
                        self.int_digits - 1 - idx) if idx < self.int_digits else -(idx - self.int_digits)
                else:
                    power = self.int_digits - 1 - idx
                place_val = 10.0 ** power
                digit_val = int(ch)
                digits_info.append((idx, digit_count, place_val, digit_val))
                digit_count += 1

        return formatted, digits_info

    @property
    def total_digits(self) -> int:
        return self.int_digits + self.decimals

    @property
    def current_place_val(self) -> float:
        """Returns current place value at active_digit_idx."""
        _, digits_info = self._get_digit_specs()
        if not digits_info:
            return 1.0
        idx = max(0, min(self.active_digit_idx, len(digits_info) - 1))
        return digits_info[idx][2]

    def set_granularity(self, target_place_val: float) -> None:
        """Aligns active_digit_idx to target_place_val or closest available."""
        _, digits_info = self._get_digit_specs()
        if not digits_info:
            return
        best_rank = 0
        best_diff = float("inf")
        for _, rank, p_val, _ in digits_info:
            diff = abs(math.log10(p_val) - math.log10(target_place_val))
            if diff < best_diff:
                best_diff = diff
                best_rank = rank
        self.active_digit_idx = best_rank
        self.refresh()

    def set_digit_value(self, target_digit_val: int) -> None:
        """Set the active decimal place directly to target_digit_val (0..9)."""
        _, digits_info = self._get_digit_specs()
        idx = max(0, min(self.active_digit_idx, len(digits_info) - 1))
        place_val = digits_info[idx][2]
        curr_digit = digits_info[idx][3]
        diff = target_digit_val - curr_digit
        new_val = round(self.value + place_val * diff, self.decimals)
        new_val = max(self.min_val, min(self.max_val, new_val))
        self.value = new_val
        if self.on_change:
            self.on_change(self.value)
        self.refresh()

    def increment_digit(self, multiplier: int = 1) -> None:
        """Increment/decrement active place value with decimal overflow/underflow."""
        _, digits_info = self._get_digit_specs()
        idx = max(0, min(self.active_digit_idx, len(digits_info) - 1))
        place_val = digits_info[idx][2]
        new_val = round(self.value + place_val * multiplier, self.decimals)
        new_val = max(self.min_val, min(self.max_val, new_val))
        self.value = new_val
        if self.on_change:
            self.on_change(self.value)
        self.refresh()

    def decrement_digit(self) -> None:
        self.increment_digit(-1)

    def _set_value(self, new_val: float) -> None:
        self.value = round(max(self.min_val, min(
            self.max_val, new_val)), self.decimals)
        if self.on_change:
            self.on_change(self.value)
        self.refresh()

    def render(self) -> Text:
        t = Text()
        is_foc = self.has_focus
        is_active = is_foc or self.is_multiselected
        self.set_class(self.is_multiselected, "-multiselected")
        formatted, digits_info = self._get_digit_specs()

        # Row 1: Label and Stepper Number Value
        lbl_style = FOCUS_COLOR if is_active else LABEL_COLOR
        hk = self.label_title.lower().find(self.hotkey.lower()) if self.hotkey else -1
        if hk >= 0:
            # Underline hotkey letter inside label
            t.append(self.label_title[:hk], style=lbl_style)
            t.append(self.label_title[hk], style=f"{lbl_style} underline")
            t.append(self.label_title[hk + 1:], style=lbl_style)
        elif self.hotkey:
            t.append(self.label_title, style=lbl_style)
            t.append(f"({self.hotkey})", style=f"{lbl_style} underline")
        else:
            t.append(self.label_title, style=lbl_style)
        t.append(": ", style=lbl_style)
        t.append("◄ ", style=STEPPER_COLOR if is_active else "yellow")

        if self.typed is not None:
            # Typed entry: show buffer + cursor in place of value
            t.append(self.typed + "▏", style=SELECTION_COLOR)
            if self.unit:
                t.append(self.unit, style=FOCUS_COLOR)
            t.append(" ►", style=STEPPER_COLOR)
            return t

        char_to_rank = {char_idx: rank for char_idx, rank, _, _ in digits_info}
        for char_idx, ch in enumerate(formatted):
            if ch.isdigit():
                rank = char_to_rank.get(char_idx, -1)
                digit_active = is_active and (rank == self.active_digit_idx)
                if digit_active:
                    t.append(ch, style=SELECTION_COLOR)
                else:
                    t.append(ch, style=FOCUS_COLOR if is_active else LABEL_COLOR)
            else:
                t.append(ch, style=FOCUS_COLOR if is_active else LABEL_COLOR)

        if self.unit:
            t.append(self.unit, style=FOCUS_COLOR if is_active else LABEL_COLOR)

        # Dot indicator where default ACTUALLY sits in the range
        if self.max_val > self.min_val and self.default_val is not None:
            (self.default_val - self.min_val) / \
                (self.max_val - self.min_val)
            dot_style = "bold cyan" if abs(
                self.value - self.default_val) < 1e-6 else "dim cyan"
            t.append(" ·", style=dot_style)

        t.append(" ►", style=STEPPER_COLOR if is_active else "yellow")

        return t

    def on_click(self, event: events.Click) -> None:
        self.focus()
        self.commit_typed()
        formatted, digits_info = self._get_digit_specs()

        # Hit-test in content coords (excludes padding/border); clicks on padding are ignored
        content = event.get_content_offset(self)
        if content is None:
            return
        x = content.x

        rendered_text = self.render().plain
        lbl_len = len(rendered_text.split("◄", 1)[0])
        left_stepper_x = lbl_len
        val_start_x = left_stepper_x + 2
        val_end_x = val_start_x + len(formatted) + len(self.unit)

        # Dot position if present
        dot_idx = rendered_text.find("·")
        right_stepper_x = rendered_text.rfind("►")
        if right_stepper_x < 0:
            right_stepper_x = val_end_x + 1

        # Clicking edges of slider toggles min/max vs center = default (dot)
        if x <= left_stepper_x + 1:
            # Clicking left edge: toggle to min_val; if already at min, toggle to default
            if abs(self.value - self.min_val) < 1e-6:
                self._set_value(self.default_val)
            else:
                self._set_value(self.min_val)
        elif x >= right_stepper_x:
            # Clicking right edge: toggle to max_val; if already at max, toggle to default
            if abs(self.value - self.max_val) < 1e-6:
                self._set_value(self.default_val)
            else:
                self._set_value(self.max_val)
        elif dot_idx >= 0 and abs(x - dot_idx) <= 1:
            # Click directly on/near default dot resets to default_val
            self._set_value(self.default_val)
        elif val_start_x <= x < val_start_x + len(formatted):
            char_idx = x - val_start_x
            char_to_rank = {c_idx: rank for c_idx, rank, _, _ in digits_info}
            if char_idx in char_to_rank:
                self.active_digit_idx = char_to_rank[char_idx]
                self.refresh()

    def commit_typed(self) -> None:
        """Parse typed buffer -> clamp -> value; invalid/empty buffer = cancel."""
        if self.typed is None:
            return
        buf, self.typed = self.typed, None
        try:
            v = float(buf)
        except ValueError:
            self.refresh()
            return
        self.value = round(
            max(self.min_val, min(self.max_val, v)), self.decimals)
        if self.on_change:
            self.on_change(self.value)
        self.refresh()

    def on_nav(self, dx: int, dy: int, steps: int) -> bool:
        if dx:
            self.active_digit_idx = max(
                0, min(self.total_digits - 1, self.active_digit_idx + dx))
            self.refresh()
        else:
            self.increment_digit(-dy * steps)
        return True

    def on_key(self, event: events.Key) -> None:
        ch = event.character or ""
        if ch.isdigit() or (ch == "." and "." not in (self.typed or "")):
            self.typed = (self.typed or "") + ch
            self.refresh()
            event.stop()
            return
        if self.typed is not None:
            if event.key == "backspace":
                self.typed = self.typed[:-1]
                self.refresh()
                event.stop()
                return
            if event.key == "escape":
                self.typed = None
                self.refresh()
                event.stop()
                return
            self.commit_typed()
            if event.key == "enter":
                event.stop()
                return

        # Check for shift+target hotkey for multiselect
        target_char = ""
        if event.key.startswith("shift+") and len(event.key) == 7 and event.key[6].isalpha():
            target_char = event.key[6].lower()
        elif event.character and event.character.isalpha() and event.character.isupper():
            target_char = event.character.lower()

        parent: Any = self.parent
        if target_char and parent and hasattr(parent, "multiselect_by_hotkey"):
            if parent.multiselect_by_hotkey(target_char):
                event.stop()
                return

        # Check if parent Params has multiselect active
        params: Any = parent if (parent and getattr(
            parent, "is_multiselect_active", None)) else None
        if params and params.is_multiselect_active():
            if event.key in ("left", "h"):
                params.multiselect_navigate(-1)
                event.stop()
                return
            elif event.key in ("right", "l"):
                params.multiselect_navigate(1)
                event.stop()
                return
            elif event.key in ("up", "k", "plus", "equals"):
                params.multiselect_step(1)
                event.stop()
                return
            elif event.key in ("down", "j", "minus"):
                params.multiselect_step(-1)
                event.stop()
                return
            elif event.key == "shift+up":
                params.multiselect_step(5)
                event.stop()
                return
            elif event.key == "shift+down":
                params.multiselect_step(-5)
                event.stop()
                return
            elif event.key == "escape":
                params.clear_multiselect()
                event.stop()
                return

        if event.key == "space":
            self._set_value(0.0 if self.value != 0.0 else 1.0)
            event.stop()
            return

        # Single box mode: shared nav keys (`textual_nav_keys`): left/right = digit, up/down = +-step
        self.handle_nav(event)
