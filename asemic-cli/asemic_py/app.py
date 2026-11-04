"""asemic REPL (plan §8.5): block-column editor + component-driven controls + terminal view.

Keys: Enter commit row (evals it) · :run eval all · Ctrl+L log · Ctrl+Q quit

Plan (2026-10-10, "everything renders underneath its line"): param/tex/view panels mount
inline in `BlockColumns`' own `#rows`, directly after the row that created them (`columns.py`'s
`row_anchor`/`anchor_widget`) -- 1 full-width panel, no side overlay. Only the global eval log
has nowhere row-local to live, so it alone stays behind a Ctrl+L toggle (docked, not a 2nd panel).
"""

from __future__ import annotations

import os
import threading
import time
import tomllib
from pathlib import Path
from typing import Any, cast

from textual.app import App, ComposeResult
from textual.theme import Theme
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.css.query import NoMatches
from textual.screen import ModalScreen
from textual.widget import Widget
from textual.content import Content
from textual.markup import escape
from textual.message import Message
from textual.widgets import Button, Input, OptionList, RichLog, Static
from textual.widgets.option_list import Option
from textual_vim_textarea import Mode

from PIL import Image as PILImage
# import before App.run: probes terminal graphics support
import textual_image.widget as timg

from . import canvas
from .quad import QuadImage
from .blocks import LABEL_RE, Doc, Row, RowPath, from_labels
from ._keys import SPACES
from .client import ROOT, Client, param_key
from .columns import LOCAL_COMMANDS, BlockColumns, _slug, bare_call, resolve_path
from . import ids
from .ids import display_path
from .jump import JUMP_KEY, OPEN_PREFIX
from .links import file_uri, links_enabled
from .namespace import UI, Repl
from ._wire import F_HEAD, T_MAGIC
from .state import State, tex_refs
from .points import decode_frame, decode_points
from .pty_terminal import PtyTerminal
from .nvim_view import NvimHelpView, NvimRowEditor, NvimView


from asemic_py.lib.textual_number_box import TextualNumberBox as NumberBox
from asemic_py.lib.textual_xy_pad import TextualXYPad
from asemic_py.lib.textual_choice_input import TextualChoiceInput
from asemic_py.lib.textual_nav_keys import NavKeysMixin
import contextlib
# auto: real graphics (TGP/sixel) when the terminal has them, else quarter-blocks (!halfcell)
IMAGE_KINDS = {"auto": timg.Image if timg.AutoRenderable in (timg.TGPRenderable, timg.SixelRenderable)
               else QuadImage, "quad": QuadImage, "halfcell": timg.HalfcellImage,
               "tgp": timg.TGPImage, "sixel": timg.SixelImage, "unicode": timg.UnicodeImage}


def ui_hz() -> float:
    return max(float(UI["hz"]), 1.0)


def _decimals(step: float | None, span: float) -> int:
    ref = step or span / 100
    return max(0, min(4, len(f"{ref:.4f}".rstrip("0").split(".")[1]) if ref < 1 else 0))


def _int_digits(lo: float, hi: float) -> int:
    return max(1, len(str(int(max(abs(lo), abs(hi))))))


def _component_link(cid: str) -> str:
    """Clickable component/tex id or `route:<id>` backlink (`State.backlinks`) ->
    `AsemicApp.action_goto_comp` (jump to its declaring row + jumplist entry); the label
    uses slash-delimited display paths while the click payload keeps the canonical brain id."""
    return f"[@click=app.goto_comp({cid!r})]{escape(display_path(_key_label(cid)))}[/]"


_SORTED_SPACES = sorted(SPACES, key=lambda s: (-len(s[2]), -len(s[3])))


def _key_label(ref: str) -> str:
    """Raw keyspace key (`_keys.SPACES`: `asemic/value/<cid>.<k>`, `asemic/meta/<cid>.props`, ...)
    -> slash-delimited component/property display; non-key refs pass through for display formatting."""
    for _, _, pre, suf in _SORTED_SPACES:
        if pre and ref.startswith(pre) and ref.endswith(suf):
            rest = ref[len(pre):len(ref) - len(suf)] if suf else ref[len(pre):]
            comp, k = ids.field(rest, "value")
            return display_path(comp) + (f".{k}" if k != "value" else "")
    return ref


class MultiSlider(NavKeysMixin, Widget, can_focus=True):
    """`multi` component: `n` vertical bars sharing [lo, hi] (a param array). ←/→ (h/l) pick a
    bar, ↑/↓ (k/j) step it (count/shift = more steps); click/drag sets bars under the cursor.
    `on_change(i, v)` per touched index; Escape bubbles (panel blur)."""

    DEFAULT_CSS = """
    MultiSlider { height: 8; width: 1fr; }
    MultiSlider:focus { background: $boost; }
    """
    _BLOCKS = " ▁▂▃▄▅▆▇█"

    def __init__(self, n: int, lo: float, hi: float, values: list[float], on_change, **kw) -> None:
        super().__init__(**kw)
        self.n, self.lo, self.hi, self.values, self.on_change = n, lo, hi, values, on_change
        self.sel = 0
        self.dragging = False

    def _bar_w(self) -> int:
        return max(1, self.size.width // max(1, self.n))

    def _t(self, v: float) -> float:
        return 0.0 if self.hi == self.lo else min(1.0, max(0.0, (v - self.lo) / (self.hi - self.lo)))

    def render(self) -> Content:
        h, bw = max(1, self.size.height), self._bar_w()
        rows = []
        for r in range(h):  # top -> bottom; eighth-block resolution
            line = []
            for i, v in enumerate(self.values):
                fill = self._t(v) * h * 8 - (h - 1 - r) * 8
                ch = self._BLOCKS[int(min(8, max(0, fill)))]
                cell = (ch * max(1, bw - 1) + " ") if bw > 1 else ch
                style = "$accent" if i == self.sel and self.has_focus else (
                    "$primary" if i == self.sel else "$foreground")
                line.append(f"[{style}]{escape(cell)}[/]")
            rows.append("".join(line))
        return Content.from_markup("\n".join(rows))

    def set(self, i: int, v: float, emit: bool = True) -> None:
        if 0 <= i < self.n:
            self.values[i] = min(self.hi, max(self.lo, v))
            if emit:
                self.on_change(i, self.values[i])
            self.refresh()

    def on_key(self, event) -> None:
        self.handle_nav(event)

    def on_nav(self, dx: int, dy: int, steps: int) -> bool:
        if dx:
            self.sel = (self.sel + dx * steps) % self.n
            self.refresh()
        if dy:  # nav dy: +1 = down
            self.set(self.sel, self.values[self.sel] -
                     dy * steps * (self.hi - self.lo) / 64)
        return True

    def _at(self, event) -> None:
        o = event.get_content_offset(self)
        if o is None:
            return
        x, y = o
        h = max(1, self.size.height)
        self.sel = min(self.n - 1, x // self._bar_w())
        self.set(self.sel, self.lo + (1 - y / max(1, h - 1))
                 * (self.hi - self.lo))

    def on_mouse_down(self, event) -> None:
        self.focus()
        self.dragging = True
        self.capture_mouse()
        self._at(event)

    def on_mouse_move(self, event) -> None:
        if self.dragging:
            self._at(event)

    def on_mouse_up(self, event) -> None:
        self.dragging = False
        self.release_mouse()


class ComponentPanel(Vertical):
    DEFAULT_CSS = """
    ComponentPanel { height: auto; border: round $panel; padding: 0 1; margin-bottom: 1; }
    ComponentPanel .title { color: $accent; text-style: bold; }
    ComponentPanel TextualXYPad { width: 24; height: 12; }
    ComponentPanel TextualXYPad.-grown { width: auto; height: auto; }
    ComponentPanel .readout { color: $text-muted; height: auto; overflow-x: hidden; text-overflow: ellipsis; }
    ComponentPanel.xy .readout-preview { height: 2; }
    ComponentPanel.param .readout-preview { height: 1; }
    ComponentPanel.multi .readout-preview { height: 1; }
    ComponentPanel.proc .readout-preview { height: 1; }
    ComponentPanel Horizontal { height: auto; }
    ComponentPanel .props { layout: grid; grid-size: 3; grid-gutter: 0 1; height: auto; }
    ComponentPanel TextualNumberBox { margin-right: 1; }
    """
    # Leaf parameter focus navigation (plan §3.1, 2026-10-11): once focus is inside one of
    # this panel's controls, these take priority over Screen's own tab/shift+tab (Textual's
    # binding chain walks the focused widget's ancestors before the Screen, see `columns.py`'s
    # `focus_leaf_panel`) -- Tab/Shift+Tab cycle *within* this panel only (wrap), and
    # h/←/Escape blur back to the row line. `NumberBox` consumes h/← itself (digit nav), so
    # only Escape reliably reaches here from it; `TextualXYPad` likewise consumes arrows/hjkl
    # (crosshair nudge, 2026-10-11), so Escape is the one uniform way out of either control.
    BINDINGS = [
        Binding("tab", "cycle_control(1)", "next control", show=False),
        Binding("shift+tab", "cycle_control(-1)", "prev control", show=False),
        Binding("escape", "blur_panel", "back to row", show=False),
        Binding("left", "blur_panel", "back to row", show=False),
        Binding("h", "blur_panel", "back to row", show=False),
    ]

    def action_cycle_control(self, direction: int) -> None:
        controls = [w for w in self.query(
            "*") if getattr(w, "can_focus", False)]
        if not controls:
            return
        try:
            i = controls.index(self.app.focused)  # type: ignore[arg]
        except ValueError:
            i = 0
        controls[(i + direction) % len(controls)].focus()

    def action_blur_panel(self) -> None:
        self.app.query_one(BlockColumns).focus_line_normal()

    def __init__(self, comp: dict, repl_app: "AsemicApp"):
        super().__init__(
            id=f"comp-{_slug(comp['id'])}", classes=comp.get("type", ""))
        self.comp = comp
        self.rapp = repl_app
        self.pad: TextualXYPad | None = None
        self.multi: MultiSlider | None = None
        self.boxes: dict[str, NumberBox] = {}
        self.readout: Static | None = None
        self.attrs: Static | None = None
        self.route_links: Static | None = None

    @property
    def cid(self) -> str:
        return self.comp["id"]

    def _title(self) -> str:
        c = self.comp
        anim = c.get("anim")
        tail = f"  ~ {_component_link(anim['source'])} ({anim.get('mode', 'add')})" if anim else ""
        shown = {f"route:{rid}" for d in self._routes()
                 for rid in d}  # in the routes line instead
        back = [b for b in self.rapp.backlinks(self.cid) if b not in shown]
        tail += f"  ← {', '.join(map(_component_link, back))}" if back else ""
        kind = f"{c['type']}{':' + c['proc'] if c['type'] == 'proc' else ''}"
        label = c.get("label") or display_path(c["id"])
        return f"{escape(label)}  \\[{kind}]{tail}"

    def refresh_title(self) -> None:
        if not (titles := self.query(".title")):  # mounted, not yet composed: compose renders it
            return
        titles.first(Static).update(self._title())
        if self.route_links is not None:
            self.route_links.update(self._routes_line())

    def _routes(self) -> tuple[dict[str, dict], dict[str, dict]]:
        """(incoming, outgoing) routes: writing one of this component's props (dst = its stored
        param key) / reading one of its channels (src = `<id>` or `<id>:<chan>`)."""
        want = param_key(self.cid, "")
        inc, out = {}, {}
        for rid, r in sorted(self.rapp.state.routes.items()):
            if not isinstance(r, dict):
                continue
            if str(r.get("dst", "")).startswith(want):
                inc[rid] = r
            if str(r.get("src", "")).split(":")[0] == self.cid:
                out[rid] = r
        return inc, out

    def _routes_line(self) -> str:
        """Routes as links both ways, each end + the `(route)` row clickable:
        `size ← <src> (route)` (driving this) / `value → <comp.prop> (route)` (driven by this)."""
        inc, out = self._routes()
        n = len(param_key(self.cid, ""))
        pre = ids.PARAM_PREFIX

        def link(
            rid): return f"[@click=app.goto_comp({('route:' + rid)!r})](route)[/]"

        def dst_link(dst: str) -> str:
            if not dst.startswith(pre):  # adapter out / raw key: no row to jump to
                return escape(display_path(dst))
            comp, k = ids.field(dst[len(pre):])
            return f"[@click=app.goto_comp({comp!r})]{escape(display_path(f'{comp}.{k}'))}[/]"

        parts = [
            f"{escape(display_path(r['dst'][n:]))} ← {_component_link(r.get('src', '?'))} {link(rid)}"
            for rid, r in inc.items()]
        parts += [f"{escape(display_path(r['src'].partition(':')[2] or 'value'))} → "
                  f"{dst_link(str(r.get('dst', '')))} {link(rid)}"
                  for rid, r in out.items()]
        return "   ".join(parts)

    def _box(self, key: str, label: str, lo: float, hi: float, v: float, step: float | None = None) -> NumberBox:
        b = NumberBox(
            id=f"box-{_slug(self.cid)}-{key}", label=label.upper(), value=v, min_val=lo, max_val=hi,
            decimals=_decimals(step, hi - lo), int_digits=_int_digits(lo, hi),
            on_change=lambda val, k=key: self.rapp.client.put(
                param_key(self.cid, k), float(val)),
        )
        self.boxes[key] = b
        return b

    def compose(self) -> ComposeResult:
        c = self.comp
        self.boxes = {}  # recompose (props arrived): drop the old boxes
        yield Static(self._title(), classes="title")
        base = self.rapp.state.params(self.cid)
        if c["type"] == "param":
            v: float = cast(float, base.get("value", c.get(
                "default", (c["min"] + c["max"]) / 2)))
            with Horizontal():
                yield self._box(
                    "value", display_path(c.get("label") or c["id"]),
                    c["min"], c["max"], v, c.get("step"))
        elif c["type"] == "xy":
            self.xr = (c.get("x", {}).get("min", -1.0),
                       c.get("x", {}).get("max", 1.0))
            self.yr = (c.get("y", {}).get("min", -1.0),
                       c.get("y", {}).get("max", 1.0))
            self.pad = TextualXYPad(
                id=f"pad-{_slug(self.cid)}", on_change=self._pad_changed)
            yield cast(TextualXYPad, self.pad)
        elif c["type"] == "multi":
            d = c.get("default", (c["min"] + c["max"]) / 2)
            vals: list[float] = cast("list[float]", [base.get(
                str(i), d) for i in range(c.get("n", 8))])
            self.multi = MultiSlider(
                len(vals), c["min"], c["max"], vals, id=f"multi-{_slug(self.cid)}",
                on_change=lambda i, v: self.rapp.client.put(
                    param_key(self.cid, str(i)), float(v)),
            )
            yield self.multi
        if c["type"] == "proc":
            # plugin-declared params (`asemic/meta/<id>.props`: kind defaults + own kw); the
            # component's own `params` until the brain has published them
            props = self.rapp.state.get(
                "props", self.cid) or c.get("params") or {}
            with Vertical(classes="props"):  # grid: wraps, !overflow off-panel
                for k, v in props.items():
                    v = cast(float, base.get(k, v))
                    hi = max(1.0, abs(v) * 4)
                    yield self._box(k, k, -hi if v < 0 else 0.0, hi, v)
        self.route_links = Static(
            self._routes_line(), classes="readout", markup=True)
        yield self.route_links
        # live value preview: noise/proc channels + param/xy output (`apply_live`)
        self.readout = Static(
            "", classes="readout readout-preview", markup=True)
        yield self.readout
        if c["type"] == "proc":  # built-in preview: its own point stream (`preview_kind`)
            yield BufferView(self.cid, "points", client=self.rapp.client)
        if c["type"] in ("param", "xy"):
            # brain re-publishes a non-animated output only when it changes: seed from the last
            # seen output, else the stored/default value, so the preview is never blank
            dflt = {"value": c.get(
                "default", (c.get("min", 0) + c.get("max", 1)) / 2), "x": 0.0, "y": 0.0}
            self._live = {k: self.rapp.state.get("value", f"{self.cid}.{k}", base.get(k, dflt[k]))
                          for k in (("value",) if c["type"] == "param" else ("x", "y"))}
            self._show(self._live)
        if c["type"] == "proc":
            # point dims of asemic/gen/<id> (x y + appended/declared attrs)
            self.attrs = Static(self._attrs_line(self.rapp.dims.get(
                self.cid)), classes="readout", markup=False)
            yield self.attrs

    def _pad_changed(self, xy: tuple[float, float]) -> None:
        x = self.xr[0] + (xy[0] + 1) / 2 * (self.xr[1] - self.xr[0])
        y = self.yr[0] + (xy[1] + 1) / 2 * (self.yr[1] - self.yr[0])
        self.rapp.client.put(param_key(self.cid, "x"), x)
        self.rapp.client.put(param_key(self.cid, "y"), y)

    def apply_value(self, key: str, v: float) -> None:
        if not self.comp.get("anim") and key in getattr(self, "_live", {}):
            # no anim: output = stored value, preview follows it
            self.apply_live(key, v)
        if getattr(self, "multi", None) is not None and key.isdigit():
            m = cast(MultiSlider, self.multi)
            if not m.dragging:
                m.set(int(key), v, emit=False)
            return
        if self.pad is not None and key in ("x", "y"):
            # Skip the echo for a brief grace window after a click/drag/nav: a round trip
            # through the brain can otherwise land late and stomp the value right back.
            if self.pad.is_dragging or time.monotonic() - self.pad.last_user_set < 0.5:
                return
            lo, hi = self.xr if key == "x" else self.yr
            n = (v - lo) / (hi - lo) * 2 - 1 if hi != lo else 0.0
            setattr(self.pad, "val_x" if key == "x" else "val_y", n)
            self.pad.refresh()
        elif (b := self.boxes.get(key)) is not None and not b.has_focus:
            b.value = v

    @staticmethod
    def _attrs_line(v: dict | None) -> str:
        return "attrs: " + (" ".join((v or {}).get("dims") or []) or "·")

    def apply_attrs(self, v: dict) -> None:
        if self.attrs is not None:
            self.attrs.update(self._attrs_line(v))

    _CHAN_ORDER = ("value", "x", "y", "vx", "vy")

    def apply_live(self, key: str, v: float) -> None:
        """`asemic/value/<id>.<key>`: the component's actual output (after `anim`), !its slider."""
        self._live = {**getattr(self, "_live", {}), key: v}
        self._show(self._live)

    def _range(self, key: str) -> tuple[float, float]:
        """Preview gauge range: param = its own min/max, xy = its axis range."""
        c = self.comp
        if c["type"] in ("param", "multi"):
            return c["min"], c["max"]
        # xy (only other gauged type, §_show)
        return self.xr if key == "x" else self.yr

    @staticmethod
    def _gauge(key: str, v: float, lo: float, hi: float, width: int = 32) -> str:
        """Read-only slider: `value ━━━━━━●────────  -0.45` (marker clamped to the range)."""
        t = 0.0 if hi == lo else min(1.0, max(0.0, (v - lo) / (hi - lo)))
        i = round(t * (width - 1))
        return f"{key:<6}[$accent]{'━' * i}●[/]{'─' * (width - 1 - i)}  {v:+.2f}"

    def _show(self, ch: dict) -> None:
        if self.readout is None:
            return
        nums = {k: float(v)
                for k, v in ch.items() if isinstance(v, (int, float))}
        # gauge only where the range is known (param/multi min-max, xy axes); proc/noise = all `k=v`
        gauged = {"xy": ("x", "y"), "param": ("value",),
                  "multi": ("value",)}.get(self.comp["type"], ())
        main = [k for k in gauged if k in nums]
        if main:
            lines = [self._gauge(k, nums[k], *self._range(k)) for k in main]
        else:
            rest = [k for k in self._CHAN_ORDER if k in nums] + \
                sorted(k for k in nums if k not in self._CHAN_ORDER)
            lines = [
                "  ".join(f"{k}={nums[k]:+.2f}" for k in rest)] if rest else []
        self.readout.update("\n".join(lines))


class BlockPanel(Vertical):
    """`block(...)` nest preview: the block's timing parameters (J 2026-10-12/13) --
    `timestretch` (0.0 = frozen/paused, 1.0 = real-time, >1 faster, <0 reverse), `length`
    (seconds; 0 = infinite), `loop` envelope (off = play once and hold, loop, pingpong) and a
    scrubbable `time` playhead reading the brain's live `asemic/block/<label>.time`. Replaces
    the old global row glyph + NORMAL `<Space>` toggle. `AsemicApp._place_blocks` mounts one
    under each nest row; Tab from the row line focuses the boxes, Esc/h/<- blurs back."""

    DEFAULT_CSS = """
    BlockPanel { height: auto; border: round $panel; padding: 0 1; margin-bottom: 1; }
    BlockPanel .title { color: $accent; text-style: bold; }
    BlockPanel Horizontal { height: auto; }
    BlockPanel TextualNumberBox { margin-right: 1; }
    BlockPanel TextualChoiceInput { width: 24; margin-right: 1; }
    """
    BINDINGS = [
        Binding("escape", "blur_panel", "back to row", show=False),
        Binding("left", "blur_panel", "back to row", show=False),
        Binding("h", "blur_panel", "back to row", show=False),
    ]

    LOOP_MODES = ("off", "loop", "pingpong")

    def __init__(self, row: Row, repl_app: "AsemicApp", **kw) -> None:
        super().__init__(**kw)
        self.row = row
        self.rapp = repl_app
        self.path = list(row.path)
        self.box: NumberBox | None = None
        self.length_box: NumberBox | None = None
        self.loop_input: TextualChoiceInput | None = None
        self.time_box: NumberBox | None = None
        self._t: float | None = None
        self._frame_sub: Any = None

    @property
    def label(self) -> str:
        return self.rapp.doc.label(tuple(self.path))

    def _title(self) -> str:
        ts = self.row.timestretch if self.row.timestretch is not None else 0.0
        state = "frozen" if ts == 0.0 else "playing"
        ln = f"{self.row.length:g}s" if self.row.length else "inf"
        loop = self.row.loop or "loop"
        pos = f"{self._t:.2f}" if self._t is not None else "-"
        return f"{escape(str(self.row.name or ''))}  \\[time {pos}/{ln} · loop {loop} · ts {ts:g} · {state}]"

    def compose(self) -> ComposeResult:
        sid = "-".join(map(str, self.path))
        yield Static(self._title(), classes="title")
        p_tup = tuple(self.path)
        sub_errs = [err for p, err in self.rapp.doc.run_errors.items() if p[:len(p_tup)] == p_tup and err]
        err_text = ""
        if sub_errs:
            lines = sub_errs[0].rstrip().splitlines()[-4:]
            err_text = "\n".join(f"[red]✗ {escape(line)}[/red]" for line in lines)
        yield Static(err_text, classes="block-error", markup=True)
        self.box = NumberBox(
            id=f"ts-{sid}",
            label="TIMESTRETCH", value=float(self.row.timestretch or 0.0),
            min_val=-2.0, max_val=4.0, default_val=1.0,
            decimals=2, int_digits=2,
            on_change=lambda v: self.rapp.action_set_timestretch(self.path, float(v)),
        )
        yield self.box
        self.length_box = NumberBox(
            id=f"len-{sid}",
            label="LENGTH", value=float(self.row.length or 0.0),
            min_val=0.0, max_val=3600.0, default_val=0.0,
            decimals=2, int_digits=4,
            on_change=lambda v: self.rapp.action_set_block_length(self.path, float(v)),
        )
        yield self.length_box
        self.loop_input = TextualChoiceInput(
            value=self.row.loop or "loop",
            options=self.LOOP_MODES,
            label="LOOP",
            id=f"loop-{sid}",
        )
        yield self.loop_input
        self.time_box = NumberBox(
            id=f"t-{sid}",
            label="TIME", value=float(self._t or 0.0),
            min_val=-1e6, max_val=1e6, default_val=0.0,
            decimals=2, int_digits=6,
            on_change=lambda v: self.rapp.action_seek_block(self.path, float(v)),
        )
        yield self.time_box
        # COOK = play one frame (AsemicApp.cook_block)
        yield Button("COOK", id=f"cook-{sid}", compact=True)

    def on_button_pressed(self, ev: Button.Pressed) -> None:
        if ev.button.id and ev.button.id.startswith("cook-") and getattr(self.rapp, "client", None):
            self.rapp.cook_block(self.path)

    def sync(self, row: Row) -> None:
        """Doc changed under us (external edit / code write): re-read the block's own state."""
        self.row = row
        if (titles := self.query(".title")):
            titles.first(Static).update(self._title())
        p_tup = tuple(self.path)
        sub_errs = [err for p, err in self.rapp.doc.run_errors.items() if p[:len(p_tup)] == p_tup and err]
        err_text = ""
        if sub_errs:
            lines = sub_errs[0].rstrip().splitlines()[-4:]
            err_text = "\n".join(f"[red]✗ {escape(line)}[/red]" for line in lines)
        if (err_widgets := self.query(".block-error")):
            err_widgets.first(Static).update(err_text)
        if self.box is not None and not self.box.has_focus:
            self.box.value = float(row.timestretch or 0.0)
        if self.length_box is not None and not self.length_box.has_focus:
            self.length_box.value = float(row.length or 0.0)
        if self.loop_input is not None and not self.loop_input.has_focus:
            self.loop_input.set_value(row.loop or "loop")

    def on_mount(self) -> None:
        """A block can own a raster (e.g. the affinity adapter's page grab on
        `asemic/preview/<label>`): first frame mounts a `BufferView` under the panel, seeded with
        it; blocks nothing publishes for stay compact (!empty box)."""
        client = getattr(self.rapp, "client", None)  # test harnesses have none
        if (raw := LAST_FRAME.get(self.label)) is not None:
            self._mount_frame(raw)
        elif client is not None:
            self._frame_sub = client.subscribe_raw(
                ids.PREVIEW_PREFIX + self.label, self._on_first_frame)

    def _on_first_frame(self, _key: str, raw: bytes) -> None:
        with contextlib.suppress(Exception):
            self.app.call_from_thread(self._mount_frame, raw)

    def _mount_frame(self, raw: bytes) -> None:
        if self.query(BufferView):
            return
        self._drop_frame_sub()
        view = BufferView(self.label, "frame", client=getattr(self.rapp, "client", None),
                          wid=f"block-frame-{'-'.join(map(str, self.path))}")
        view._on_frame("", raw)
        self.mount(view)

    def _drop_frame_sub(self) -> None:
        if self._frame_sub is not None:
            with contextlib.suppress(Exception):
                self._frame_sub.undeclare()
            self._frame_sub = None

    def on_unmount(self) -> None:
        self._drop_frame_sub()

    def apply_time(self, t: float | None) -> None:
        """Live playhead from `asemic/block/<label>.time`: update title + (unfocused) TIME box."""
        self._t = t
        if (titles := self.query(".title")):
            titles.first(Static).update(self._title())
        if self.time_box is not None and not self.time_box.has_focus:
            self.time_box.value = float(t or 0.0)

    def on_textual_choice_input_changed(self, ev: TextualChoiceInput.Changed) -> None:
        if ev.field is self.loop_input:
            self.rapp.action_set_block_loop(self.path, str(ev.value))

    def action_blur_panel(self) -> None:
        self.rapp.query_one(BlockColumns).focus_line_normal()


# view kinds fed by demand-gated preview frames (`asemic/preview/<id>`)
RASTER = ("frame", "ascii")
# preview renderers (`keys::PREVIEW_KIND`, declared by the stream's producer / a row's `preview=`)
LOOKS = ("dots", "image", "ascii")


def default_look(kind: str) -> str:
    """Viewer default when the producer declares nothing: points = dots, ascii = ascii, raster = image."""
    return {"points": "dots", "ascii": "ascii"}.get(kind, "image")
# newest raw frame per stream: producers publish on change only, so a panel remounted by a
# zoom (rows hidden -> panels dropped) seeds from here instead of staying blank
LAST_FRAME: dict[str, bytes] = {}


def view_id(stream: str, kind: str) -> str:
    return f"view-{kind}-{_slug(stream)}"


def embed_id(nid: str) -> str:
    return f"embed-{_slug(nid)}"


def preview_kind(state: Any, nid: str) -> str:
    """A node's own preview: procs = their point stream (`asemic/gen/<id>`); everything else
    (tex nodes, adapter rows, outputs) = raster/text on `asemic/preview/<id>`."""
    c = state.get("component", nid) or {}
    return "points" if c.get("type") == "proc" else "frame"


def load_adapter_manifests(root: Path = ROOT) -> list[dict]:
    """`adapters/*/adapter.toml` -> `[{"name", "kind", "path", "io": [{"name","dir"}, ...]}, ...]`,
    sorted by name; a manifest that fails to parse is skipped (pure, no brain/zenoh -- `/adapters`
    panel's own listing, same shape `crates/schema`'s `AdapterManifest` describes)."""
    out: list[dict] = []
    for d in sorted((root / "adapters").glob("*")):
        path = d / "adapter.toml"
        if not path.is_file():
            continue
        try:
            manifest = tomllib.loads(path.read_text())
        except Exception:
            continue
        a = manifest.get("adapter") or {}
        if "name" not in a:
            continue
        out.append({
            "name": a["name"],
            "kind": a.get("kind", "?"),
            "path": path,
            "io": [{"name": p.get("name", "?"), "dir": p.get("dir", "?")} for p in manifest.get("io") or []],
        })
    out.sort(key=lambda a: a["name"])
    return out


def adapter_status(client: Client | None, names: list[str]) -> dict[str, bool | None]:
    """`{name: running}` from the brain's `asemic/adapter/*/status` fan-out query
    (`crates/brain/src/adapters.rs` `status()`/`handle()`); `None` (-> "?" in the panel) per
    name the brain didn't answer for, or for every name if the brain is unreachable."""
    out: dict[str, bool | None] = {n: None for n in names}
    if client is None:
        return out
    try:
        replies = client.get("asemic/adapter/*/status", timeout=1.0)
    except Exception:
        return out
    for key, v in replies:
        name = key.split("/")[2]
        if name in out and isinstance(v, dict) and "running" in v:
            out[name] = bool(v["running"])
    return out


class AdaptersPanel(OptionList):
    """`/adapters` (plan this task): every `adapters/*/adapter.toml`, name/kind/running status
    (brain `asemic/adapter/*/status`, else "?") + io plugs, name as an OSC 8 link to its
    `adapter.toml` (`links.py`'s `file_link_content`). Mounted tucked at the end of `#rows`
    (same spot an unanchored widget would go -- no row of its own to
    anchor under, same as the global log). Enter on a row inserts the adapter's parent block
    `with block("<name>"):` into the current block (`BlockColumns.insert_call`); the brain starts
    an adapter when its parent block starts (`adapters::follow_blocks`), so no start call."""

    DEFAULT_CSS = """
    AdaptersPanel { height: auto; max-height: 14; border: round $panel; margin-bottom: 1; }
    """

    def __init__(self, rapp: "AsemicApp"):
        super().__init__(id="adapters-panel")
        self.rapp = rapp
        self.names: list[str] = []

    def on_mount(self) -> None:
        self.refresh_adapters()

    def refresh_adapters(self) -> None:
        manifests = load_adapter_manifests()
        self.names = [m["name"] for m in manifests]
        status = adapter_status(self.rapp.client, self.names)
        self.clear_options()
        for m in manifests:
            running = status.get(m["name"])
            state = "running" if running else (
                "stopped" if running is False else "?")
            io = " ".join(f"{p['dir']}:{p['name']}" for p in m["io"]) or "·"
            text = f"{m['name']}  [{m['kind']}] {state}  {io}"
            line = Content(text)
            if links_enabled():
                line = line.stylize(
                    f"link {file_uri(m['path'])}", 0, len(m["name"]))
            self.add_option(Option(line, id=m["name"]))

    def on_option_list_option_selected(self, ev: OptionList.OptionSelected) -> None:
        ev.stop()
        name = ev.option_id
        if name is None:
            return
        cols = self.rapp.query_one(BlockColumns)
        # close the panel first: `insert_call` reloads `#rows`
        self.rapp.action_toggle_adapters()
        cols.insert_call(f'with block({name!r}):\n    pass')


class TexPanel(Vertical):
    """Texture node (`asemic/state/tex/<id>` = brain NodeInfo) + opt-in frame preview."""

    DEFAULT_CSS = """
    TexPanel { height: auto; border: round $panel; padding: 0 1; margin-bottom: 1; }
    TexPanel .title { color: $accent; text-style: bold; }
    TexPanel Horizontal { height: auto; }
    """

    def __init__(self, node: dict, repl_app: "AsemicApp"):
        super().__init__(id=f"tex-{_slug(node['id'])}")
        self.node, self.rapp = node, repl_app

    @property
    def tid(self) -> str:
        return self.node["id"]

    def _title(self) -> str:
        n = self.node
        # Upstream refs: inputs (other texes/noise) + src (procs)
        upstream = tex_refs(n)
        upstream_links = ', '.join(
            map(_component_link, upstream)) if upstream else '·'
        tail = f"  ~ {upstream_links}"
        back = self.rapp.backlinks(self.tid)
        tail += f"  ← {', '.join(map(_component_link, back))}" if back else ""
        status = "" if n.get("live", True) else "  (offline)"
        return (f"{escape(display_path(n['id']))}  \\[{escape(n['kind'])}] "
                f"{n.get('w')}x{n.get('h')}{status}{tail}")

    def refresh_title(self) -> None:
        if not (titles := self.query(".title")):  # mounted, not yet composed: compose renders it
            return
        titles.first(Static).update(self._title())

    def compose(self) -> ComposeResult:
        n = self.node
        inputs = ", ".join(display_path(ref) for ref in n.get("inputs") or []) or "·"
        flow = f"{inputs} -> {display_path(n['id'])}"
        mode = f"pingpong smooth {n.get('smooth', 0):g}" if n.get(
            "pingpong") else "direct"
        sinks = ", ".join(f"{s} ({c})" for s,
                          c in n.get("sinks") or []) or "none"
        yield Static(self._title(), classes="title")
        yield Static(f"{flow}   {mode}", markup=False)
        yield Static(f"sinks: {sinks}", markup=False)
        # preview always on, inside this panel (= under the tex's own row), !opt-in switch +
        # !floating at the end of #rows (J 2026-10-11); unmount undeclares -> brain stops frames.
        yield BufferView(n["id"], "frame", client=self.rapp.client)


class EmbedView(Vertical):
    """`embed(id)`: link to node `id` (click = jump to its declaring row, jumplist entry) + the
    node's own built-in preview (`preview_kind`) -- the same stream its panel shows."""

    DEFAULT_CSS = """
    EmbedView { height: auto; }
    EmbedView .title { color: $accent; }
    """

    def __init__(self, nid: str, repl_app: "AsemicApp"):
        super().__init__(id=embed_id(nid))
        self.nid, self.rapp = nid, repl_app

    def compose(self) -> ComposeResult:
        yield Static(f"↪ {_component_link(self.nid)}", classes="title", markup=True)
        kind = preview_kind(self.rapp.state, self.nid)
        yield BufferView(self.nid, kind, client=self.rapp.client,
                         wid=f"{embed_id(self.nid)}-{kind}")


class BufferView(Vertical):
    """Terminal preview of a points stream or a raster frame; owns its Zenoh subscription
    (undeclared on removal, so brain preview matching stops the frames)."""

    DEFAULT_CSS = """
    BufferView { height: 14; border: round $secondary; }
    BufferView > * { width: 1fr; height: 1fr; }
    """

    def __init__(self, stream: str, kind: str, client: Any = None, wid: str | None = None):
        super().__init__(id=wid or (view_id(stream, kind) + "-inline"))
        self.stream, self.kind = stream, kind
        self.latest: bytes | None = None
        self.sub: Any = None
        # set = self-subscribing (TexPanel inline preview)
        self.client = client
        self.look = self._declared()
        self.border_title = f"{self.look}: {display_path(stream)}"

    def _declared(self) -> str:
        """Producer-declared renderer (`State` mirror of `asemic/state/preview/<id>.kind`), else default."""
        state = getattr(self.app, "state", None) if self.is_attached else None
        v = state.get("preview_kind", self.stream) if state is not None else None
        return v if v in LOOKS else default_look(self.kind)

    def set_look(self) -> None:
        """Declaration changed: swap the body, redraw the cached frame."""
        look = self._declared()
        if look == self.look:
            return
        self.look, self.border_title = look, f"{look}: {display_path(self.stream)}"
        self.refresh(recompose=True)
        self.call_after_refresh(self._redraw_last)

    def _redraw_last(self) -> None:
        self.latest = LAST_FRAME.get(self.stream)
        self.tick()

    def compose(self) -> ComposeResult:
        # image look -> `textual_image` (kitty TGP on Ghostty / sixel / halfcell, auto-detected,
        # real resampling); widget class = `ui(image=...)` (default auto; namespace.UI).
        # dots/ascii = text (`canvas.braille` / `canvas.ascii_image`)
        image_kind = cast(str, UI.get("image")) or "auto"
        self.body: Widget = IMAGE_KINDS.get(image_kind, timg.Image)(
        ) if self.look == "image" else Static("", markup=False)
        yield self.body

    def update(self, content: Any) -> None:
        if isinstance(self.body, Static):
            self.body.update(content)
        else:  # image body (frame): errors go to the border, !crash
            self.border_subtitle = str(content)

    def on_mount(self) -> None:
        if self._declared() != self.look:  # state readable only once attached
            self.set_look()
        if self.latest is None and (raw := LAST_FRAME.get(self.stream)) is not None:
            self._on_frame("", raw)
        if self.client is not None and self.sub is None:
            key = (ids.PREVIEW_PREFIX if self.kind in RASTER else ids.GEN_PREFIX) + self.stream
            self.sub = self.client.subscribe_raw(key, self._on_frame)

    def on_resize(self, ev: Any) -> None:
        """Box size (cells) -> brain: asemic_schema `keys::preview_size(stream)`,
        payload `PreviewSize` {cols, rows}; ascii nodes render their text preview at this grid."""
        if self.client is not None:
            w, h = max(1, self.size.width - 2), max(1, self.size.height - 2)
            self.client.put(
                ids.preview_size(self.stream), {"cols": w, "rows": h})
        # If a frame was already received or seeded from LAST_FRAME before layout settled size,
        # redraw it at the newly-allocated content dimensions.
        if (raw := LAST_FRAME.get(self.stream)) is not None:
            self.latest = raw
            self._draw()

    class Frame(Message):
        pass

    def _on_frame(self, key: str, raw: bytes) -> None:
        """Zenoh thread: keep only the newest frame; 1 pending `Frame` at a time (coalesced),
        drawn at <=ui_hz() -- !polled by the app's tick."""
        LAST_FRAME[self.stream] = raw
        pending, self.latest = self.latest is not None, raw
        if not pending:
            with contextlib.suppress(Exception):
                self.post_message(self.Frame())

    def on_buffer_view_frame(self, ev: "BufferView.Frame") -> None:
        wait = getattr(self, "_last_draw", 0.0) + \
            1 / ui_hz() - time.monotonic()
        if wait > 0:
            self.set_timer(wait, self._draw)
        else:
            self._draw()

    def _draw(self) -> None:
        self._last_draw = time.monotonic()
        self.tick()

    def on_unmount(self) -> None:
        if self.sub is not None:
            with contextlib.suppress(Exception):
                self.sub.undeclare()

    def tick(self) -> None:
        raw, self.latest = self.latest, None
        if raw is None:
            return
        w, h = max(1, self.size.width - 2), max(1, self.size.height - 2)
        try:
            # ascii node: its own glyphs as text (brain host.rs text_frame)
            if raw[:4] == T_MAGIC:
                if not isinstance(self.body, Static):
                    self.body.remove()
                    self.body = Static("", markup=False)
                    self.mount(self.body)
                self.update(raw[F_HEAD.size:].decode("utf-8", "replace"))
            elif self.kind == "points" and self.look == "dots":
                self.update("\n".join(canvas.braille(decode_points(raw), w, h)))
            else:
                # one PIL image per frame (raster, or points drawn at the cell pixel budget
                # ~8x16 px/cell, !full 1280x720 over the tty) -> image / ascii renderer
                if self.kind == "points":
                    img = canvas.lines_image(decode_points(raw), w * 8, h * 16)
                else:
                    f = decode_frame(raw)
                    img = PILImage.frombytes("RGBA", (f.w, f.h), f.rgba).convert("RGB")
                    img.thumbnail((w * 8, h * 16), PILImage.Resampling.BOX)
                if self.look == "image":
                    cast("Any", self.body).image = img
                else:
                    self.update(canvas.ascii_image(img, w, h))
        except Exception as e:  # malformed buffer: show, !crash
            self.update(f"[red]{e}")


class TreeNavApp(App):
    """Window-level arrow tree nav for any App hosting a `#cols` `BlockColumns` (AsemicApp +
    test harnesses; an App subclass, !plain mixin: Textual only merges BINDINGS from DOMNode bases): priority bindings, so arrows nav whatever has focus, !nvim keymap;
    `check_action` hands them back to widgets that own arrows (INSERT, slash menu, sliders, ...)."""

    BINDINGS = [
        Binding("up", "tree_nav('up')", show=False, priority=True, id="nav.up"),
        Binding("down", "tree_nav('down')", show=False, priority=True, id="nav.down"),
        Binding("left", "tree_nav('left')", show=False, priority=True, id="nav.left"),
        Binding("right", "tree_nav('right')", show=False, priority=True, id="nav.right"),
        # shift = drill into/out of the row's own controls (J 2026-10-12)
        Binding("shift+right", "tree_nav('controls')", show=False, priority=True),
        Binding("shift+left", "tree_nav('back')", show=False, priority=True),
        # Tab = same controls action, for iOS terminals that don't send shift+arrow
        # (J 2026-10-12); gated to the row line in NORMAL so it never steals cmd-bar Tab
        Binding("tab", "row_controls", show=False, priority=True),
        Binding("shift+tab", "row_controls_back", show=False, priority=True),
        Binding("space", "toggle_play_row", "play/pause block", show=False, priority=True),
        # Esc on the NORMAL row line = WASD <-> vim nav mode (J 2026-10-15; settings.py)
        Binding("escape", "toggle_wasd", "WASD/vim nav", show=False, priority=True, id="nav.toggle_wasd"),
    ]
    NAV_DEFAULTS = {"nav.up": "up", "nav.down": "down", "nav.left": "left", "nav.right": "right",
                    "nav.toggle_wasd": "escape"}
    wasd = False

    def apply_nav_keymap(self) -> None:
        """Rebuild the keymap from settings for the current mode (`set_keymap`, !update: leaving
        WASD must drop its keys)."""
        from .settings import load_settings
        if not hasattr(self, "settings"):
            self.settings = load_settings()
            self.wasd = self.settings.nav.wasd
        self.set_keymap(self.settings.nav_keymap(self.wasd, self.NAV_DEFAULTS))

    def action_toggle_wasd(self) -> None:
        self.wasd = not self.wasd
        self.apply_nav_keymap()
        self.notify("nav: WASD" if self.wasd else "nav: vim", timeout=1.5)

    def action_tree_nav(self, key: str) -> None:
        """Window-level tree nav (J 2026-10-12): regular arrows = tree nav -- ↑↓ rows, → enter
        the block's child level (peeked → zoom to its level), ← leave one level. Shift+arrows
        = the row's own controls: ⇧→ focus them (block timestretch box / leaf component panel),
        ⇧← back out to the row line."""
        cols = self.query_one("#cols", BlockColumns)
        if self.focused is not cols.line:
            cols.focus_line_normal()
        if key in ("up", "down"):
            # type: ignore[attr-defined]
            cast("NvimRowEditor", cols.line)._row_closed = True
        {"up": lambda: cols.action_move(-1), "down": lambda: cols.action_move(1),
         # regular → = pure tree nav: never focuses controls (that's ⇧→ / Tab)
         "right": lambda: cols.enter_level(controls=False), "left": cols.exit_level,
         # ⇧→ focus the row's controls; no panel / peeked -> fall back to tree-nav enter
         "controls": lambda: None if cols.focus_row_controls() else cols.enter_level(),
         "back": cols.exit_level}[key]()

    def action_row_controls(self) -> None:
        """Tab (iOS-friendly alias of ⇧→): focus the current row's own controls."""
        cols = self.query_one("#cols", BlockColumns)
        if not cols.focus_row_controls():
            cols.enter_level()

    def action_row_controls_back(self) -> None:
        """Shift+Tab (alias of ⇧←): back out to the row line / up one level."""
        self.query_one("#cols", BlockColumns).exit_level()

    def action_toggle_play_row(self) -> None:
        """Space on a block row: toggle play/pause (timestretch 0 <-> its last nonzero value,
        default 1.0) -- same frozen/playing state `action_set_timestretch`'s NumberBox drives."""
        import os as _os, time as _time, traceback as _tb  # DEBUG-TS (temporary)
        cols = self.query_one("#cols", BlockColumns)
        p = cols.path
        if _os.environ.get("ASEMIC_TS_DEBUG", "1") != "0":
            with open("/tmp/asemic_ts.log", "a") as _f:
                _f.write(f"\n>>> {_time.strftime('%H:%M:%S')}.{int(_time.time()*1000)%1000:03d} toggle_play_row path={p}\n")
                _tb.print_stack(file=_f)
        if p is None or not self.doc.is_nest(p):
            return
        ts = self.doc.effective_timestretch(p)
        self.action_set_timestretch(list(p), 0.0 if ts != 0.0 else (self._last_timestretch.get(p) or 1.0))
        if ts != 0.0:
            self._last_timestretch[p] = ts

    def _line_normal_owns(self) -> bool:
        """True only when the row line is focused in NORMAL (not INSERT / slash / search), so
        the Tab bindings never steal keystrokes from other widgets (cmd bar, panels, nvim
        INSERT, which keeps native Tab for indent/complete) -- including a `TextualChoiceInput`
        (LOOP et al) whose dropdown is open and wants Tab to accept the highlighted option."""
        cols = self.query_one("#cols", BlockColumns)
        f = self.focused
        choice = next((a for a in f.ancestors_with_self if isinstance(a, TextualChoiceInput)), None) if f is not None else None
        if choice is not None and choice._list.display:
            return False
        return (f is cols.line and cols.line.mode is not Mode.INSERT
                and not getattr(cols, "_slash_open", False)
                and getattr(cols, "_input_purpose", None) != "search")

    def check_action(self, action: str, parameters: tuple[object, ...]) -> bool | None:
        if action == "tree_nav":
            return self._tree_nav_owns_arrows()
        if action in ("row_controls", "row_controls_back", "toggle_play_row"):
            return self._line_normal_owns()
        if action == "toggle_wasd":  # only a "bare" Esc: !close slash/search/draft, !leave INSERT
            cols = self.query_one("#cols", BlockColumns)
            return self._tree_nav_owns_arrows() and self.focused is cols.line and cols._new_at is None
        return True

    def _tree_nav_owns_arrows(self) -> bool:
        """False = arrows go to the focused widget: INSERT text cursor, slash menu, search,
        value controls (NumberBox/XYPad), log, embedded terminal, option lists, a
        `TextualChoiceInput`'s own dropdown (LOOP et al -- its focus stop is the inner `Input`,
        so the check walks up via `.parent`)."""
        cols = self.query_one("#cols", BlockColumns)
        f = self.focused
        if f is cols.line:
            return (cols.line.mode is not Mode.INSERT and not getattr(cols, "_slash_open", False)
                    and getattr(cols, "_input_purpose", None) != "search")
        if f is not None and any(isinstance(a, TextualChoiceInput) for a in f.ancestors_with_self):
            return False
        return not isinstance(f, (NumberBox, TextualXYPad, MultiSlider, RichLog, PtyTerminal, OptionList, NvimView))


class HelpScreen(ModalScreen):
    """`:help` / `/help` -> key bindings + local slash commands; built from `AsemicApp.BINDINGS` +
    `LOCAL_COMMANDS` (DRY: no hand-kept list). q/esc/? closes."""

    DEFAULT_CSS = """
    HelpScreen { align: center middle; }
    HelpScreen > VerticalScroll { width: 72; max-height: 90%; height: auto; border: round $accent; background: $panel; padding: 0 1; }
    """
    BINDINGS = [Binding("escape,q,question_mark", "dismiss", "close")]

    def __init__(self, nvim: bool = False) -> None:
        super().__init__()
        self.nvim = nvim

    def compose(self) -> ComposeResult:
        keys = "\n".join(
            f"  [b]{escape(cast(Binding, b).key)}[/b]  {escape(cast(Binding, b).description)}" for b in AsemicApp.BINDINGS)
        cmds = "\n".join(
            f"  [b]:{c['verb']}{''.join(' ' + a.upper() for a in c['args'])}[/b]  {escape(c['doc'])}"
            for c in LOCAL_COMMANDS)
        with VerticalScroll() as v:
            v.border_title = "help · q/esc close"
            yield Static(f"[u]keys[/u]\n{keys}\n  [b]enter[/b]  commit+eval row\n  [b]:w :q :wq[/b]  save / quit\n"
                         + ("  [b]:help TOPIC[/b]  nvim's own :help\n" if self.nvim else "") + "\n"
                         f"[u]commands[/u] (`:` or `/`)\n{cmds}")


class GuideScreen(ModalScreen):
    """`:guide` — comprehensive pipeline/scoping guide + an index of every standalone example
    under `examples/`, each line pulled from that file's own header comment (DRY: the index
    never restates per-file prose, just names + glosses + where to find it). q/esc closes."""

    DEFAULT_CSS = """
    GuideScreen { align: center middle; }
    GuideScreen > VerticalScroll { width: 92; max-height: 90%; height: auto; border: round $accent; background: $panel; padding: 0 1; }
    """
    BINDINGS = [Binding("escape,q", "dismiss", "close")]

    def compose(self) -> ComposeResult:
        from .config import example_dirs
        guide_text = (Path(__file__).resolve().parent / "guide.md").read_text()
        rows = []
        for exdir in example_dirs():
            for path in sorted(exdir.glob("*.py")):
                first = path.read_text().splitlines()[0].lstrip("# ").strip()
                rows.append(f"  [b]{path.stem}[/b]  {escape(first)}")
        index = "\n".join(rows)
        with VerticalScroll() as v:
            v.border_title = "guide · q/esc close"
            yield Static(f"{escape(guide_text)}\n\n[u]examples/[/u]\n{index}")


class FunctionsScreen(ModalScreen):
    """`/functions` — browse every livecode verb (brain + local) with its signature and full
    doc; fuzzy-searchable. Enter inserts `<verb>(` into the current row and closes; q/esc
    closes. Docs come from the same table the brain advertises (`Repl.verbs`), which
    `scripts/gen_api.py` also bakes into `asemic_py/_api.pyi` for editor completion."""

    DEFAULT_CSS = """
    FunctionsScreen { align: center middle; }
    FunctionsScreen > Vertical { width: 100; max-width: 92%; height: 80%; border: round $accent; background: $panel; padding: 0 1; }
    FunctionsScreen #fn-search { height: 1; border: none; }
    FunctionsScreen #fn-body { height: 1fr; }
    FunctionsScreen #fn-list { width: 40%; }
    FunctionsScreen #fn-doc { width: 1fr; border-left: solid $panel; padding: 0 1; }
    """
    BINDINGS = [
        Binding("escape,q", "dismiss", "close"),
        Binding("up", "move(-1)", "up", show=False, priority=True),
        Binding("down", "move(1)", "down", show=False, priority=True),
        Binding("enter", "pick", "insert", priority=True),
    ]

    def __init__(self, commands: list[dict]) -> None:
        super().__init__()
        seen: set[str] = set()
        self.rows: list[dict] = []
        for c in [*LOCAL_COMMANDS, *commands]:  # local first, then brain verbs; dedup by verb
            if c["verb"] in seen:
                continue
            seen.add(c["verb"])
            self.rows.append(c)

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Input(placeholder="search functions…", id="fn-search")
            with Horizontal(id="fn-body"):
                yield OptionList(id="fn-list")
                with VerticalScroll(id="fn-doc"):
                    yield Static("", id="fn-doc-text", markup=False)

    def on_mount(self) -> None:
        self._populate("")
        self.query_one("#fn-search", Input).focus()

    @staticmethod
    def _sig(c: dict) -> str:
        return f"{c['verb']}({', '.join(c['args'])})" if c["args"] else f"{c['verb']}()"

    def _matches(self, q: str) -> list[dict]:
        q = q.strip().lower()
        if not q:
            return self.rows

        def score(c: dict) -> int:
            if c["verb"].lower().startswith(q):
                return 3
            if q in c["verb"].lower():
                return 2
            return 1 if q in f"{' '.join(c['args'])} {c['doc']}".lower() else 0

        return [c for s, c in sorted(((score(c), c) for c in self.rows), key=lambda sc: sc[0], reverse=True) if s]

    def _populate(self, q: str) -> None:
        dd = self.query_one("#fn-list", OptionList)
        matches = self._matches(q)
        dd.clear_options()
        for c in matches:
            dd.add_option(Option(Content(self._sig(c)), id=c["verb"]))
        dd.highlighted = 0 if matches else None
        self._show_doc(matches[0] if matches else None)

    def _show_doc(self, c: dict | None) -> None:
        txt = self.query_one("#fn-doc-text", Static)
        if c is None:
            txt.update("no matches")
            return
        sig = self._sig(c)
        txt.update(f"{sig}\n{'─' * len(sig)}\n\n{c['doc']}")

    def _by_verb(self, verb: str | None) -> dict | None:
        return next((c for c in self.rows if c["verb"] == verb), None)

    def on_input_changed(self, ev: Input.Changed) -> None:
        self._populate(ev.value)

    def on_input_submitted(self, ev: Input.Submitted) -> None:
        self.action_pick()

    def on_option_list_option_selected(self, ev: OptionList.OptionSelected) -> None:
        ev.stop()
        self.dismiss(ev.option_id)

    def on_option_list_option_highlighted(self, ev: OptionList.OptionHighlighted) -> None:
        self._show_doc(self._by_verb(ev.option.id))

    def action_move(self, delta: int) -> None:
        dd = self.query_one("#fn-list", OptionList)
        if dd.option_count:
            cur = dd.highlighted if dd.highlighted is not None else 0
            dd.highlighted = max(0, min(dd.option_count - 1, cur + delta))
        # arrows always land back in the search box: never strand the keyboard on the list
        # (priority bindings fire regardless of which widget currently has focus)
        self.query_one("#fn-search", Input).focus()

    def action_pick(self) -> None:
        dd = self.query_one("#fn-list", OptionList)
        verb = dd.get_option_at_index(dd.highlighted).id if (dd.highlighted is not None and dd.option_count) else None
        self.dismiss(verb)


class AsemicApp(TreeNavApp):
    TITLE = "asemic"
    CSS = """
    Screen, App { background: transparent; }
    Screen { layers: base overlay; }
    #cols { height: 1fr; layer: base; }
    /* Global log only (components/views render inline in `#cols` now, see module docstring):
    docked bottom, hidden by sliding below the screen (offset), !display:none, so it keeps a
    real width and goes on buffering `log_line`s while toggled off (2026-10-10). */
    #log { layer: overlay; dock: bottom; height: 40%; border-top: solid $panel; offset-y: 100%; }
    #log.shown { offset-y: 0%; }
    """
    BINDINGS = [
        # was ctrl+o: now nvim jumplist
        Binding("ctrl+l", "toggle_focus", "log", priority=True),
        Binding("ctrl+o", "jump_history(-1)", "jump back", priority=True),
        Binding("ctrl+i", "jump_history(1)", "jump fwd", priority=True),
        Binding("ctrl+s", "save", "save", priority=True),
    ]

    def __init__(self, client: Client | None = None, code: str = "", path: Path | None = None, run: bool = False,
                 label: str | None = None, nvim: bool = False, autosave: bool = True):
        super().__init__()
        self.register_theme(Theme(
            name="asemic-mono",
            primary="#ffffff",
            secondary="#aaaaaa",
            accent="#ffffff",
            foreground="#ffffff",
            warning="#ffa62b",
            error="#ba3c5b",
            success="#4ebf71",
            dark=True,
        ))
        self.theme = "asemic-mono"
        self.client = client or Client()
        self.path = path
        # embedded-Neovim editor (the only editor; False = tests' headless fallback)
        self.nvim_mode = nvim
        # asemic:// jump landing on a cold-started REPL (jump.py)
        self._initial_label = label
        migrated = any(LABEL_RE.match(l)
                       for l in code.split("\n")) and "with block(" not in code
        if migrated:
            # legacy `# @label` file: migrate in memory
            code = from_labels(code)
        self.doc = Doc(code, path=path, autosave=autosave)
        if migrated and path:
            # else BlockColumns' sync() would see disk != tree and revert the migration
            self.doc._write()
        self.run_on_start = run
        self.repl = Repl(self.client)
        self.repl.on_embed = self._request_embed
        self.repl.path = path
        self.components: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._values: dict[tuple[str, str], float] = {}
        self._attrs: dict[str, dict | None] = {}
        # proc id -> asemic/meta/<id>.attrs
        self.dims: dict[str, dict | None] = {}
        self._defs: list[tuple[str, dict | None]] = []
        self.texs: dict[str, dict] = {}
        self._tex_defs: list[tuple[str, dict | None]] = []
        # live brain-state mirror (state.py); `_on_state` feeds the buffers above
        self.state = State()
        self._links_dirty = False  # a route changed -> panel backlinks may have
        self._props_dirty: set[str] = set()
        # value space only: panel previews  # noise/proc ids whose plugin props (re)arrived
        self._live: dict[tuple[str, str], float] = {}
        self._flush_pending = False
        self._last_flush = 0.0
        # node ids of `embed(...)` rows
        self.embeds: set[str] = set()
        self._looks_dirty: set[str] = set()
        # prefix -> last signature `_rehome` ran for
        self._rehome_sig: dict[str, tuple] = {}
        # last signature `_place_blocks` (nest-row preview panels) ran for
        self._block_sig: tuple | None = None
        # block label -> live playhead seconds (`asemic/block/<label>.time`)
        self._block_times: dict[str, float] = {}
        # row path -> timestretch to restore on space-toggle resume (`action_toggle_play_row`)
        self._last_timestretch: dict[RowPath, float] = {}

    # ------------------------------------------------------------ layout
    def compose(self) -> ComposeResult:
        """Single panel (2026-10-10): `BlockColumns` fills the screen, zooming into/out of nests
        in place (→/←, breadcrumb in its own `#crumb` header); every row's own param/tex/view
        panel mounts inline under that row, inside `BlockColumns`' own `#rows` (see module
        docstring). Only the global eval log is a docked overlay, hidden until Ctrl+L.

        nvim editor: `BlockColumns` stays the main UI (tree, folds, sliders,
        previews); its `#line` row editor becomes an `NvimRowEditor` instead of
        `RowVimTextArea` (`BlockColumns(nvim=...)`), editing only the focused row. Default
        (unflagged) behavior is unchanged."""
        yield BlockColumns(self.doc, commands=self.repl.verbs, client=self.client, nvim=self.nvim_mode, ns=self.repl.ns, id="cols")
        yield RichLog(id="log", wrap=True, markup=True)

    def on_mount(self) -> None:
        self.apply_nav_keymap()
        self.state.listen(self._on_state)
        # primes every keyspace, then keeps it in sync
        self.state.attach(self.client)
        # asemic:// jump (jump.py): advertise + listen for landings
        if self.path is not None:
            self.client.put(f"{OPEN_PREFIX}/{os.getpid()}",
                            {"file": str(self.path.resolve())})
        self.client.subscribe(JUMP_KEY, self._on_jump)
        # draw-graph runtime errors, proc errors, and adapter errors (asemic/err/<kind>/<ident>)
        # (post_message, !call_from_thread: the "cleared" message lands mid-eval, while this thread awaits a reply)
        self.client.subscribe_raw("asemic/err/*/**", cast(Any, lambda k, b: self.post_message(
            self.RowError(*k.split("/", 3)[2:4], b.decode()))))
        # Keep LAST_FRAME warm globally across all preview & point streams (affinity/output/tex/procs),
        # throttled to <=1 Hz for background/non-visible nodes so high-frequency streams don't churn cache.
        _last_cached: dict[str, float] = {}

        def _cache_preview(k: str, b: bytes) -> None:
            ident = k.removeprefix(ids.PREVIEW_PREFIX)
            now = time.monotonic()
            if now - _last_cached.get(ident, 0.0) >= 1.0:
                _last_cached[ident] = now
                LAST_FRAME[ident] = b
        self.client.subscribe_raw("asemic/preview/**", _cache_preview)

        def _cache_gen(k: str, b: bytes) -> None:
            ident = k.removeprefix(ids.GEN_PREFIX)
            now = time.monotonic()
            if now - _last_cached.get(ident, 0.0) >= 1.0:
                _last_cached[ident] = now
                LAST_FRAME[ident] = b
        self.client.subscribe_raw("asemic/gen/**", _cache_gen)
        self._kick()  # drain what on_mount's initial gets queued
        self.query_one("#cols", BlockColumns).line.focus()
        self.log_line(
            "[dim]Enter commit+eval row · :run eval all · Ctrl+L log · :help · Ctrl+Q quit")
        if self.run_on_start:
            self.action_eval_all(startup=True)  # syncs pauses too
        else:
            try:
                # brain pause state := the code's
                self.repl.sync_timestretches(self.doc)
            except Exception as e:
                self.log_line(f"[red]pause sync: {e}")
        if self._initial_label:  # started cold by jump.py's "no running REPL had it open" branch
            self._do_jump(self._initial_label)

    def save(self) -> None:
        if self.doc.flush():
            self.log_line(f"[dim]{self.path} written")

    async def action_quit(self) -> None:
        self.save()
        self.exit()

    def on_unmount(self) -> None:
        if self.path is not None:
            with contextlib.suppress(Exception):
                self.client.delete(f"{OPEN_PREFIX}/{os.getpid()}")
        self.client.close()

    # ------------------------------------------------------------ component links (panel titles)
    def backlinks(self, cid: str) -> list[str]:
        return self.state.backlinks(cid.split(":")[0])

    def _resolve_ref(self, ref: str) -> str:
        """Any link ref -> the component/tex id owning it: raw keys (`asemic/<space>/<cid>.k`,
        any space) drop the space prefix; then the longest known enclosing path of `cid`."""
        known = set(self.components) | set(self.texs)
        pre = next((p for _, _, p, _ in _SORTED_SPACES if p and ref.startswith(p)), None)
        if pre:
            ref = ref[len(pre):]
        elif ref.startswith("asemic/") and ref.count("/") >= 2:  # unmirrored space (value/meta/...)
            ref = ref.split("/", 2)[2]
        return next((p for p in ids.ancestors(ref) if p in known), ids.split_field(ref)[0])

    def action_goto_comp(self, cid: str) -> None:
        if cid.startswith("route:"):
            kinds, cid = ["route"], cid[len("route:"):]
        else:
            cid = self._resolve_ref(cid)
            kinds = [self.components[cid]["type"]] if cid in self.components else [
                "noise", "param", "multi", "xy", "proc", "tex", "affinity"]
        cols = self.query_one("#cols", BlockColumns)
        if not any(cols.goto_comp(k, cid) for k in kinds):
            self.notify(f"no row declares {display_path(cid)!r}", severity="warning")

    def action_jump_history(self, step: int) -> None:
        self.query_one("#cols", BlockColumns).jump_history(step)

    # ------------------------------------------------------------ asemic:// jump (jump.py)
    def _do_jump(self, label: str) -> None:
        if not self.query_one("#cols", BlockColumns).focus_label(label):
            self.notify(
                f"no block labeled {display_path(label)!r} (stale link?)", severity="warning")

    def _on_jump(self, key: str, put: bool, v: Any) -> None:
        """`JUMP_KEY` fires for every REPL on the bus; only act when `v["file"]` is *this*
        REPL's own doc (zenoh's thread, hence `call_from_thread` back onto Textual's)."""
        if not put or not isinstance(v, dict) or self.path is None:
            return
        file, label = v.get("file"), v.get("label")
        if not file or not label or Path(file).resolve() != self.path.resolve():
            return
        self.call_from_thread(self._do_jump, label)

    # ------------------------------------------------------------ zenoh threads -> buffers
    def _on_state(self, space: str, ident: str, v: Any) -> None:
        """`State` change (zenoh's thread): queue the delta for `_tick`, then wake the UI."""
        with self._lock:
            if space == "component":
                self._defs.append((ident, v if isinstance(v, dict) else None))
            elif space == "tex":
                self._tex_defs.append(
                    (ident, v if isinstance(v, dict) else None))
            elif space == "route":
                self._links_dirty = True
            elif space == "props":
                self._props_dirty.add(ident)
            elif space in ("value", "param"):  # param = stored (route-written) prop values
                comp, k = ids.field(ident, "value")  # `<slash id>.<key>`
                if isinstance(v, (int, float)):
                    # proc channels share `asemic/value/`: output only, !slider
                    gen = space == "value" and (self.components.get(comp) or {}).get("type") == "proc"
                    if not gen:
                        self._values[(comp, k)] = float(v)
                    if space == "value":
                        self._live[(comp, k)] = float(v)
            elif space == "attrs":
                self._attrs[ident] = v if isinstance(v, dict) else None
            elif space == "preview_kind":
                self._looks_dirty.add(ident)
            elif space == "block_timestretch":
                if isinstance(v, (int, float)):
                    for bp in self.query(BlockPanel):
                        if bp.label == ident and bp.box is not None and not bp.box.has_focus:
                            bp.box.value = float(v)
            elif space == "block_length":
                if isinstance(v, (int, float)):
                    for bp in self.query(BlockPanel):
                        if bp.label == ident and bp.length_box is not None and not bp.length_box.has_focus:
                            bp.length_box.value = float(v)
            elif space == "block_loop":
                if isinstance(v, str):
                    for bp in self.query(BlockPanel):
                        if bp.label == ident and bp.loop_input is not None and not bp.loop_input.has_focus:
                            bp.loop_input.set_value(v)
            elif space == "block_time":
                if isinstance(v, (int, float)):
                    self._block_times[ident] = float(v)
                else:
                    self._block_times.pop(ident, None)
            elif space == "clock":
                if not UI["clock"]:
                    return
            elif space == "ui":
                if not isinstance(v, dict) or v == UI:
                    return
                UI.update(v)
                self._ui_dirty = True
        self._kick()  # !call_from_thread: blocks zenoh's thread while a block exec awaits a reply

    def _apply_ui(self) -> None:
        """brain `asemic/state/ui` changed: rebuild frame previews so a new `image` renderer takes effect."""
        for v in self.query(BufferView):
            if v.look == "image":
                v.refresh(recompose=True)
                v.call_after_refresh(v._redraw_last)

    # ------------------------------------------------------------ event-driven flush
    # Zenoh threads queue into the coalescing buffers above, then `_kick` posts ONE `Flush`
    # (thread-safe `post_message`) until it's drained -- !fixed-rate polling: idle = 0 work.
    # Rate-capped at UI_HZ so a 60Hz+ value stream still coalesces into <=ui_hz() redraws.
    class Flush(Message):
        pass

    def _kick(self) -> None:
        with self._lock:
            if self._flush_pending:
                return
            self._flush_pending = True
        try:
            self.post_message(self.Flush())
        except Exception:  # app not running yet / shutting down
            with self._lock:
                self._flush_pending = False

    def on_asemic_app_flush(self, ev: "AsemicApp.Flush") -> None:
        wait = self._last_flush + 1 / ui_hz() - time.monotonic()
        if wait > 0:
            self.set_timer(wait, self._flush)
        else:
            self._flush()

    def _flush(self, stderr: bool = False) -> None:
        self._last_flush = time.monotonic()
        with self._lock:
            self._flush_pending = False
        if getattr(self, "_ui_dirty", False):
            self._ui_dirty = False
            self._apply_ui()
        self._tick()

    def on_block_columns_rows_changed(self, ev: "BlockColumns.RowsChanged") -> None:
        """Rows (re)rendered / zoom changed: re-place panels + previews into their RowBoxes."""
        cols: BlockColumns = self.query_one("#cols", BlockColumns)
        rows_w = cols.query_one("#rows")
        if rows_w:
            self._rehome(cols, rows_w, self.components,
                         "comp", ComponentPanel)
            self._rehome(cols, rows_w, self.texs, "tex", TexPanel)
        self._place_embeds(cols)
        self._place_row_previews(cols)
        self._place_blocks(cols)

    def _tick(self) -> None:
        # absent before compose / during shutdown: keep queued
        cols: BlockColumns
        try:
            cols = self.query_one("#cols", BlockColumns)
        except NoMatches:
            return
        with self._lock:
            defs, self._defs = self._defs, []
            tex_defs, self._tex_defs = self._tex_defs, []
            values, self._values = self._values, {}
            attrs, self._attrs = self._attrs, {}
            props, self._props_dirty = self._props_dirty, set()
            live, self._live = self._live, {}
            looks, self._looks_dirty = self._looks_dirty, set()
        self._sync(cols, defs, self.components, "comp", ComponentPanel)
        self._sync(cols, tex_defs, self.texs, "tex", TexPanel)
        links, self._links_dirty = self._links_dirty, False
        if defs or tex_defs or links:  # links/backlinks span comps, texs + routes
            for p in [*self.query(ComponentPanel), *self.query(TexPanel)]:
                p.refresh_title()
        for cid in props:  # slider set comes from props: rebuild those panels
            for w in self.query(f"#comp-{_slug(cid)}"):
                w.refresh(recompose=True)
        for (cid, key), v in values.items():
            for w in self.query(f"#comp-{_slug(cid)}"):
                w.apply_value(key, v)  # type: ignore[union-attr]
        for (cid, key), v in live.items():
            for w in self.query(f"#comp-{_slug(cid)}"):
                w.apply_live(key, v)  # type: ignore[union-attr]
        for v in self.query(BufferView):
            if v.stream in looks:
                v.set_look()
        for cid, v in attrs.items():
            self.dims[cid] = v
            for w in self.query(f"#comp-{_slug(cid)}"):
                w.apply_attrs(v)  # type: ignore[union-attr]
        self._place_embeds(cols)
        self._place_row_previews(cols)
        self._place_blocks(cols)
        for w in self.query(BlockPanel):  # live playhead from `asemic/block/<label>.time`
            w.apply_time(self._block_times.get(w.label))  # type: ignore[union-attr]

    def _sync(self, cols: BlockColumns, defs: list, store: dict, prefix: str, panel: type) -> None:
        """Remount `#<prefix>-<id>` panels whose state changed (None = gone), right after the
        row that created them (`cols.anchor_widget`) -- skipped (and re-tried every tick via
        `_rehome`) while that row isn't visible at the current zoom level."""
        if not defs and self._rehome_sig.get(prefix) == self._rehome_key(cols, store):
            # nothing new, nothing moved: skip the DOM queries below (idle hot path)
            return
        found_rows = cols.query("#rows")
        if not found_rows:
            return
        rows_w = found_rows.first()
        latest: dict[str, Any] = {}
        for i, d in defs:
            latest[i] = d
        for i, d in latest.items():
            if d == store.get(i):
                continue
            stale = self.query(f"#{prefix}-{_slug(i)}")
            for w in stale:
                w.remove()
            if d is None:
                store.pop(i, None)
            else:
                store[i] = d
                anchor = cols.anchor_widget(
                    d.get("type", "tex") if prefix == "comp" else "tex", i)
                if anchor is not None:
                    # `Widget.remove()` above only *schedules* removal (async, done on the
                    # message pump) -- mounting the replacement in the same tick raced it and
                    # raised `DuplicateIds` on the stale widget's id (same hazard noted in
                    # `_request_view`); defer to the next refresh so the removal lands first.
                    def mount(d=d, anchor=anchor, ident=i):
                        if not self.query(f"#{prefix}-{_slug(ident)}"):
                            # into the row's own RowBox
                            anchor.mount(panel(d, self))
                    self.call_after_refresh(mount) if stale else mount()
        self._rehome(cols, rows_w, store, prefix, panel)

    @staticmethod
    def _rehome_key(cols: BlockColumns, store: dict) -> tuple:
        return (id(cols.doc), cols.doc.version, cols._row_gen, cols.parent_path, frozenset(cols._expanded), cols._foldlevel, frozenset(store))

    def _rehome(self, cols: BlockColumns, rows_w: Widget, store: dict, prefix: str, panel: type) -> None:
        """Every known component/tex lives INSIDE its row's `RowBox` (`cols.anchor_widget`):
        Textual layout then keeps it under its line; a row !visible at this zoom = no box ->
        panel removed (remounted fresh on return). A reused box now holding a different row
        (zoom/edit shifted indices) -> panel moved to the right box. Gated on `_rehome_key`."""
        sig = self._rehome_key(cols, store)
        if self._rehome_sig.get(prefix) == sig:
            return
        self._rehome_sig[prefix] = sig
        for i, d in store.items():
            box = cols.anchor_widget(
                d.get("type", "tex") if prefix == "comp" else "tex", i)
            self._ensure_in(box, f"{prefix}-{_slug(i)}",
                            lambda d=d: panel(d, self))

    def _ensure_in(self, box: Widget | None, wid: str, make: Any) -> None:
        """Widget `#wid` mounted inside `box` and nowhere else (box None = row hidden -> none)."""
        mounted = [w for w in self.query(f"#{wid}")]
        for w in mounted:
            if w.parent is not box:
                w.remove()
        if box is not None and not any(w.parent is box for w in mounted):
            if any(w.parent is not box for w in mounted):
                self.call_after_refresh(lambda: box.is_attached and not self.query(
                    f"#{wid}") and box.mount(make()))
            else:
                box.mount(make())

    # ------------------------------------------------------------ actions
    def log_line(self, s: str) -> None:
        self.query_one("#log", RichLog).write(s)

    def on_block_columns_committed(self, ev: BlockColumns.Committed) -> None:
        """A row was written back: nest header -> its whole subtree; leaf -> its enclosing nest's leaves."""
        doc, path = self.doc, ev.path
        if doc.is_nest(path):
            label, out = doc.label(path), self.repl.run_tree(doc, path)
        else:
            nest = path[:-1]
            label, out = doc.label(nest), self.repl.run_nest(doc, nest)
        self.log_line(f"[green]▶ {display_path(label)}")
        if out.strip():
            self.log_line(out.rstrip())

    def cook_block(self, path: list[int]) -> None:
        """COOK = play exactly one frame: the block's rows are (re-)evaluated so edits land, then
        the brain steps it one frame at timestretch 1 (`asemic/block/<label>.step`)."""
        p, doc = tuple(path), self.doc
        label = doc.label(p)
        try:
            out = self.repl.run_tree(doc, p)
            if out.strip():
                self.log_line(out.rstrip())
        except Exception as e:
            self.doc.run_errors[p] = f"cook: {e}"
            self.doc._touch()
            return
        self.client.put(ids.block_step(label), {})
        self.log_line(f"[green]⏯ {label} one frame")

    def action_set_timestretch(self, path: list[int], value: float) -> None:
        """The block preview's timestretch NumberBox: set the block's own timing (0.0 = frozen,
        1.0 = real-time, >1 faster, <0 reverse), write it into the code + brain. A non-zero
        value on a not-yet-run block starts it; 0.0 freezes it."""
        p, doc = tuple(path), self.doc
        if not doc.is_nest(p):
            return

        import os as _os, time as _time, traceback as _tb  # DEBUG-TS (temporary)
        if _os.environ.get("ASEMIC_TS_DEBUG", "1") != "0":
            with open("/tmp/asemic_ts.log", "a") as _f:
                _f.write(f"\n=== {_time.strftime('%H:%M:%S')}.{int(_time.time()*1000)%1000:03d} set_timestretch path={p} value={value}\n")
                _tb.print_stack(file=_f)

        doc.set_timestretch(p, value)
        label = doc.label(p)

        try:
            # 1. First, when starting/playing: load and mount the entire recursive block tree
            if value != 0.0:
                out = self.repl.run_tree(doc, p)
                if out.strip():
                    self.log_line(out.rstrip())
            else:
                self.repl.pause_nest(doc, p)

            # 2. THEN, once all recursive blocks are fully loaded & registered, set timestretch & trigger processing
            self.client.put(ids.block_timestretch(label), value)

            if value != 0.0:
                # Step the block and all child blocks recursively so initial frames cook
                for sub_p, _ in doc.walk(p):
                    if doc.is_nest(sub_p):
                        self.client.put(ids.block_step(doc.label(sub_p)), {})
        except Exception as e:
            self.doc.run_errors[p] = f"timestretch: {e}"  # error view under the row
            self.doc._touch()
        self.log_line(f"[yellow]⏸ {label} frozen" if value == 0.0
                      else f"[green]▶ {label} timestretch={value:g}")
        cols = self.query_one("#cols", BlockColumns)
        if cols.path == p and cols.line.text == cols._loaded:
            cols._load()  # reflect the source-of-truth timestretch edit
        else:
            cols.refresh_rows()

    def action_set_block_length(self, path: list[int], value: float) -> None:
        """The block preview's LENGTH box: playback length in seconds (0 = infinite). Writes
        `length=<s>` into the code and pushes the brain's `.../length` state."""
        p, doc = tuple(path), self.doc
        if not doc.is_nest(p):
            return
        length = value if value > 0 else None
        doc.set_length(p, length)
        label = doc.label(p)
        key = ids.block_length(label)
        if length is None:
            self.client.delete(key)
        else:
            self.client.put(key, length)
        self.log_line(f"[cyan]{label} length={'inf' if length is None else f'{length:g}s'}")
        self._reload_block_row(p)

    def action_set_block_loop(self, path: list[int], name: str) -> None:
        """The block preview's LOOP selector: the block's loop envelope (`off`/`loop`/`pingpong`)."""
        p, doc = tuple(path), self.doc
        if not doc.is_nest(p):
            return
        doc.set_loop(p, name or None)
        label = doc.label(p)
        key = ids.block_loop(label)
        if name:
            self.client.put(key, name)
        else:
            self.client.delete(key)
        self.log_line(f"[cyan]{label} loop={name or 'loop'}")
        self._reload_block_row(p)

    def action_seek_block(self, path: list[int], value: float) -> None:
        """The block preview's TIME box: scrub the block's playhead (seek, seconds). Writes the
        brain's seek input `asemic/state/block/<label>/time` (the live playhead rides
        `asemic/block/<label>.time`)."""
        p, doc = tuple(path), self.doc
        if not doc.is_nest(p):
            return
        label = doc.label(p)
        self.client.put(f"{ids.BLOCK_PREFIX}{label}{ids.BLOCK_TIME_SUFFIX}", value)
        self._block_times[label] = value

    def _reload_block_row(self, p: tuple[int, ...]) -> None:
        """Reflect a code write into the focused row editor if it holds the same source."""
        cols = self.query_one("#cols", BlockColumns)
        if cols.path == p and cols.line.text == cols._loaded:
            cols._load()
        else:
            cols.refresh_rows()

    class RowError(Message):
        def __init__(self, kind: str, ident: str, msg: str) -> None:
            super().__init__()
            self.kind, self.ident, self.msg = kind, ident, msg

    def on_asemic_app_row_error(self, ev: "AsemicApp.RowError") -> None:
        """`asemic/err/<verb>/<id>` (tex shader, py proc, adapter row): show (msg) / clear ("") the
        runtime error on the row declaring `<verb>("<id>", ...)`."""
        kind, tid, msg = ev.kind, ev.ident, ev.msg
        cols = self.query_one("#cols", BlockColumns)
        p = cols.comp_row(kind, tid)
        if p is None:
            # Check aliases (e.g. kind 'supercollider' maps to 'sc')
            aliases = {"supercollider": ["sc"]}
            for alias in aliases.get(kind, []):
                p = cols.comp_row(alias, tid)
                if p is not None:
                    break
        if p is None:
            # Fall back to the first row belonging to this adapter/kind in the doc
            adapter_verbs = {"supercollider": ["sc", "supercollider"], "affinity": ["affinity"]}
            target_verbs = set(adapter_verbs.get(kind, [kind]))
            for walk_p, src in self.doc.walk():
                call = bare_call(src, target_verbs)
                if call is not None:
                    p = walk_p
                    break
        if p is None or self.doc.run_errors.get(p) == (msg or None):
            return
        if msg:
            self.doc.run_errors[p] = msg
            self.log_line(f"[red]{kind} {tid}: {msg}")
        else:
            self.doc.run_errors.pop(p, None)
        self.doc._touch()
        cols.refresh_rows()
        cols.refresh_crumb()
        for bp in self.query(BlockPanel):
            bp.sync(bp.row)

    def on_block_columns_deleted(self, ev: BlockColumns.Deleted) -> None:
        for label in ev.labels:
            self.repl.drop(label)

    def on_block_columns_file_opened(self, ev: BlockColumns.FileOpened) -> None:
        """`/open`/`/o` swapped `BlockColumns`' doc: follow, so `action_eval_all` and
        `on_block_columns_committed` (both read `self.doc`) stay pointed at it."""
        self.doc, self.path = ev.doc, ev.doc.path
        self.repl.path = self.path

    def on_block_columns_command(self, ev: BlockColumns.Command) -> None:
        if ev.name == "help":
            if ev.args and self.nvim_mode:  # `:help TOPIC` -> real nvim :help pane
                self.on_nvim_row_editor_help_requested(
                    NvimRowEditor.HelpRequested(" ".join(ev.args)))
            else:
                self.push_screen(HelpScreen(nvim=self.nvim_mode))
        elif ev.name == "run":
            self.action_eval_all()
        elif ev.name == "clear":
            self.query_one("#log", RichLog).clear()
        elif ev.name == "log":
            self.action_toggle_focus()
        elif ev.name == "adapters":
            self.action_toggle_adapters()
        elif ev.name in ("functions", "fn"):
            self.push_screen(FunctionsScreen(self.repl.verbs), callback=self._insert_function)
        elif ev.name == "guide":
            self.push_screen(GuideScreen())

    def _insert_function(self, verb: str | None) -> None:
        """`/functions` pick: insert `<verb>(` as a new row at the cursor (same move the
        `/adapters` panel makes), so the user fills in the args in-place."""
        if verb:
            self.query_one("#cols", BlockColumns).insert_call(f"{verb}(")

    def on_nvim_row_editor_help_requested(self, ev: NvimRowEditor.HelpRequested) -> None:
        """`:help` -> asemic help; `:help TOPIC` -> real nvim :help pane at the end of `#rows` (nvim mode only)."""
        if not ev.topic:
            self.push_screen(HelpScreen(nvim=True))
            return
        for old in self.query(NvimHelpView):
            old.remove()
        view = NvimHelpView(ev.topic)
        self.query_one("#cols", BlockColumns).query_one("#rows").mount(view)
        view.focus()
        view.scroll_visible()

    def on_nvim_help_view_closed(self, ev: NvimHelpView.Closed) -> None:
        for v in self.query(NvimHelpView):
            v.remove()
        self.query_one("#cols", BlockColumns).focus_line_normal()

    def action_eval_all(self, startup: bool = False) -> None:
        out = self.repl.run_all(self.doc, startup=startup)
        self.log_line("[green]▶ all")
        if out.strip():
            self.log_line(out.rstrip())

    def action_save(self) -> None:
        if not self.path:
            self.log_line("[yellow]no file (start with: asemic FILE)")
        elif not self.doc.autosave:
            self.log_line(f"[dim]{self.path} written" if self.doc.flush(
            ) else f"[dim]{self.path} no changes")
        else:
            self.log_line(f"[dim]{self.path} autosaves on commit")

    def action_toggle_focus(self) -> None:
        """Ctrl+L: show/hide the docked global log (everything else renders inline under its
        own row now, so only the log -- which has no row of its own -- needs a toggle)."""
        log = self.query_one("#log")
        cols = self.query_one("#cols", BlockColumns)
        log.toggle_class("shown")
        if not log.has_class("shown"):
            cols.line.focus()

    def action_toggle_adapters(self) -> None:
        """`/adapters`: show/hide the adapter status panel, tucked at the end of `#rows`
        (same spot an unanchored widget gets -- it has no row of
        its own to anchor under). Enter on a row = `AdaptersPanel.on_option_list_option_selected`."""
        existing = self.query(AdaptersPanel)
        if existing:
            existing.first().remove()
            self.query_one("#cols", BlockColumns).line.focus()
            return
        cols = self.query_one("#cols", BlockColumns)
        rows_w = cols.query_one("#rows")
        panel = AdaptersPanel(self)
        rows_w.mount(panel)
        panel.focus()

    def check_action(self, action: str, parameters: tuple[object, ...]) -> bool | None:
        """`App`'s own `ctrl+q` quit binding is `priority=True` (checked ahead of any focused
        widget's `on_key`), so it would otherwise eat orca's own Ctrl+Q before an embedded
        `PtyTerminal` (plan §3) ever saw it; suppress it while one is mounted."""
        if action == "quit" and self.query(PtyTerminal):
            return False
        return super().check_action(action, parameters)

    def _place_embeds(self, cols: BlockColumns) -> None:
        """`embed(...)` rows (`self.embeds`, set by `_request_embed`) live inside their row's
        `RowBox`, same as panels (`_ensure_in`); hidden row -> unmounted (its subscription goes
        with it). Gated on `_rehome_key` + the embed set."""
        key = self._rehome_key(cols, dict.fromkeys(self.embeds))
        if self._rehome_sig.get("embed") == key:
            return
        self._rehome_sig["embed"] = key
        for nid in self.embeds:
            box = cols.anchor_widget("embed", nid)
            self._ensure_in(box, embed_id(nid), lambda nid=nid: EmbedView(nid, self))

    def _request_embed(self, nid: str) -> None:
        """Called inside eval (UI thread): just declares the embed; `_place_embeds` mounts it
        under its row on the next tick (rows may not be rendered yet mid-eval)."""
        self.embeds.add(nid)

    def _place_row_previews(self, cols: BlockColumns) -> None:
        """Preview-producing rows (`output(...)`, `affinity(...)`) live inside their own
        `RowBox`, mounted as inline `BufferView` without needing explicit `embed(...)`.
        Hidden row -> unmounted (its subscription goes with it)."""
        parent_label = cols.doc.label(cols.parent_path)
        preview_rows: list[tuple[int, str, str]] = []
        for i, r in enumerate(cols.rows):
            c = bare_call(r.src, {"affinity", "output"})
            if c and c[1] and c[1][0]:
                ident = c[1][0]
                if parent_label and parent_label != "main":
                    ident = resolve_path(parent_label, ident)
                # Kind is frame preview on asemic/preview/<ident>
                preview_rows.append((i, c[0], ident))

        sig = (id(cols.doc), cols.doc.version, cols._row_gen, cols.parent_path, tuple(preview_rows))
        if getattr(self, "_row_previews_sig", None) == sig:
            return
        self._row_previews_sig = sig

        want_wids = {f"row-preview-{_slug(ident)}" for _, _, ident in preview_rows}
        for w in self.query(BufferView):
            if w.id and w.id.startswith("row-preview-") and w.id not in want_wids:
                w.remove()

        for i, verb, ident in preview_rows:
            box = cols.row_box(i)
            wid = f"row-preview-{_slug(ident)}"
            kind = preview_kind(self.state, ident)
            self._ensure_in(box, wid, lambda ident=ident, kind=kind, wid=wid: BufferView(
                ident, kind, client=self.client, wid=wid))

    def _place_blocks(self, cols: BlockColumns) -> None:
        """Every current-level `block(...)` nest row gets a `BlockPanel` (its timestretch
        number) mounted inside its own `RowBox` -- the block preview (J 2026-10-12). Peeked
        rows get none (read-only); hidden rows' panels are removed with their boxes. Gated on
        `(doc, version, row_gen, nest paths)` so the hot path is 1 tuple compare."""
        nests = [(i, r) for i, r in enumerate(cols.rows) if r.name is not None]
        sig = (id(cols.doc), cols.doc.version, cols._row_gen,
               tuple(r.path for _, r in nests))
        if self._block_sig == sig:
            return
        self._block_sig = sig
        want = {tuple(r.path) for _, r in nests}
        for w in self.query(BlockPanel):
            if tuple(w.path) not in want:
                w.remove()
        for i, r in nests:
            box = cols.row_box(i)
            if box is None:
                continue
            wid = f"block-{'-'.join(map(str, r.path))}"
            mounted = list(self.query(f"#{wid}"))
            for w in mounted:
                if w.parent is not box:
                    w.remove()
            if any(w.parent is box for w in mounted):
                mounted[0].sync(r)
            elif any(w.parent is not box for w in mounted):
                # `remove()` above is async: mounting the replacement same-tick raises
                # `DuplicateIds` (same hazard `_sync`/`_ensure_in` note) -- defer a tick.
                self.call_after_refresh(lambda box=box, r=r, wid=wid: box.is_attached and not self.query(
                    f"#{wid}") and box.mount(BlockPanel(r, self, id=wid)))
            else:
                box.mount(BlockPanel(r, self, id=wid))


def _examples_epilog() -> str:
    import shutil
    from .config import example_dirs
    # Description column fits the terminal buffer: 2 indent + 28 name + 1 gap.
    room = max(shutil.get_terminal_size().columns - 31, 10)
    lines = ["available examples (pass bare name as `file`, e.g.", "`asemic plant`):"] if room < 36 \
        else ["available examples (pass bare name as `file`, e.g. `asemic plant`):"]
    for exdir in example_dirs():
        for path in sorted(exdir.glob("*.py")):
            first = path.read_text().splitlines()[0].lstrip("# ").strip()
            if len(first) > room:
                first = first[:room - 1] + "…"
            lines.append(f"  {path.stem:<28} {first}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    import argparse

    ap = argparse.ArgumentParser(
        prog="asemic", description="asemic livecode REPL",
        epilog=_examples_epilog(), formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", nargs="?",
                    help="script to load (path, or bare examples/ name e.g. `plant`); saved back on quit")
    ap.add_argument("--run", action="store_true",
                    help="eval whole file on start")
    ap.add_argument(
        "--config", help="zenoh config json5 (default config/peer.json5)")
    ap.add_argument("--restart", action="store_true",
                    help="clean restart: kill asemic-brain + zenohd, then spawn fresh")
    ap.add_argument(
        "--label", help="zoom straight to this dotted block label on start (asemic:// jump.py landing)")
    ap.add_argument("--no-autosave", action="store_true",
                    help="commits apply in-memory only; ctrl+s / :w flushes to disk")
    a = ap.parse_args(argv)
    from . import rig
    rig.ensure(restart=a.restart)
    from .client import ROOT
    from .config import example_dirs
    if a.file:
        path = Path(a.file)
        if not path.exists():
            name = a.file if a.file.endswith(".py") else f"{a.file}.py"
            for exdir in example_dirs():
                bare = exdir / name
                if bare.exists():
                    path = bare
                    break
    else:
        path = ROOT / "examples" / "startup.py"
    code = path.read_text() if path and path.exists() else ""
    run_on_start = a.run
    AsemicApp(Client(a.config), code=code, path=path, run=run_on_start, label=a.label, nvim=True,
              autosave=not a.no_autosave).run()
