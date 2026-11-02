"""
Scripts/lib/textual_nav_keys.py - Shared arrow/hjkl "capture until Escape" key handling.

One place that decides what a nav key means for any focused value control (NumberBox digits,
XYPad crosshair, ...): arrows/hjkl (+ `+`/`=`/`-` as up/down), shift / uppercase = coarse x5,
step accelerated by the shared `arrow_smoother`. Escape is never consumed, so it bubbles to the
host (e.g. "leave the control, back to the row").
"""

from typing import Optional, Tuple

from textual import events

try:
    from .quadratic_smoothing import arrow_smoother  # pyright: ignore[reportMissingImports]
except ImportError:
    try:
        from quadratic_smoothing import arrow_smoother  # pyright: ignore[reportMissingImports]
    except ImportError:
        arrow_smoother = None

# key -> (dx, dy); dy < 0 = up
_DIRS = {
    "left": (-1, 0), "h": (-1, 0),
    "right": (1, 0), "l": (1, 0),
    "up": (0, -1), "k": (0, -1), "plus": (0, -1), "equals": (0, -1),
    "down": (0, 1), "j": (0, 1), "minus": (0, 1),
}
COARSE = 5


def nav_key(event: events.Key) -> Optional[Tuple[int, int, int]]:
    """-> (dx, dy, steps) for a nav key, else None. `steps` = smoothed 1 (fine) / 5 (coarse)."""
    key = event.key
    coarse = key.startswith("shift+")
    if coarse:
        key = key[len("shift+"):]
    ch = event.character or ""
    if len(ch) == 1 and ch.isalpha() and ch.isupper():
        coarse, key = True, ch.lower()
    d = _DIRS.get(key)
    if d is None:
        return None
    base = COARSE if coarse else 1
    name = "up" if d[1] < 0 or d[0] > 0 else "down"
    steps = arrow_smoother.smooth_step(name, base) if arrow_smoother else base
    return d[0], d[1], steps


class NavKeysMixin:
    """Mixin for a focusable Textual widget: implement `on_nav(dx, dy, steps) -> bool` (True =
    handled). Call `self.handle_nav(event)` from `on_key`; it stops the event when handled."""

    def on_nav(self, dx: int, dy: int, steps: int) -> bool:  # pragma: no cover - override
        return False

    def handle_nav(self, event: events.Key) -> bool:
        nav = nav_key(event)
        if nav is None or not self.on_nav(*nav):
            return False
        event.stop()
        event.prevent_default()
        return True
