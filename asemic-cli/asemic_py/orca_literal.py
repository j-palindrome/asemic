'''Lossless grid <-> `orca("""...""")` row-literal helpers (plan: asemic-tui-block-repl, §3).

Region layout (§3, regions-of-one-process): every orca row in a doc shares ONE orca process
(adapters/orca/asemic.orca, tmux session `asemic-orca` -- feedback-adapter-viewers); each row's
own grid lives at its own rectangle (region) of that single shared grid, stacked vertically with
a 1-row blank separator, padded to the shared max width with `.` (orca's file format requires a
rectangular grid). `layout_grids`/`split_grid` are pure + inverse of each other; no tmux/doc/IO
here (kept thin, testable without a live process).
'''

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Hashable

_GRID_RE = re.compile(r'"""(.*?)"""', re.DOTALL)

# (x, y, w, h) rectangle, in shared-grid cells.
Rect = tuple[int, int, int, int]


def is_orca_row(src: str) -> bool:
    return src.lstrip().startswith("orca(") and '"""' in src


def grid_from_src(src: str) -> str | None:
    """Extract the grid text (no leading/trailing blank line) from an `orca(<triple-quoted>)` row."""
    m = _GRID_RE.search(src)
    if m is None:
        return None
    return m.group(1).strip("\n")


def replace_grid(src: str, new_grid: str) -> str:
    """Swap the triple-quoted grid in `src` for `new_grid`, keeping everything else (e.g.
    `bpm=...`) byte-for-byte."""
    return _GRID_RE.sub(lambda _: f'"""\n{new_grid}\n"""', src, count=1)


def layout_grids(entries: Sequence[tuple[Hashable, str]]) -> tuple[str, dict[Hashable, Rect]]:
    """Stack `entries` (key, grid-text) vertically into 1 shared grid, 1 blank separator row
    between neighbors, every row padded to the shared max width with `.`. -> (composed grid
    text, {key: (x, y, w, h)}) -- `w`/`h` are the entry's OWN (unpadded) size; `x` is always 0
    (single column of regions)."""
    layout: dict[Hashable, Rect] = {}
    out_lines: list[str] = []
    max_w = max((max((len(l) for l in grid.split("\n")), default=0) for _, grid in entries), default=0)
    for i, (key, grid) in enumerate(entries):
        lines = grid.split("\n")
        w = max((len(l) for l in lines), default=0)
        h = len(lines)
        layout[key] = (0, len(out_lines), w, h)
        out_lines.extend(l.ljust(max_w, ".") for l in lines)
        if i < len(entries) - 1:
            out_lines.append("." * max_w)
    return "\n".join(out_lines), layout


def crop_grid(composed: str, rect: Rect) -> str:
    """Inverse slice: the `rect` region of `composed` (as `layout_grids` placed it)."""
    x, y, w, h = rect
    lines = composed.split("\n")[y : y + h]
    return "\n".join(l[x : x + w] for l in lines)


def split_grid(composed: str, layout: dict[Hashable, Rect]) -> dict[Hashable, str]:
    """Full inverse of `layout_grids`: composed grid + its layout -> {key: entry grid text}."""
    return {key: crop_grid(composed, rect) for key, rect in layout.items()}


# orca-c's TUI centers the grid in its pane -- both axes -- but not identically: horizontally
# it's an exact centering, vertically there's a constant 4-row allowance (status/ruler chrome
# below) folded into the centering math. Verified live, `tmux capture-pane -p -t asemic-orca`,
# 2026-10-10, sweeping pane width 30/46/60/80 (grid_w=4) and pane height 10/14/18/20/24/30
# (grid_h=4): col always (ncol - grid_w) // 2; row always (nrow - grid_h - _ORCA_TUI_Y_CHROME) // 2.
_ORCA_TUI_Y_CHROME = 4


def orca_tui_origin(ncol: int, nrow: int, grid_w: int, grid_h: int) -> tuple[int, int]:
    """(x, y) in the tmux pane where the shared grid's cell (0, 0) renders, for a pane
    `ncol` x `nrow` showing a grid `grid_w` x `grid_h` (orca-c centers it, see above)."""
    return (ncol - grid_w) // 2, (nrow - grid_h - _ORCA_TUI_Y_CHROME) // 2


def crop_capture(capture: str, rect: Rect, ncol: int, nrow: int, grid_w: int, grid_h: int) -> tuple[list[str], int, int]:
    """Crop a raw `tmux capture-pane -p -e` string (ANSI kept) to one region's rect, in shared-
    grid coordinates (`ncol`/`nrow` = the pane's actual size, `grid_w`/`grid_h` = the whole
    composed grid's size). -> (pane lines covering the rect's rows, column offset, width) --
    caller does `Text.from_ansi(line)[col_offset : col_offset + width]` (slicing post-parse,
    like `pty_terminal.py`, keeps ANSI spans correct; slicing the raw ANSI string by column
    would not, since escape bytes don't occupy columns)."""
    ox, oy = orca_tui_origin(ncol, nrow, grid_w, grid_h)
    x, y, w, h = rect
    lines = capture.split("\n")[oy + y : oy + y + h]
    return lines, ox + x, w
