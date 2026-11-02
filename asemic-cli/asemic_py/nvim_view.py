"""`NvimView`: a Textual widget that embeds a real (headless) Neovim via pynvim's UI protocol
(`nvim_ui_attach` + `ext_linegrid`). The only row editor.

Rendering: nvim pushes `redraw` notifications (grid_resize/grid_line/grid_clear/
grid_cursor_goto/hl_attr_define/flush); we keep a plain character+highlight-id grid and repaint
on `flush`. Input: Textual key events are translated to nvim's `<...>` notation and sent via
`nvim_input` -- Python never edits the buffer directly, let alone the file on disk.
"""

from __future__ import annotations
from .nvim_server import INIT_LUA, ensure_server
from textual.widget import Widget
from textual.strip import Strip
from textual.geometry import Region
from textual.reactive import reactive
from textual.message import Message
from textual import events
from rich.style import Style
from rich.segment import Segment
import pynvim

import ast
import concurrent.futures
import logging
import shutil
import sys
import threading
from pathlib import Path
from typing import Any
import contextlib

_log = logging.getLogger(__name__)

# Shared per-cell Style singletons (rich.Style is immutable) -- avoids reallocating one per
# cell on every render_line call, which fires per flush (nvim redraw) i.e. per keystroke.
_DEFAULT_STYLE = Style()
_CURSOR_INSERT_STYLE = Style(underline=True, bold=True)
_CURSOR_BLOCK_STYLE = Style(reverse=True)


# Project root (for the LSP workspace + locating the generated stub).
ROOT = Path(__file__).resolve().parent.parent

# Hidden first line of the row scratch buffer. It makes every livecode verb (`tex`, `proc`, …)
# resolve to a typed signature for the LSP (stub generated at `asemic_py/_api.pyi` by
# `scripts/gen_api.py`). The scratch buffer is never executed (the app evals the row text via
# `Repl`), so this import never runs; the editor also scrolls it off the top (`render_line`
# skips grid row 0), so the user only ever sees the row itself.
ROW_PRELUDE = "from asemic_py._api import *  # noqa: F401,F403  # asemic completion context"
# Permanent extra rows reserved below the row (any mode) for the completion popup menu nvim
# draws in the main grid. Kept inside the `_row_height()` cap (`size_to_lines`).
PUM_ROWS = 3

# UI grid rows beyond the widget's visible rows. nvim's grid height = window height + a statusline
# row (`laststatus=2`) + a command-line row (`cmdheight=1`), so the window is `grid - 2` rows.
# It needs `visible rows + 1` to hold a hidden prelude row at the TOP (grid row 0, which
# `render_line` skips) while still showing every visible row (`topline == 1`). With too small a
# grid the window is no taller than the visible rows, so nvim must scroll `topline` past the
# prelude to show the cursor's line -- the `+1` render offset (hiding grid row 0) then eats the
# row's first line and shifts the LSP popup up by one row. `+3` = statusline + cmdline + prelude.
GRID_EXTRA = 3


def _pylsp_path() -> str:
    """`pylsp` executable: on PATH, else the interpreter's own venv sibling (`.`venv/bin/pylsp`)."""
    if (p := shutil.which("pylsp")):
        return p
    cand = Path(sys.executable).parent / "pylsp"
    return str(cand) if cand.exists() else ""


def _api_completions() -> list[dict[str, Any]]:
    """nvim `complete()` items -- `{word, menu, info, kind, kwargs, kwarg_meta}` per livecode verb
    loaded from `_verbs.json` (or parsed from `_api.pyi`). Fed to the row editor's nvim-native
    omnifunc (`init.lua` `AsemicOmni` + the autotrigger), allowing verb completion, contextual kwarg
    completion, and typed enum value completion."""
    verbs_file = ROOT / "asemic_py" / "_verbs.json"
    if verbs_file.exists():
        try:
            import json
            meta = json.loads(verbs_file.read_text())
            items: list[dict[str, Any]] = []
            for name, v in meta.get("verbs", {}).items():
                items.append({
                    "word": name,
                    "menu": "(" + ", ".join(v.get("args", []) + ["**kwargs"]) + ")",
                    "info": v.get("doc", ""),
                    "kind": "f",
                    "kwargs": v.get("kwargs", []),
                    "kwarg_meta": v.get("kwarg_meta", {}),
                })
            return items
        except Exception:
            pass

    try:
        tree = ast.parse((ROOT / "asemic_py" / "_api.pyi").read_text())
    except (OSError, SyntaxError):
        return []
    import re
    items = []
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        named_args = [a.arg for a in node.args.args if a.arg != "self"]
        doc = ast.get_docstring(node) or ""
        kw_match = re.search(r"kw:\s*([^.\n]+)", doc)
        kw_doc = [re.sub(r"[^a-zA-Z0-9_]", "", w) for w in (kw_match.group(1).split() if kw_match else [])]
        kw_doc = [w for w in kw_doc if w]
        all_kwargs = list(dict.fromkeys(named_args + kw_doc))
        items.append({
            "word": node.name,
            "menu": "(" + ", ".join(named_args + ["**kwargs"]) + ")",
            "info": doc,
            "kind": "f",
            "kwargs": all_kwargs,
            "kwarg_meta": {},
        })
    return items


# Textual key -> nvim key-notation. Printable single chars pass through (with `<lt>` for `<`).
_KEY_MAP = {
    "enter": "<CR>",
    "escape": "<Esc>",
    "tab": "<Tab>",
    "shift+tab": "<S-Tab>",
    "backspace": "<BS>",
    "delete": "<Del>",
    "up": "<Up>",
    "down": "<Down>",
    "left": "<Left>",
    "right": "<Right>",
    "home": "<Home>",
    "end": "<End>",
    "pageup": "<PageUp>",
    "pagedown": "<PageDown>",
    "space": "<Space>",
}


def textual_key_to_nvim(key: str, character: str | None) -> str | None:
    """Best-effort Textual-key -> nvim-input-notation translation. None = no mapping (ignore)."""
    if key in _KEY_MAP:
        return _KEY_MAP[key]
    if key.startswith("ctrl+") and len(key) == len("ctrl+") + 1:
        return f"<C-{key[-1]}>"
    if character:
        return "<lt>" if character == "<" else character
    if len(key) == 1:
        return "<lt>" if key == "<" else key
    return None


class NvimView(Widget, can_focus=True):
    """Renders one nvim grid. One instance per editor pane; `file` picks the (shared, reused)
    headless server socket."""

    DEFAULT_CSS = """
    NvimView { width: 1fr; height: 1fr; }
    """

    cols: reactive[int] = reactive(80)
    rows: reactive[int] = reactive(24)

    class TextChanged(Message):
        """Buffer text changed (debounced TextChanged/TextChangedI) or was written (`:w`), or is
        the one-shot post-attach sync of the buffer as it stood when nvim was attached
        (`initial=True` -- caller decides whether that one should trigger an eval, e.g. respecting
        `run_on_start`, the same way the non-nvim startup path does)."""

        def __init__(self, text: str, written: bool, initial: bool = False) -> None:
            self.text = text
            self.written = written
            self.initial = initial
            super().__init__()

    class CursorMoved(Message):
        def __init__(self, line: int) -> None:
            self.line = line
            super().__init__()

    def __init__(self, file: Path, *, nvim_bin: str | None = None, id: str | None = None) -> None:
        super().__init__(id=id)
        self.file = Path(file)
        self._nvim_bin = nvim_bin
        self.nvim: pynvim.Nvim | None = None
        self._grid: list[list[tuple[str, int]]] = []
        self._hl: dict[int, Style] = {0: Style()}
        self._cursor = (0, 0)
        self._loop_thread: threading.Thread | None = None
        self._stopped = False

    # ------------------------------------------------------------ lifecycle
    def on_mount(self) -> None:
        # Textual can call `on_mount` more than once for the same widget instance (observed
        # under `run_test` -- a 2nd mount notification fires after the initial resize settles);
        # idempotent-guard so a 2nd attach thread never races the 1st's setup on the same
        # session/socket (2 "i" replays, 1 landing as a literal typed char -- `? observed, not
        # root-caused beyond this guard`).
        if self._loop_thread is not None:
            return
        cols, rows = self._content_cols_rows()
        self.cols = cols or 80
        self.rows = rows or 24
        # pynvim's socket session opens its own asyncio loop -- can't share Textual's running
        # one, so attach + the whole run_loop happen off-thread.
        self._loop_thread = threading.Thread(
            target=self._attach_nvim, daemon=True)
        self._loop_thread.start()

    def _content_cols_rows(self) -> tuple[int, int]:
        """The widget's actual content region (`content_size`/`content_region`'s own width/
        height already subtract padding + border + scrollbar gutter -- `event.size`/`self.size`
        don't), clamped to >=1 each. Used on mount and on every resize so the nvim UI tracks
        what's actually drawable, not the outer widget box."""
        size = self.content_size
        return max(1, size.width), max(1, size.height)

    def _attach_nvim(self) -> None:
        # NOTE: `self.nvim` stays None (so the Textual-thread guards in `on_resize`/`on_key`/
        # `_call_on_nvim_thread` keep no-op'ing) until setup below is fully done. Publishing it
        # early let a same-tick `on_resize`'s `async_call` race these plain blocking calls on
        # the SAME session/loop from a different thread -- `request()` only yields instead of
        # re-entering `run_forever()` while `Session.run()` (i.e. `_run_loop()`) is the one
        # driving the loop, so a resize mid-setup hit "This event loop is already running".
        sock = ensure_server(self.file, self._nvim_bin)
        nvim = pynvim.attach("socket", path=str(sock))
        chan = nvim.channel_id
        chans = nvim.eval("get(g:, 'asemic_chans', [])") or []
        if chan not in chans:
            chans.append(chan)
        nvim.vars["asemic_chans"] = chans
        nvim.ui_attach(self.cols, self.rows, rgb=True, ext_linegrid=True)
        self._grid = [[(" ", 0)] * self.cols for _ in range(self.rows)]
        # No TextChanged fires on attach (that only comes from nvim's own TextChanged/
        # TextChangedI/BufWritePost autocmds, asemic_text/asemic_cursor) -- so without this, a
        # freshly-attached buffer never reaches the app's doc/eval pipeline and components stay
        # empty until the user's first edit. One-shot sync of whatever's in the buffer right now;
        # `initial=True` lets the app decide whether that should eval (respect `run_on_start`).
        try:
            text = "\n".join(nvim.current.buffer[:]) + "\n"
            self.app.call_from_thread(self.post_message, self.TextChanged(
                text, written=False, initial=True))
        except Exception:
            pass
        self.nvim = nvim
        self._run_loop()

    def _run_loop(self) -> None:
        def on_notification(name: str, args: Any) -> None:
            if self._stopped:
                return
            if name == "redraw":
                self._handle_redraw(args)
            elif name == "asemic_text":
                # `notify_all` sends a 1-element Lua table (`{ text }`); msgpack-rpc params are
                # themselves positional, so `args[0]` is that table, not the string directly.
                text = args[0][0] if args and args[0] else ""
                self.app.call_from_thread(
                    self.post_message, self.TextChanged(text, written=False))
            elif name == "asemic_cursor":
                line = args[0][0] if args and args[0] else 1
                self.app.call_from_thread(
                    self.post_message, self.CursorMoved(int(line)))

        def on_request(name: str, args: Any) -> Any:
            return None

        with contextlib.suppress(Exception):
            self.nvim.run_loop(on_request, on_notification)

    def on_unmount(self) -> None:
        self._stopped = True
        # Detach only this client's UI; never kill the (shared, detached) server process.
        # Also a Textual-thread call (same cross-thread hazard as on_resize/on_key above).
        self._call_on_nvim_thread(self.nvim, "ui_detach")

    def _row_offset(self) -> int:
        """Offset between widget line y and nvim grid row gy (0 when prelude scrolled off, else 1)."""
        return 0

    def _map_touched_rows_to_widget_regions(self, touched_rows: set[int]) -> list[Region]:
        return [
            Region(0, row, self.size.width, 1)
            for row in touched_rows
            if row < self.size.height
        ]

    # ------------------------------------------------------------ redraw handling
    def _handle_redraw(self, batches: list) -> None:
        dirty = False
        full_dirty = False
        touched_rows: set[int] = set()
        old_cursor_row = self._cursor[0]
        for batch in batches:
            event, *calls = batch
            for call in calls:
                if event == "grid_resize":
                    _grid_id, width, height = call
                    # keep the overlap: nvim only resends rows it changed after a resize, so
                    # wiping here blanked the unchanged middle until something touched it
                    old = self._grid
                    self._grid = [
                        (old[y][:width] + [(" ", 0)] * (width - len(old[y]))) if y < len(old) else [(" ", 0)] * width
                        for y in range(height)]
                    full_dirty = True
                elif event == "grid_clear":
                    # Blank in place: `self.rows`/`self.cols` are the WIDGET's content size, which
                    # for the row editor is smaller than the UI grid (`rows + GRID_EXTRA`: hidden
                    # prelude + statusline + cmdline) -- rebuilding to `self.rows` here silently
                    # dropped those rows while the real UI kept them, leaving stale lines.
                    for line in self._grid:
                        for x in range(len(line)):
                            line[x] = (" ", 0)
                    full_dirty = True
                elif event == "grid_line":
                    row = call[1]
                    self._apply_grid_line(call)
                    touched_rows.add(row)
                elif event == "grid_cursor_goto":
                    _grid_id, row, col = call
                    self._cursor = (row, col)
                    touched_rows.add(old_cursor_row)
                    touched_rows.add(row)
                elif event == "hl_attr_define":
                    hl_id, rgb_attrs, *_ = call
                    self._hl[hl_id] = _style_from_attrs(rgb_attrs)
                elif event == "flush":
                    dirty = True
        if dirty:
            if full_dirty:
                self.app.call_from_thread(self.refresh)
            else:
                regions = self._map_touched_rows_to_widget_regions(touched_rows)
                if regions:
                    self.app.call_from_thread(self.refresh, *regions)

    def _apply_grid_line(self, call: list) -> None:
        _grid_id, row, col_start, cells, *_wrap = call
        if row >= len(self._grid):
            return
        line = self._grid[row]
        col = col_start
        hl = 0
        for cell in cells:
            text = cell[0]
            if len(cell) > 1:
                hl = cell[1]
            repeat = cell[2] if len(cell) > 2 else 1
            for _ in range(repeat):
                if col < len(line):
                    line[col] = (text, hl)
                col += 1

    # ------------------------------------------------------------ Textual <-> nvim
    def render_line(self, y: int) -> Strip:
        if y >= len(self._grid):
            return Strip.blank(self.size.width)
        segments = []
        cy, cx = self._cursor
        for x, (ch, hl_id) in enumerate(self._grid[y]):
            style = self._hl.get(hl_id, _DEFAULT_STYLE)
            if y == cy and x == cx and self.has_focus:
                # nvim's cursor is a UI-side concept (grid_cursor_goto), !a grid cell: draw it.
                # INSERT = underline bar-ish, else block (reverse), like nvim's default guicursor.
                style = style + (_CURSOR_INSERT_STYLE if getattr(
                    self, "_nvim_mode", "normal") == "insert" else _CURSOR_BLOCK_STYLE)
            segments.append(Segment(ch or " ", style))
        return Strip(segments)

    def on_focus(self) -> None:
        self.refresh()

    def on_blur(self) -> None:
        self.refresh()

    def on_resize(self, event: events.Resize) -> None:
        cols, rows = self._content_cols_rows()
        if cols == self.cols and rows == self.rows:
            return
        self.cols, self.rows = cols, rows
        self._call_on_nvim_thread(
            self.nvim, "ui_try_resize", self.cols, self.rows)

    def on_key(self, event: events.Key) -> None:
        if self.nvim is None:
            return
        keys = textual_key_to_nvim(event.key, event.character)
        if keys is None:
            return
        event.stop()
        event.prevent_default()
        self._call_on_nvim_thread(self.nvim, "input", keys)

    @staticmethod
    def _call_on_nvim_thread(nvim: "pynvim.Nvim | None", method: str, *args: Any) -> None:
        """Every nvim call from the Textual thread must cross onto pynvim's own event-loop
        thread -- calling session methods directly from here is what pynvim's "Request from
        non-main thread" warning is about (and worse than a warning: the session's msgpack-rpc
        socket is being read concurrently by `run_loop` on its own thread, so a same-thread
        synchronous request from Textual's thread races it). `async_call` is pynvim's documented
        fire-and-forget hop onto that thread; wrap the call so an exception there (e.g. socket
        already closed on teardown) can't kill the loop thread."""
        if nvim is None:
            return

        def _safe() -> None:
            with contextlib.suppress(Exception):
                getattr(nvim, method)(*args)

        with contextlib.suppress(Exception):
            nvim.async_call(_safe)


class NvimRowEditor(NvimView):
    """Per-row Neovim editor (2026-10-11 design): nvim mode swaps `#line`
    in `BlockColumns` (`asemic_py/columns.py`) from `RowVimTextArea` to this, replacing only
    the focused row's in-row editing -- `BlockColumns` itself (tree, folds, sliders, previews)
    stays the main UI. Default (unflagged) mode is untouched.

    1 shared headless nvim for the whole app (`NvimView`'s own `file`-keyed `ensure_server`
    reuse -- 1 script file open at a time here, so 1 server); this widget points that server's
    1 window at a scratch buffer (`buftype=nofile`, `filetype=python`) holding just the
    focused row's text, instead of the file buffer `NvimView` shows in whole-file mode.

    Single-dispatch (`.agents/agents/Auditor.md`): `on_key` intercepts the row/doc-level keys
    `BlockColumns`' tree/fold/undo-journal already owns -- NORMAL arrows (tree nav), NORMAL
    Enter (commit), z-fold/zf/zd/zD/[z/]z keys (always tree-level) -- while nvim's own mode
    (tracked off its `mode_change` redraw event, `self._nvim_mode`) is "normal"; dd/yy/p/P/o/O
    additionally only while the row is a closed fold (`self._row_closed`, 2026-10-11 redesign
    -- real vim's own rule for an operator on a closed fold) -- and calls `BlockColumns`'
    existing handler methods directly (the same ones `RowVimTextArea` calls in the default
    path) rather than duplicating their logic. Everything else -- hjkl, all INSERT-mode keys,
    an OPEN row's own dd/yy/p/o/O/x, `:` ex-commands, motions, native undo/search -- goes
    straight to `nvim_input`: real Vim,
    not hand-rolled.

    Compatibility surface (`.text`/`.cursor_location`/`.document.end`/`.get_line`/`.delete`/
    `.insert`/`.read_only`/`.mode`/`.status_text`/`.select_all`) mirrors just enough of
    `textual_vim_textarea.VimTextArea`'s API that `BlockColumns`' existing row-text call
    sites (`_load`/`_stash`/`replace_char`/`jump_match_bracket`/`enter_search`/...) work
    unchanged against either widget -- a local cache (`self._lines`/`self._cursor`), pushed to
    the real nvim buffer fire-and-forget (`_call_on_nvim_thread`, same cross-thread rule as
    `NvimView`) and kept in sync from nvim's own `asemic_text`/`asemic_cursor`/`mode_change`
    notifications (`nvim/init.lua`'s existing bridge -- buffer-change autocmds are global, so
    they fire for this scratch buffer too, no lua changes needed)."""

    DEFAULT_CSS = """
    NvimRowEditor { width: 1fr; height: 1; }
    """

    def __init__(self, file: Path, *, nvim_bin: str | None = None, id: str | None = None,
                 **_compat: Any) -> None:
        # `_compat`: swallows RowVimTextArea-constructor-only kwargs (`placeholder`,
        # `show_line_numbers`, `soft_wrap`, `tab_behavior`, `compact`, `highlight_cursor_line`)
        # so `BlockColumns.compose()` can build either widget with 1 call shape.
        super().__init__(file, nvim_bin=nvim_bin, id=id)
        self._lines: list[str] = [""]
        self._cur = (0, 0)  # (row, col), local cache
        # tracked off `mode_change`; gates the single-dispatch below
        self._nvim_mode = "normal"
        self._read_only = False
        self._scratch_buf: Any = None
        # 2026-10-11 redesign (supersedes the earlier o/O-cursor-position split): real vim's
        # own rule for an operator on a CLOSED fold -- dd/yy/p/o/O act on the whole fold, not
        # its text -- mapped onto "the tree row is a closed fold" here. `_row_closed` = True
        # -> NORMAL dd/yy/p/P/o/O go to `BlockColumns`' row/tree handlers (`row_op_line`/
        # `row_put`/`enter_new_row`), same as before; False -> 100% native `nvim_input`, no
        # lookahead at all (real nvim's own operator-pending handles dw/cw/etc. itself).
        # Flipped off `mode_change` (`_handle_redraw` below) so it tracks both python- and
        # nvim-driven mode transitions in 1 place: entering INSERT opens the row (any of
        # i/a/A/I, or `BlockColumns`' `.mode =` setter when it opens a new row slot), leaving
        # it (Esc) re-closes it. `zo` (the z-pending dict below) also opens it without
        # entering INSERT, vim's own "open this fold" semantics.
        self._row_closed = True
        # nvim's window top line (buffer line 1 = the hidden prelude). Normally 1 (prelude on
        # grid row 0, `render_line` skips it); but nvim preserves the top line across resizes,
        # so a window briefly too short to hold prelude + row (a 1-line NORMAL row; INSERT's
        # `PUM_ROWS` growth then keeps the row but not the prelude) leaves it parked at 2 -- the
        # prelude already scrolled off, and grid row 0 IS the first row line. Tracked off
        # `win_viewport` so `render_line` shows the true first visible line instead of eating it.
        self._topline = 1
        self._pending_z = False
        # `zf`: awaiting its motion (j/k/G -- `fold_wrap_rows`)
        self._pending_zf = False
        # `[`/`]`: awaiting `z` (-1/+1 = which one)
        self._pending_bracket_z: int | None = None
        # "d" | "y" awaiting its 2nd char (dd/yy), closed-row only
        self._pending_op: str | None = None

    class HelpRequested(Message):
        """`:help [topic]` typed in this row (nvim/init.lua `CmdlineLeave` bridge): app opens
        an `NvimHelpView`."""

        def __init__(self, topic: str) -> None:
            self.topic = topic
            super().__init__()

    class Changed(Message):
        """Local cache text changed -- `BlockColumns.on_nvim_row_editor_changed` reuses the
        same `_update_slash_dropdown` the library's own `TextArea.Changed` drives."""

    # ------------------------------------------------------------ attach: scratch buffer
    def _attach_nvim(self) -> None:
        # NOTE: `self.nvim` is published only at the very end (see `NvimView._attach_nvim`'s
        # note -- same reentrancy hazard: a same-tick `on_resize`/`on_key` `async_call` racing
        # these plain blocking setup calls on this thread's still-not-running loop).
        # Own embedded nvim per app (not the shared per-file `--listen` server): a row editor
        # holds a private scratch buffer + mode, and nvim's UIs all mirror ONE screen -- 2 REPLs
        # sharing a server fought over window/mode (a stuck INSERT made the `i` replay below
        # land as a literal char, 2026-10-11). Dies with the app.
        nvim_bin = self._nvim_bin or shutil.which("nvim") or "nvim"
        nvim = pynvim.attach(
            "child", argv=[nvim_bin, "--embed", "--headless", "-n", "-u", str(INIT_LUA)])
        chan = nvim.channel_id
        chans = nvim.eval("get(g:, 'asemic_chans', [])") or []
        if chan not in chans:
            chans.append(chan)
        nvim.vars["asemic_chans"] = chans
        # pylsp for this buffer's completion (init.lua's FileType autocmd reads these): the
        # generated typed stub + a workspace root so `from asemic_py._api import *` resolves.
        nvim.vars["asemic_pylsp"] = _pylsp_path()
        nvim.vars["asemic_root"] = str(ROOT)
        # nvim-native verb completion (`init.lua` `AsemicOmni` + the TextChangedI autotrigger):
        # word/menu/info per livecode verb, so the popup no longer needs a pylsp round-trip.
        nvim.vars["asemic_completions"] = _api_completions()
        buf = nvim.api.create_buf(False, True)  # listed=False, scratch=True
        nvim.api.buf_set_option(buf, "buftype", "nofile")
        nvim.api.buf_set_option(buf, "filetype", "python")
        nvim.api.buf_set_option(buf, "swapfile", False)
        nvim.api.buf_set_option(buf, "omnifunc", "v:lua.AsemicOmni")
        # gates `AsemicOmni`'s autotrigger
        nvim.api.buf_set_var(buf, "asemic_row", True)
        nvim.api.win_set_buf(0, buf)
        self._scratch_buf = buf
        nvim.api.buf_set_lines(buf, 0, -1, True, [ROW_PRELUDE, *self._lines])
        # `:` line -> crumb (1-row grid can't show it); +3 = statusline + cmdline + hidden prelude row
        nvim.ui_attach(self.cols, self.rows + GRID_EXTRA,
                       rgb=True, ext_linegrid=True, ext_cmdline=True)
        self._grid = [
            [(" ", 0)] * self.cols for _ in range(self.rows + GRID_EXTRA)]
        # `BlockColumns.on_mount`/`_load` may have set `.mode`/`.cursor_location` before attach
        # finished (the `_call_on_nvim_thread` push there no-ops while `self.nvim` is still
        # None) -- replay whatever the cache says now, still single-threaded here (`_run_loop`,
        # which shares the socket w/ `run_loop`'s own reads, hasn't started yet).
        nvim.command("startinsert" if self._nvim_mode ==
                     "insert" else "stopinsert")  # idempotent, !typed key
        row, col = self._cur
        try:
            # +1 prelude line, +1 1-based
            nvim.current.window.cursor = (row + 2, col)
        except Exception:
            pass
        self.nvim = nvim
        self._run_loop()

    def _run_loop(self) -> None:
        def on_notification(name: str, args: Any) -> None:
            if self._stopped:
                return
            if name == "redraw":
                self._handle_redraw(args)
            elif name == "asemic_text":
                # see `NvimView._run_loop`
                text = args[0][0] if args and args[0] else ""
                # drop the hidden prelude line
                self._lines = text.split("\n")[1:] or [""]
                self.app.call_from_thread(self.post_message, self.Changed())
            elif name == "asemic_cursor":
                line = int(args[0][0]) if args and args[0] else 1
                # buffer line 1 = prelude
                self._cur = (max(0, line - 2), self._cur[1])
            elif name == "asemic_help":
                self.app.call_from_thread(
                    self.post_message, self.HelpRequested(args[0] if args else ""))

        def on_request(name: str, args: Any) -> Any:
            return None

        with contextlib.suppress(Exception):
            self.nvim.run_loop(on_request, on_notification)

    def _handle_redraw(self, batches: list) -> None:
        for batch in batches:
            event, *calls = batch
            for call in calls:
                if event == "cmdline_show":
                    content, _pos, firstc, prompt = call[0], call[1], call[2], call[3]
                    self._cmdline = f"{prompt}{firstc}" + \
                        "".join(str(c[1]) for c in content)
                    self.post_message(self.CmdlineChanged())
                elif event == "cmdline_hide":
                    self._cmdline = None
                    self.post_message(self.CmdlineChanged())
                elif event == "win_viewport":
                    # `[grid, win, topline, botline, curline, curcol]` -- topline is 0-based, so
                    # store it 1-based to match buffer lines (see `_topline`).
                    old_topline = self._topline
                    self._topline = call[2] + 1
                    if self._topline != old_topline:
                        # Topline shifted -> mapping between grid lines and widget rows changed; trigger full repaint
                        self.app.call_from_thread(self.refresh)
                if event == "mode_change":
                    mode_name = call[0]
                    was_insert = self._nvim_mode == "insert"
                    self._nvim_mode = "insert" if ("insert" in mode_name or "replace" in mode_name) else (
                        "normal" if mode_name.startswith(
                            "normal") else mode_name
                    )
                    is_insert = self._nvim_mode == "insert"
                    # `_row_closed` (2026-10-11 design, see class docstring): real vim's
                    # closed-fold semantics, applied to "the tree row vs. this row's own
                    # text" -- entering INSERT (`i`/`a`/`A`/`I`, however it was reached:
                    # natively forwarded, or `BlockColumns`' own `.mode =` setter) always
                    # means editing THIS row's text, so it "opens" the fold; leaving INSERT
                    # back to NORMAL (Esc) re-closes it. Hooking this off `mode_change` (not
                    # off the specific keys) catches both origins in 1 place -- no 2nd
                    # dispatch path to keep in sync.
                    if is_insert and not was_insert:
                        self._row_closed = False
                    elif was_insert and not is_insert:
                        self._row_closed = True
                    if is_insert != was_insert:
                        # same reaction as the library's `VimTextArea.ModeChanged` (crumb's
                        # `-- INSERT --`/`NORMAL` tag; + stash on leaving INSERT, like
                        # `RowVimTextArea._on_key`'s Esc) -- else the mode flipped in nvim
                        # but the UI kept showing INSERT until some other key re-rendered.
                        # post_message (thread-safe, non-blocking), !call_from_thread: that
                        # blocks this nvim thread until the handler returns, and `_stash` ->
                        # `sync_text` waits on this same thread -> stall to its timeout.
                        self.post_message(self.ModeFlipped(was_insert))
        super()._handle_redraw(batches)

    def _row_offset(self) -> int:
        return 1 if self._topline <= 1 else 0

    def _map_touched_rows_to_widget_regions(self, touched_rows: set[int]) -> list[Region]:
        offset = self._row_offset()
        regions = []
        for grid_row in touched_rows:
            widget_y = grid_row - offset
            if 0 <= widget_y < self.size.height:
                regions.append(Region(0, widget_y, self.size.width, 1))
        return regions

    def render_line(self, y: int) -> Strip:
        """Row scratch buffer carries a hidden prelude on grid row 0 (`ROW_PRELUDE`); render the
        buffer one grid row down so the user only ever sees the row text (and any LSP popup nvim
        draws below it). The prelude is only on grid row 0 while nvim's window top line is 1
        (`self._topline`); once it has scrolled off, grid row 0 is already the first row line and
        the offset must be 0 -- else the row's first line is clipped (J 2026-10-13: it showed up
        after the autocomplete row-growth left the window parked at top line 2)."""
        gy = y + self._row_offset()
        if gy >= len(self._grid):
            return Strip.blank(self.size.width)
        segments = []
        cy, cx = self._cursor
        for x, (ch, hl_id) in enumerate(self._grid[gy]):
            style = self._hl.get(hl_id, _DEFAULT_STYLE)
            if gy == cy and x == cx and self.has_focus:
                style = style + (_CURSOR_INSERT_STYLE
                                 if self._nvim_mode == "insert" else _CURSOR_BLOCK_STYLE)
            segments.append(Segment(ch or " ", style))
        return Strip(segments)

    class CmdlineChanged(Message):
        """nvim's `ext_cmdline` `:`/`/` line changed or closed -> owner redraws the crumb."""

    class ModeFlipped(Message):
        def __init__(self, left_insert: bool) -> None:
            super().__init__()
            self.left_insert = left_insert

    def on_nvim_row_editor_mode_flipped(self, ev: "NvimRowEditor.ModeFlipped") -> None:
        ev.stop()
        left_insert = ev.left_insert
        # INSERT: reserve popup-menu room (grow); leave: shrink back to the row height.
        self.size_to_lines()
        self._call_on_nvim_thread(
            self.nvim, "ui_try_resize", self.cols, self.rows + GRID_EXTRA)
        owner = self.parent
        if owner is None or not hasattr(owner, "refresh_rows"):
            return
        if left_insert:
            owner._stash()
        owner.refresh_rows()

    def _force_normal(self) -> None:
        r"""Back to NORMAL however nvim got here: `<C-\><C-n>` = Vim's canonical "go to Normal
        mode from any mode" (`:h CTRL-\_CTRL-N`), queued in order w/ pending keys via
        nvim_input -- !`:stopinsert`, which only applies on nvim's next main-loop return."""
        self._nvim_mode = "normal"
        self._call_on_nvim_thread(self.nvim, "input", "<C-\\><C-n>")

    def on_blur(self) -> None:
        # Focus left the row editor (panel control, log, Esc handled elsewhere...): leave
        # INSERT too, so nvim is never left stuck in it with nothing focused to Esc it.
        if self._nvim_mode == "insert":
            self._force_normal()
        self.refresh()

    def on_unmount(self) -> None:
        self._stopped = True
        # own embedded child, !shared
        self._call_on_nvim_thread(self.nvim, "command", "qa!")

    # ------------------------------------------------------------ sizing (row height/width)
    def _row_height(self) -> int:
        """Height for the current row: expands with the selected row's line count, capped at
        1/2 page so a long multiline row never takes over the screen (J 2026-10-13). Half the
        app's screen height, min 1 -- falls back to the widget's own screen during early mount."""
        try:
            h = self.app.size.height
        except Exception:
            h = 0
        if h <= 1:
            try:
                h = self.screen.size.height
            except Exception:
                h = 0
        return max(1, h // 2)

    def size_to_lines(self) -> None:
        """Re-apply height for the current `self._lines` (after a row change or a page resize).
        The editor grows with the row's line count, capped at `_row_height()` (1/2 page). A
        permanent `PUM_ROWS` slot is reserved for the completion popup menu (drawn in the main
        grid: `ext_linegrid`, no `ext_popupmenu`), inside the same cap, so a long row never
        exceeds 1/2 page and the layout never shifts when the popup opens (J 2026-10-13: the room
        used to be added *past* the cap, and only while INSERT)."""
        self.rows = max(1, min(len(self._lines) + PUM_ROWS, self._row_height()))
        self.styles.height = self.rows

    def set_row_text(self, text: str) -> None:
        self._lines = text.split("\n") if text else [""]
        self._cur = (0, 0)
        self.size_to_lines()
        lines = list(self._lines)
        cols, _rows = self._content_cols_rows()
        self.cols = cols
        self._call_on_nvim_thread(
            self.nvim, "_asemic_set_lines", lines, cols, self.rows)

    @staticmethod
    def _call_on_nvim_thread(nvim: "pynvim.Nvim | None", method: str, *args: Any) -> None:
        """Extends the base's cross-thread hop with 2 pseudo-methods (not real pynvim session
        methods, dispatched here instead of via `getattr`): `_asemic_set_lines` sets the
        scratch buffer's lines + resizes the UI in 1 hop (so `.text =` stays 1 `async_call`,
        not 2 racing ones); `_asemic_cursor` moves the real nvim cursor to match the local
        cache (clamped -- nvim rejects an out-of-range line/col)."""
        if nvim is None:
            return
        if method not in ("_asemic_set_lines", "_asemic_cursor"):
            return NvimView._call_on_nvim_thread(nvim, method, *args)

        def _safe() -> None:
            try:
                if method == "_asemic_set_lines":
                    lines, cols, rows = args
                    buf = nvim.current.buffer
                    buf[:] = [ROW_PRELUDE, *lines]
                    nvim.ui_try_resize(max(1, cols), max(1, rows + GRID_EXTRA))
                    # buffer line 2 = first row line
                    nvim.current.window.cursor = (2, 0)
                    nvim.command("redraw!")
                else:
                    row, col = args
                    buf = nvim.current.buffer
                    # buffer line 1 = hidden prelude
                    row = max(0, min(row, len(buf) - 2))
                    col = max(0, min(col, len(buf[row + 1])))
                    nvim.current.window.cursor = (row + 2, col)
            except Exception:
                pass

        with contextlib.suppress(Exception):
            nvim.async_call(_safe)

    def on_resize(self, event: events.Resize) -> None:
        # Width tracks the widget's actual content region (minus padding/border/gutter,
        # `NvimView._content_cols_rows`) so wrapped/long lines render at the real column count,
        # not whatever `ui_attach` happened to start with. Height is content-driven too
        # (`size_to_lines`), but its 1/2-page cap tracks the page, so recompute it here as well.
        cols, _rows = self._content_cols_rows()
        was = self.rows
        self.size_to_lines()
        self.refresh()
        if cols == self.cols and self.rows == was:
            return
        self.cols = cols
        # +3 statusline + cmdline + hidden prelude row
        self._call_on_nvim_thread(
            self.nvim, "ui_try_resize", self.cols, self.rows + GRID_EXTRA)

    def on_mount(self) -> None:
        if self._loop_thread is not None:  # see `NvimView.on_mount`'s note on double-mount
            return
        cols, _rows = self._content_cols_rows()
        self.cols = cols or 80
        self._loop_thread = threading.Thread(
            target=self._attach_nvim, daemon=True)
        self._loop_thread.start()

    # ------------------------------------------------------------ compatibility surface
    @property
    def text(self) -> str:
        return "\n".join(self._lines)

    @text.setter
    def text(self, value: str) -> None:
        self.set_row_text(value)

    class _Doc:
        def __init__(self, owner: "NvimRowEditor") -> None:
            self._owner = owner

        @property
        def end(self) -> tuple[int, int]:
            lines = self._owner._lines
            return (len(lines) - 1, len(lines[-1]) if lines else 0)

    @property
    def document(self) -> "NvimRowEditor._Doc":
        return NvimRowEditor._Doc(self)

    def get_line(self, row: int) -> str:
        return self._lines[row] if 0 <= row < len(self._lines) else ""

    @property
    def cursor_location(self) -> tuple[int, int]:
        return self._cur

    @cursor_location.setter
    def cursor_location(self, loc: tuple[int, int]) -> None:
        row, col = loc
        row = max(0, min(row, len(self._lines) - 1))
        col = max(0, min(col, len(self.get_line(row))))
        self._cur = (row, col)
        self._call_on_nvim_thread(self.nvim, "_asemic_cursor", row, col)

    def insert(self, text: str, location: tuple[int, int]) -> None:
        row, col = location
        s = self.get_line(row)
        self._lines[row] = s[:col] + text + s[col:]
        self.set_row_text("\n".join(self._lines))

    def delete(self, start: tuple[int, int], end: tuple[int, int]) -> None:
        row, col0 = start
        _row, col1 = end
        s = self.get_line(row)
        self._lines[row] = s[:col0] + s[col1:]
        self.set_row_text("\n".join(self._lines))

    @property
    def read_only(self) -> bool:
        return self._read_only

    @read_only.setter
    def read_only(self, value: bool) -> None:
        self._read_only = value

        def _safe() -> None:
            with contextlib.suppress(Exception):
                self.nvim.current.buffer.options["modifiable"] = not value

        if self.nvim is not None:
            with contextlib.suppress(Exception):
                self.nvim.async_call(_safe)

    @property
    def mode(self) -> "Mode":
        from textual_vim_textarea import Mode
        return Mode.INSERT if self._nvim_mode == "insert" else Mode.NORMAL

    @mode.setter
    def mode(self, value: "Mode") -> None:
        from textual_vim_textarea import Mode
        want_insert = value is Mode.INSERT
        is_insert = self._nvim_mode == "insert"
        if want_insert and not is_insert:
            self._nvim_mode = "insert"
            self._call_on_nvim_thread(self.nvim, "command", "startinsert")
        elif not want_insert and is_insert:
            self._nvim_mode = "normal"
            self._force_normal()

    @property
    def status_text(self) -> str:
        if getattr(self, "_cmdline", None) is not None:
            return self._cmdline
        return "-- INSERT --" if self._nvim_mode == "insert" else "NORMAL"

    def select_all(self) -> None:
        pass  # no nvim-native equivalent meaningful for a row scratch buffer; no-op

    # ------------------------------------------------------------ strict (authoritative) sync
    def sync_text(self, timeout: float = 0.2) -> str:
        """Authoritative read of the scratch buffer, for the 2 moments the local `_lines`
        cache's eventual consistency (it only updates off nvim's own debounced `asemic_text`
        notification) isn't good enough: committing the row (Enter) and leaving it (`_stash`).
        A fast Enter right after an edit can otherwise race ahead of that notification and
        commit stale text.

        Queues `nvim_buf_get_lines` + the cursor on nvim's own event-loop thread via
        `async_call` -- same thread `nvim_input` goes through, so FIFO already orders this
        read after any input still in flight, no extra synchronization needed -- and hands the
        result back through a `concurrent.futures.Future`. Waits up to `timeout` (default
        ~200ms: short enough not to visibly hang the Textual loop); on timeout (or no nvim
        yet), logs it and falls back to the local cache."""
        if self.nvim is None:
            return self.text
        fut: "concurrent.futures.Future[tuple[list[str], tuple[int, int]]]" = concurrent.futures.Future(
        )

        def _safe() -> None:
            try:
                buf = self.nvim.current.buffer
                # drop the hidden prelude line
                lines = list(buf[:])[1:] or [""]
                row, col = self.nvim.current.window.cursor
                if not fut.done():
                    # buffer line 1 = hidden prelude
                    fut.set_result((lines, (row - 2, col)))
            except Exception as exc:
                if not fut.done():
                    fut.set_exception(exc)

        try:
            self.nvim.async_call(_safe)
        except Exception:
            _log.warning(
                "NvimRowEditor.sync_text: async_call failed, falling back to cache")
            return self.text
        try:
            lines, cur = fut.result(timeout=timeout)
        except Exception:
            _log.warning(
                "NvimRowEditor.sync_text: authoritative buffer read timed out after %.2fs, "
                "falling back to cache", timeout,
            )
            return self.text
        self._lines, self._cur = lines or [""], cur
        return self.text

    # ------------------------------------------------------------ single-dispatch key routing
    def on_key(self, event: events.Key) -> None:
        if self.nvim is None:
            return
        # BlockColumns -- duck-typed (avoids an import cycle w/ columns.py)
        owner = self.parent
        if owner is not None:
            if getattr(owner, "_slash_open", False):
                if event.key in ("up", "down"):
                    event.stop()
                    event.prevent_default()
                    owner.slash_move(1 if event.key == "down" else -1)
                    return
                if event.key in ("tab", "enter"):
                    event.stop()
                    event.prevent_default()
                    owner.slash_accept()
                    return
                if event.key == "escape":
                    event.stop()
                    event.prevent_default()
                    owner.slash_close()
                    return
            if getattr(owner, "_input_purpose", None) == "search":
                event.stop()
                event.prevent_default()
                owner.handle_search_key(event)
                return
            if self._nvim_mode == "normal" and self._dispatch_normal(owner, event):
                return
        keys = textual_key_to_nvim(event.key, event.character)
        if keys is None:
            return
        event.stop()
        event.prevent_default()
        self._call_on_nvim_thread(self.nvim, "input", keys)

    def _dispatch_normal(self, owner: Any, event: events.Key) -> bool:
        """Row/doc-level keys the tree owns, NORMAL-only (INSERT stays native nvim text-
        cursor/newline). `ch`/`key` mirror `RowVimTextArea._handle_normal_key`'s own
        vocabulary so the two dispatchers stay easy to compare.

        2026-10-11 redesign (supersedes the earlier o/O-cursor-position split -- see
        `_row_closed`'s own comment in `__init__`): z-family/`[z`/`]z`/arrows/Enter are
        ALWAYS tree-level, `_row_closed` or not (real vim: folding commands + line-nav always
        act on the fold, not its contents). dd/yy/p/P/o/O are tree-level only while
        `_row_closed` (a closed fold); once open (INSERT entered, or `zo`), every key --
        including dd/yy/p/o/O/x -- falls through to native `nvim_input` with no lookahead at
        all, same as any other in-row edit."""
        ch, key = event.character, event.key

        if (ch == "u" or key == "ctrl+r") and not (self._pending_z or self._pending_zf or self._pending_op or self._pending_bracket_z):
            event.stop()
            event.prevent_default()
            # tree-wide history, !nvim's 1-row undo
            owner.action_undo() if ch == "u" else owner.action_redo()
            return True
        if ch == ":" and not (self._pending_z or self._pending_zf or self._pending_op or self._pending_bracket_z):
            event.stop()
            event.prevent_default()
            owner.open_cmdbar()  # global cmd bar at the bottom (`:help TOPIC` -> nvim help pane)
            return True
        if self._pending_zf:
            self._pending_zf = False
            event.stop()
            event.prevent_default()
            span = {"j": 2, "k": 2, "G": len(
                owner.rows) - owner._depth0_index}.get(ch)
            if span is not None:
                owner.fold_wrap_rows(span)
            return True
        if self._pending_z:
            self._pending_z = False
            event.stop()
            event.prevent_default()
            if ch == "f":
                self._pending_zf = True
                return True
            if ch == "o":
                self._row_closed = False  # `zo`: open the fold w/o entering INSERT
                return True
            {
                "a": owner.toggle_peek, "A": owner.toggle_peek_recursive,
                "R": owner.fold_open_all, "M": owner.fold_close_all,
                "r": lambda: owner.fold_level_step(1), "m": lambda: owner.fold_level_step(-1),
                "j": owner.fold_next, "k": owner.fold_prev_end,
                "d": lambda: owner.fold_unwrap_block(recursive=False),
                "D": lambda: owner.fold_unwrap_block(recursive=True),
            }.get(ch, lambda: None)()
            return True
        if self._pending_bracket_z is not None:
            d, self._pending_bracket_z = self._pending_bracket_z, None
            event.stop()
            event.prevent_default()
            if ch == "z":
                (owner.jump_block_start if d < 0 else owner.jump_block_end)()
            return True
        if ch in ("[", "]"):
            self._pending_bracket_z = -1 if ch == "[" else 1
            event.stop()
            event.prevent_default()
            return True
        if ch == "z":
            self._pending_z = True
            event.stop()
            event.prevent_default()
            return True

        # arrows: window-level `AsemicApp.action_tree_nav` (priority binding), !here
        if key == "enter":
            event.stop()
            event.prevent_default()
            # NORMAL enter = COOK the row: a block row cooks itself, a leaf its enclosing block;
            # cooking always re-evaluates rows first (AsemicApp.cook_block, same as the block's COOK button)
            p, doc, cook = getattr(owner, "path", None), getattr(owner, "doc", None), getattr(self.app, "cook_block", None)
            if p is not None and doc is not None and cook is not None:
                cook(list(p if doc.is_nest(p) else p[:-1]))
            return True

        if not self._row_closed:
            # open fold: 100% native, no lookahead (dd/yy/p/o/O/x/... all forwarded)
            return False

        if self._pending_op is not None:
            op, self._pending_op = self._pending_op, None
            event.stop()
            event.prevent_default()
            if ch == op:
                # `dd`/`yy`: the tree row, not this row's text
                owner.row_op_line(op, 1)
                return True
            # `d`/`y` + any other motion (`w`, `$`, `e`, `G`, ...) is a native edit of THIS row's
            # text -- the operator was only held back for the `dd`/`yy` lookahead above. Replay
            # it, then this key, through `nvim_input` so nvim's own operator-pending runs
            # (J 2026-10-13: dw/d$ were swallowed by the lookahead). Only replay if the motion
            # maps -- else nvim would be left stuck in operator-pending.
            tail = textual_key_to_nvim(event.key, event.character)
            if tail is not None:
                self._call_on_nvim_thread(self.nvim, "input", op)
                self._call_on_nvim_thread(self.nvim, "input", tail)
            return True
        if ch in ("d", "y"):
            self._pending_op = ch
            event.stop()
            event.prevent_default()
            return True
        if ch == "p":
            event.stop()
            event.prevent_default()
            owner.row_put(after=True, count=1)
            return True
        if ch == "P":
            event.stop()
            event.prevent_default()
            owner.row_put(after=False, count=1)
            return True
        if ch == "o":
            event.stop()
            event.prevent_default()
            owner.enter_new_row(below=True)
            return True
        if ch == "O":
            event.stop()
            event.prevent_default()
            owner.enter_new_row(below=False)
            return True
        return False


def _style_from_attrs(attrs: dict) -> Style:
    fg = attrs.get("foreground")
    bg = attrs.get("background")
    return Style(
        color=f"#{fg:06x}" if fg is not None else None,
        bgcolor=f"#{bg:06x}" if bg is not None else None,
        bold=attrs.get("bold", False),
        italic=attrs.get("italic", False),
        reverse=attrs.get("reverse", False),
    )


class NvimHelpView(NvimView):
    """`:help [topic]` pane: its own embedded nvim loaded w/ the user's own config (so help
    plugins + `:Telescope help_tags` etc. work), showing real `:help` full-window -- tag jumps
    (Ctrl-]/Ctrl-T), search, folds all native. `q` (normal) closes it."""

    DEFAULT_CSS = """
    NvimHelpView { height: 24; border: round $accent; }
    """

    class Closed(Message):
        pass

    def __init__(self, topic: str = "", *, nvim_bin: str | None = None) -> None:
        super().__init__(Path("help"), nvim_bin=nvim_bin, id="help-view")
        self.topic = topic
        self.border_title = f":help {topic}".rstrip()

    def _attach_nvim(self) -> None:
        nvim_bin = self._nvim_bin or shutil.which("nvim") or "nvim"
        nvim = pynvim.attach("child", argv=[nvim_bin, "--embed"])
        nvim.ui_attach(self.cols, self.rows, rgb=True, ext_linegrid=True)
        self._grid = [[(" ", 0)] * self.cols for _ in range(self.rows)]
        try:
            nvim.command(f"help {self.topic}".rstrip())
        except Exception as e:  # E149 no help for topic: say so, show the index instead
            self.app.call_from_thread(
                setattr, self, "border_subtitle", str(e).splitlines()[-1])
            nvim.command("help")
        nvim.command("only")
        nvim.exec_lua(
            'vim.keymap.set("n", "q", function() vim.rpcnotify(0, "asemic_close") end)')
        self.nvim = nvim

        def on_notification(name: str, args: Any) -> None:
            if self._stopped:
                return
            if name == "redraw":
                self._handle_redraw(args)
            elif name == "asemic_close":
                self.app.call_from_thread(self.post_message, self.Closed())

        with contextlib.suppress(Exception):
            nvim.run_loop(lambda *_: None, on_notification)

    def on_unmount(self) -> None:
        self._stopped = True
        # private child: dies with the pane
        self._call_on_nvim_thread(self.nvim, "quit", "qa!")
