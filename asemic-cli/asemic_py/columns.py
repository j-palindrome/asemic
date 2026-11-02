"""Column view over a block Doc: 1 nesting level at a time, full width, breadcrumb, no scrollbars.

↑/↓ sibling · → (caret at end, on a block) enter · ← (caret at 0) exit · Enter commit · Esc drop draft.
The last slot of every column is an empty "new row" prompt; committing there inserts.
"""

from __future__ import annotations

import ast
import inspect
import json
import re
import shlex
import subprocess
from pathlib import Path
from collections.abc import Container
from typing import Any

import docstring_parser
from rich.text import Text
from textual import events, work
from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.content import Content
from textual.fuzzy import Matcher
from textual.message import Message
from textual.widget import Widget
from textual.widgets import Button, Input, OptionList, Static, TextArea
from textual.widgets.option_list import Option
from textual_vim_textarea import Mode, VimTextArea

from .blocks import Doc, Row, RowPath
from .client import Client
from .ids import display_path, resolve_path
from .links import asemic_uri, file_link_content, link_text
from .nvim_view import NvimRowEditor
from .orca_literal import _ORCA_TUI_Y_CHROME, crop_capture, grid_from_src, is_orca_row, layout_grids, replace_grid, split_grid
from .pty_terminal import PtyTerminal

# orca's own chrome (ruler + status lines) around the grid it's showing, plus a little top/bottom
# margin (empirically ~46 cols keeps the bottom status line from wrapping, scripts/smoke): the
# exact chrome (orca_literal._ORCA_TUI_Y_CHROME, used to crop the live capture) + that margin.
_ORCA_CHROME_ROWS = _ORCA_TUI_Y_CHROME + 2
_ORCA_MIN_COLS = 46
_ORCA_MAX_ROWS = 30

ORCA_ADAPTER_DIR = Path(__file__).resolve().parent.parent / "adapters" / "orca"

# local (non-brain) slash commands, same shape as brain verbs ({"verb","args","doc"})
LOCAL_COMMANDS: list[dict] = [
    {"verb": "help", "args": [], "doc": "show key bindings"},
    {"verb": "run", "args": [], "doc": "eval all"},
    {"verb": "clear", "args": [], "doc": "clear the log"},
    {"verb": "log", "args": [], "doc": "toggle the log panel (same as Ctrl+L)"},
    {"verb": "block", "args": ["name"], "doc": "enter/create a nest named NAME"},
    {"verb": "orca", "args": [], "doc": "insert an orca grid row (default 8x4 dots)"},
    {"verb": "open", "args": ["query"], "doc": "quick-switch: blocks first, then folders/files"},
    {"verb": "o", "args": ["query"], "doc": "alias: :open"},
    {"verb": "adapters", "args": [], "doc": "show the adapter status panel"},
    {"verb": "functions", "args": [], "doc": "browse livecode functions with docs + insert"},
    {"verb": "fn", "args": [], "doc": "alias: :functions"},
    {"verb": "guide", "args": [], "doc": "show the comprehensive guide + example index"},
]
LOCAL_COMMAND_NAMES = {c["verb"] for c in LOCAL_COMMANDS}


def called(text: str, ns: Container[str]) -> str | None:
    """Outermost call in `text` naming something in `ns` (`ast`; a half-typed row falls back to
    the first `name(`)."""
    try:
        names = [n.func.id for n in ast.walk(ast.parse(text)) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
    except SyntaxError:
        names = re.findall(r"([A-Za-z_]\w*)\s*\(", text)
    return next((n for n in names if n in ns), None)


def manpage(name: str, fn: Any) -> Text:
    """QUICKHELP man page for `fn`: structured SYNOPSIS, PARAMETERS, KEYWORDS & options
    extracted from the Rust schema metadata (`_verbs.json`) and docstrings."""
    try:
        from . import _verbs_meta
    except ImportError:
        pass

    verbs_file = Path(__file__).resolve().parent / "_verbs.json"
    verb_info = {}
    if verbs_file.exists():
        try:
            verb_info = json.loads(verbs_file.read_text()).get("verbs", {}).get(name, {})
        except Exception:
            pass

    try:
        sig = f"{name}{inspect.signature(fn)}"
    except (TypeError, ValueError):
        sig = name

    doc = docstring_parser.parse(inspect.getdoc(fn) or "")
    out = Text()
    out.append("SYNOPSIS\n", style="bold underline")
    out.append(f"  {sig}\n\n", style="bold cyan")

    synopsis = verb_info.get("synopsis") or doc.short_description
    if synopsis:
        out.append("DESCRIPTION\n", style="bold underline")
        out.append(f"  {synopsis}\n\n")

    kwarg_meta = verb_info.get("kwarg_meta", {})
    if kwarg_meta:
        out.append("KEYWORDS & OPTIONS\n", style="bold underline")
        for kw, meta in kwarg_meta.items():
            t = meta.get("type", "Any")
            choices = meta.get("choices", [])
            out.append(f"  {kw}", style="bold yellow")
            out.append(f": {t}", style="dim")
            if choices:
                out.append(f" [{' | '.join(choices)}]", style="green")
            out.append("\n")
        out.append("\n")
    elif doc.params:
        out.append("PARAMETERS\n", style="bold underline")
        for prm in doc.params:
            out.append(f"  {prm.arg_name}", style="bold")
            out.append(f"  {prm.description or ''}\n")
        out.append("\n")

    if doc.long_description:
        out.append(f"{doc.long_description}\n", style="dim")
    return out
_OPEN_VERBS = {"open", "o"}

DEFAULT_ORCA_GRID = "\n".join(["." * 8] * 4)
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _rg_py_files(root: Path) -> list[str]:
    """`.py` files under `root`, relative paths: `rg --files` (fast, respects .gitignore),
    falling back to `os.walk` when `rg` isn't on PATH."""
    try:
        out = subprocess.run(
            ["rg", "--files", "-g", "*.py"], cwd=root, capture_output=True, text=True, timeout=5,
        )
        if out.returncode in (0, 1):
            return [l for l in out.stdout.splitlines() if l]
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    import os

    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "__pycache__"]
        for f in filenames:
            if f.endswith(".py"):
                found.append(str((Path(dirpath) / f).relative_to(root)))
    return found


def _fzf_rank(query: str, items: list[str]) -> list[str] | None:
    """`fzf --filter <query>` over `items` on stdin -> ranked matches, best first.
    None if `fzf` isn't on PATH (caller falls back to `_matcher_rank`)."""
    try:
        proc = subprocess.run(
            ["fzf", "--filter", query], input="\n".join(items), capture_output=True, text=True, timeout=3,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    return proc.stdout.splitlines() if proc.returncode in (0, 1) else []


def _matcher_rank(query: str, items: list[str]) -> list[str]:
    """Candidates ranked by `textual.fuzzy.Matcher` score, best first; input order on an empty
    query. The 1 matcher both features share: the slash dropdown's own ranking, and `/open`'s
    fallback when `fzf` is missing."""
    if not query:
        return list(items)
    matcher = Matcher(query)
    scored = [(matcher.match(it), it) for it in items]
    return [it for score, it in sorted(scored, key=lambda si: si[0], reverse=True) if score > 0]


def _highlight(query: str, text: str) -> Content:
    """`text` w/ its `query` match characters highlighted (`textual.fuzzy.Matcher.highlight`,
    which renders as `textual.content.Content`, not `rich.text.Text`) -- the same matcher
    `_matcher_rank` scores with, reused here purely for display, including over fzf-ranked
    `/open` results (fzf itself reports no match positions)."""
    return Matcher(query).highlight(text) if query else Content(text)

# plan (2026-10-10, "everything renders underneath its line"): a row that's a bare call to one
# 1 piece of brain state keyed by its own first string arg (`param("gain", ...)` -> component "gain");
# `row_anchor` recovers that (verb, id) pair from the row's own source so `app.py` can mount that state's
# panel right after this row's own widget, instead of a separate side panel. `embed(...)` creates no
# brain state but still gets an anchor (its `EmbedView` mounts the same way).
_ANCHOR_VERBS = {
    "param", "multi", "xy", "proc", "tex", "embed", "affinity", "output",
    "physics", "wave", "spectrum", "glyph", "lsys", "text", "melody", "py",
}


def _slug(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", s)


def anchor_id(kind: str, ident: str) -> str:
    return f"anchor-{kind}-{_slug(ident)}"


def bare_call(src: str, verbs: Container[str]) -> tuple[str, list[str | None], dict[str, str | None]] | None:
    """`verb("a", x, k="b")` -> `("verb", ["a", None], {"k": "b"})` (non-literal-string args ->
    None); None unless `src` is a single bare top-level call to one of `verbs`, or a single def
    decorated by one (`@proc("id", "py")` rows). The one row-call parser (`row_anchor`)."""
    try:
        tree = ast.parse(src.strip())
    except SyntaxError:
        return None
    if len(tree.body) != 1:
        return None
    node = tree.body[0]
    if isinstance(node, ast.FunctionDef) and len(node.decorator_list) == 1:
        call = node.decorator_list[0]
    elif isinstance(node, ast.Expr):
        call = node.value
    else:
        return None
    if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name) or call.func.id not in verbs:
        return None

    def lit(v: ast.expr) -> str | None:
        return v.value if isinstance(v, ast.Constant) and isinstance(v.value, str) else None

    return call.func.id, [lit(a) for a in call.args], {kw.arg: lit(kw.value) for kw in call.keywords if kw.arg}


def row_anchor(src: str, label: str | None = None) -> str | None:
    """`param("gain", 0, 2)` -> `anchor-param-gain`; None if `src` isn't a bare call to one of
    `_ANCHOR_VERBS` with a literal string first argument. If `label` is provided,
    scoped component/tex/proc/noise ids are qualified to match their parent-scoped brain component."""
    c = bare_call(src, _ANCHOR_VERBS)
    if c is None or not c[1] or c[1][0] is None:
        return None
    verb, ident = c[0], c[1][0]
    if label and label != "main" and verb in {"param", "multi", "xy", "proc", "tex", "embed", "affinity", "output", "physics", "wave", "spectrum", "glyph", "lsys", "text", "melody", "py"}:
        ident = resolve_path(label, ident)
    return anchor_id(verb, ident)



def parse_slash(text: str) -> tuple[str, list[str], dict[str, str]] | None:
    """`/verb a b k=v` -> (verb, [positional tokens...], {kw: value token}). None if unparseable."""
    stripped = text.strip()
    if not stripped.startswith("/"):
        return None
    try:
        tokens = shlex.split(stripped[1:])
    except ValueError:
        return None
    if not tokens:
        return None
    name, rest = tokens[0], tokens[1:]
    args: list[str] = []
    kwargs: dict[str, str] = {}
    for tok in rest:
        if "=" in tok:
            k, v = tok.split("=", 1)
            kwargs[k] = v
        else:
            args.append(tok)
    return name, args, kwargs


_BRACKETS = {"(": ")", "[": "]", "{": "}"}
_BRACKETS_REV = {v: k for k, v in _BRACKETS.items()}


def _literal(tok: str):
    try:
        return ast.literal_eval(tok)
    except Exception:  # noqa: BLE001 - fall back to the raw token as a string
        return tok


def slash_to_call(text: str) -> tuple[str, str] | None:
    """`/proc word glyph text=X` -> ("proc", 'proc("word", "glyph", text="X")'). None if unparseable."""
    parsed = parse_slash(text)
    if parsed is None:
        return None
    name, args, kwargs = parsed
    parts = [repr(_literal(a)) for a in args]
    parts += [f"{k}={_literal(v)!r}" for k, v in kwargs.items()]
    return name, f"{name}({', '.join(parts)})"


class CmdBar(Input):
    """Global command line at the bottom (J 2026-10-12: commands never typed into the row
    editor/nvim). `:` in NORMAL opens it; drives `SlashDropdown`; Enter -> `run_command`."""

    def _owner(self) -> "BlockColumns | None":
        p = self.parent.parent if self.parent is not None else None
        return p if isinstance(p, BlockColumns) else None

    async def _on_key(self, event: events.Key) -> None:
        owner = self._owner()
        if owner is not None:
            if event.key in ("up", "down", "tab", "escape", "enter"):
                event.stop()
                event.prevent_default()
                if event.key in ("up", "down"):
                    owner.slash_move(1 if event.key == "down" else -1)
                elif event.key == "tab":
                    owner.slash_accept()
                elif event.key == "escape":
                    owner.close_cmdbar()
                else:
                    owner.cmdbar_enter()
                return
        await super()._on_key(event)


class SlashDropdown(OptionList):
    """Candidate list for the `/` row, mounted directly under the edit line (plan 2026-10-10:
    1 panel, everything renders under its own row -- no side overlay). Replaces the old
    `textual_autocomplete.AutoComplete` (hard-required an `Input` target, incompatible w/
    `RowVimTextArea`/`TextArea`): own Up/Down/Tab/Enter/Esc wiring driven by `BlockColumns`/
    `RowVimTextArea` below instead of the library's. 2 candidate sources, 1 `OptionList`:
    `LOCAL_COMMANDS` + brain verbs (fuzzy-ranked/highlighted, `textual.fuzzy.Matcher`), or,
    once `/open`/`/o` + a space is typed, `.py` files under the project (fzf-ranked, Matcher-
    highlighted) -- see `BlockColumns._update_slash_dropdown`."""

    DEFAULT_CSS = """
    SlashDropdown { height: auto; max-height: 10; display: none; border: round $panel; padding: 0 1; }
    SlashDropdown.shown { display: block; }
    """


class RowVimTextArea(VimTextArea):
    """1 row's text, modal-edited by `textual-vim-textarea`'s own engine (motions, counts,
    i/a/I/A, x, dw/cw/yw, char-level visual mode -- all its job, untouched here).

    This subclass only intercepts the row/doc-level vim commands the library can't express
    (it only ever sees this 1 row's own text, never the tree of rows around it): dd/yy/p
    (whole rows), o/O (new row), j/k (prev/next row), gg/G (first/last row), h/l at the line
    edge (zoom out/in), %, `/`/`?` (search), ctrl+g (location), u/ctrl+r/U (the row/doc undo
    journal) -- all forwarded to the owning `BlockColumns`. Everything else falls through to
    the library via `super()`.
    """

    def __init__(self, *a, **kw) -> None:
        super().__init__(*a, **kw)
        self._pending_replace = False  # `r`: awaiting the 1 replacement char (library has no `r`)
        self._pending_z = False  # `z`: awaiting `a`/`f`/`d`/`D`/... (library has no `z`)
        self._pending_zf = False  # `zf`: awaiting its motion (j/k/G -- `fold_wrap_rows`)
        self._pending_bracket_z: int | None = None  # `[`/`]`: awaiting `z` (-1/+1 = which bracket)

    def _owner(self) -> "BlockColumns | None":
        return self.parent if isinstance(self.parent, BlockColumns) else None

    async def _handle_command_key(self, event: events.Key) -> None:
        """`:` typing never changes mode, so no `ModeChanged` -> redraw the crumb's `:<buffer>`."""
        await super()._handle_command_key(event)
        if (owner := self._owner()) is not None:
            owner.refresh_crumb()

    async def _on_key(self, event: events.Key) -> None:
        owner = self._owner()
        if owner is None:
            await super()._on_key(event)
            return
        if self.mode is Mode.NORMAL and event.character == ":":  # global cmd bar, !vim's own `:`
            event.stop()
            event.prevent_default()
            owner.open_cmdbar()
            return
        if owner._slash_open:
            if event.key in ("up", "down"):
                event.stop()
                event.prevent_default()
                owner.slash_move(1 if event.key == "down" else -1)
                return
            if event.key == "tab":
                event.stop()
                event.prevent_default()
                owner.slash_accept()
                return
            if event.key == "enter":
                # exact match already typed (e.g. "/help") -> close + fall through to the
                # existing INSERT-Enter submit branch below, same as before any dropdown
                # existed; otherwise Enter completes the highlighted candidate like Tab.
                dd = owner.slash_dropdown
                verb = dd.get_option_at_index(dd.highlighted or 0).id if dd.option_count else None
                if verb is not None and self.text.strip() != f"/{verb}":
                    event.stop()
                    event.prevent_default()
                    owner.slash_accept()
                    return
                owner.slash_close()
            if event.key == "escape":
                # first Esc closes the dropdown only; vim's own Esc behavior (INSERT -> NORMAL,
                # drop draft, ...) still runs on a 2nd Esc, same as before there was a dropdown.
                event.stop()
                event.prevent_default()
                owner.slash_close()
                return
        if owner._input_purpose == "search":
            event.stop()
            event.prevent_default()
            owner.handle_search_key(event)
            return
        if event.key == "escape" and owner._new_at is not None:
            event.stop()
            event.prevent_default()
            owner.action_drop()
            return
        if event.key == "escape" and self.mode is Mode.INSERT:
            owner._stash()  # leaving INSERT: write back like leaving a row (library does the mode switch)
        if event.key == "left":
            row, col = self.cursor_location
            if row == 0 and col == 0:
                event.stop()
                event.prevent_default()
                owner.exit_level()
                return
        elif event.key == "right":
            # document end, not "end of row 0": a row's own text can itself be multi-line (an
            # orca grid's triple-quoted literal), so "last row" is the document's last line,
            # not row 0 (the old flat `Input` had no such distinction -- 1 string, 1 index).
            end_row, end_col = self.document.end
            row, col = self.cursor_location
            if row == end_row and col >= max(0, end_col - 1):
                event.stop()
                event.prevent_default()
                # `→` = this row's own controls; no panel -> drill in (J 2026-10-12)
                if not owner.focus_row_controls():
                    owner.enter_level()
                return
        elif event.key in ("up", "down") and self.mode is not Mode.NORMAL:
            # row nav: NORMAL already gets this via `_handle_normal_key`'s own j/k-or-arrow
            # branch; other modes (chiefly INSERT) never did bind up/down themselves (nvim
            # tutor: a 1-line row has nothing to navigate internally), so -- like the old
            # LineInput(Input), which had no up/down binding either -- it's ours to catch.
            event.stop()
            event.prevent_default()
            owner.action_move(1 if event.key == "down" else -1)
            return
        elif event.key == "enter" and self.mode is Mode.INSERT:
            # commit (Enter-to-submit is an INSERT-only affordance, same as before: NORMAL's
            # own "enter" means nothing to vim and falls through doing nothing).
            event.stop()
            event.prevent_default()
            owner._submit_text(self.text)
            return
        elif event.key == "ctrl+k":
            row, col = self.cursor_location
            if col == 0:
                event.stop()
                event.prevent_default()
                owner.action_delete_row()
                return
        await super()._on_key(event)

    def _handle_normal_key(self, event: events.Key) -> bool:
        owner = self._owner()
        if owner is None or self.mode is not Mode.NORMAL:
            return super()._handle_normal_key(event)  # visual/command mode = fully the library's
        ch, key = event.character, event.key

        if self._pending_replace:
            self._pending_replace = False
            if ch:
                owner.replace_char(ch)
            return True

        if ch is not None and ch.isdigit() and (ch != "0" or self._count):
            return super()._handle_normal_key(event)  # count accumulation = library's own state

        if self._pending_g:
            self._pending_g = False
            if ch == "g":
                owner.action_first()
            return True

        if self._pending_zf:
            self._pending_zf = False
            if ch is None:
                return True
            span = {"j": 2, "k": 2, "G": len(owner.rows) - owner._depth0_index}.get(ch)
            if span is not None:
                owner.fold_wrap_rows(span)
            return True

        if self._pending_z:
            self._pending_z = False
            if ch == "a":
                owner.toggle_peek()
            elif ch == "A":
                owner.toggle_peek_recursive()
            elif ch == "R":
                owner.fold_open_all()
            elif ch == "M":
                owner.fold_close_all()
            elif ch == "r":
                owner.fold_level_step(1)
            elif ch == "m":
                owner.fold_level_step(-1)
            elif ch == "j":
                owner.fold_next()
            elif ch == "k":
                owner.fold_prev_end()
            elif ch == "f":
                self._pending_zf = True
            elif ch == "d":
                owner.fold_unwrap_block(recursive=False)
            elif ch == "D":
                owner.fold_unwrap_block(recursive=True)
            return True

        if self._pending_bracket_z is not None:
            d, self._pending_bracket_z = self._pending_bracket_z, None
            if ch == "z":
                (owner.jump_block_start if d < 0 else owner.jump_block_end)()
            return True

        if ch in ("[", "]"):
            self._pending_bracket_z = -1 if ch == "[" else 1
            return True

        if ch == "z":
            self._count = ""
            self._pending_z = True
            return True

        if self._pending_op in ("d", "y") and ch == self._pending_op:
            op = self._pending_op
            trailing = int(self._count) if self._count else 1
            total = self._pending_op_count * trailing
            self._pending_op, self._pending_op_count, self._count = None, 1, ""
            owner.row_op_line(op, total)
            return True

        if self._pending_op is not None:
            return super()._handle_normal_key(event)  # d{motion}/c{motion}/y{motion} = in-row

        had_count = bool(self._count)
        count = int(self._count) if self._count else 1

        if ch == "G":
            self._count = ""
            owner.action_goto(count) if had_count else owner.action_last()
            return True
        if ch == "j" or key == "down":
            self._count = ""
            for _ in range(count):
                owner.action_move(1)
            return True
        if ch == "k" or key == "up":
            self._count = ""
            for _ in range(count):
                owner.action_move(-1)
            return True
        if ch == "h" and self.cursor_location[1] == 0:
            self._count = ""
            owner.exit_level()
            return True
        if ch == "l":
            end_row, end_col = self.document.end  # document end, not row-0 end (see `_on_key`)
            row, col = self.cursor_location
            if row == end_row and col >= max(0, end_col - 1):
                self._count = ""
                # `l` at the row end mirrors `→`: this row's controls, else drill in
                if not owner.focus_row_controls():
                    owner.enter_level()
                return True
        if ch == "p":
            self._count = ""
            owner.row_put(after=True, count=count)
            return True
        if ch == "P":
            self._count = ""
            owner.row_put(after=False, count=count)
            return True
        if ch == "o":
            self._count = ""
            owner.enter_new_row(below=True)
            return True
        if ch == "O":
            self._count = ""
            owner.enter_new_row(below=False)
            return True
        if ch == "r":
            self._count = ""
            self._pending_replace = True
            return True
        if ch == "%":
            self._count = ""
            owner.jump_match_bracket()
            return True
        if ch == "/":
            self._count = ""
            owner.enter_search("/", 1)
            return True
        if ch == "?":
            self._count = ""
            owner.enter_search("?", -1)
            return True
        if ch == "n":
            self._count = ""
            owner.repeat_search(reverse=False)
            return True
        if ch == "N":
            self._count = ""
            owner.repeat_search(reverse=True)
            return True
        if ch == "u":
            self._count = ""
            owner.action_undo()
            return True
        if key == "ctrl+r":
            self._count = ""
            owner.action_redo()
            return True
        if ch == "U":
            self._count = ""
            owner.action_undo_line()
            return True
        if key == "ctrl+g":
            self._count = ""
            owner.show_location()
            return True

        return super()._handle_normal_key(event)


class RowBox(Vertical):
    """1 tree row = its line `Static` (`rl-…`, 1st child) + whatever renders under that line
    (component/tex panels, `embed(...)` views -- mounted INTO the box by app.py). Textual's
    own layout keeps them together; !sibling-anchoring in a flat `#rows` list."""

    DEFAULT_CSS = "RowBox { height: auto; }"

    def __init__(self, line: Static, *, id: str) -> None:
        super().__init__(line, id=id)
        # kept by reference: a box mounted this tick has no children attached yet, so a
        # same-tick 2nd `refresh_rows` can't `query_one` its Static (NoMatches, 2026-10-11)
        self.line = line


class BlockColumns(Vertical):
    DEFAULT_CSS = """
    BlockColumns { height: 1fr; }
    BlockColumns #crumb { height: 1; color: $text-muted; }
    BlockColumns #bottom { height: auto; dock: bottom; }
    BlockColumns #quickhelp { height: 1; color: $text-muted; }
    BlockColumns #manhelp { height: auto; max-height: 12; padding: 0 1; border-top: solid $panel; display: none; }
    BlockColumns #manhelp.shown { display: block; }
    BlockColumns #cmdbar { display: none; height: 3; border: round $panel; padding: 0 1; }
    BlockColumns #cmdbar.shown { display: block; }
    /* `#rows` holds 1 Static per row (`rl-N`, rebuilt every refresh, cheap) plus, interleaved
    right after the row that created it, that row's own live component/tex/view panel (mounted
    by app.py, kept in place across refreshes -- plan: "everything renders underneath its
    line", 2026-10-10). A VerticalScroll (not the old manual-windowed Static) because panels can
    be taller than 1 line; still 1 full-width column, no second panel. */
    BlockColumns #rows { height: 1fr; scrollbar-size: 0 0; scrollbar-gutter: auto; }
    BlockColumns #line { border: none; height: 1; padding: 0 1; scrollbar-size: 0 0; }
    BlockColumns #toast { dock: bottom; height: 3; display: none; background: $warning 20%; padding: 0 1; }
    BlockColumns #toast.shown { display: block; }
    BlockColumns #toast Static { width: 1fr; content-align: left middle; height: 3; }
    BlockColumns #toast Button { min-width: 10; }
    """
    BINDINGS = [
        Binding("escape", "drop", "drop draft", show=False),
        Binding("ctrl+k", "delete_row", "delete row", show=False),
    ]

    class RowsChanged(Message):
        """`refresh_rows` mounted/removed row boxes or zoom changed: app re-places panels."""

    class Committed(Message):
        """A row was written back (app evals it: subtree if a nest header, else its nest's leaves)."""

        def __init__(self, path: RowPath) -> None:
            self.path = path
            super().__init__()

    class Deleted(Message):
        """A nest row was deleted; `labels` = every label (self + descendant nests) to drop."""

        def __init__(self, labels: list[str]) -> None:
            self.labels = labels
            super().__init__()

    class Command(Message):
        """A local slash command (`/help`, `/block NAME`, ...) was submitted."""

        def __init__(self, name: str, args: list[str]) -> None:
            self.name = name
            self.args = args
            super().__init__()

    class FileOpened(Message):
        """`/open`/`/o`: `doc` replaced the one `BlockColumns` was showing (app keeps its own
        `self.doc`/`self.path` -- used by `action_eval_all`/`on_block_columns_committed` -- in
        sync with this)."""

        def __init__(self, doc: Doc) -> None:
            self.doc = doc
            super().__init__()

    def __init__(self, doc: Doc, commands: list[dict] | None = None, client: Client | None = None,
                 nvim: bool = False, ns: dict[str, Any] | None = None, **kw) -> None:
        super().__init__(**kw)
        self.doc = doc
        self.ns = ns or {}  # livecode namespace (`Repl.ns`): QUICKHELP man pages for the picked row
        self.commands = commands or []  # brain verbs: [{"verb","args","doc"}, ...]
        self.client = client  # used once, at mount, to fetch the orca adapter's [view] facts
        self.nvim_mode = nvim  # nvim (only editor; False = headless test fallback): `#line` = `NvimRowEditor`, not `RowVimTextArea`
        self.parent_path: RowPath = ()
        self.cursor = 0
        self._anchor_map: dict[str, int] = {}  # anchor_id -> row index @ current parent, `anchor_widget`'s cache
        self._anchor_map_key: tuple | None = None  # (id(doc), doc.version, parent_path) it was built for
        self._row_gen = 0  # bumped whenever `refresh_rows` mounts/removes a row Static (app `_rehome` key)
        self.new_draft = ""  # text in the trailing new-row slot
        self._anchor: tuple[str, RowPath] | None = None  # (cursor row text, path) before the external edit
        self._loaded = ""  # edit-line text as last loaded (unchanged = not mid-edit)
        # orca adapter's [view] manifest facts (attach/session/seed), fetched once at mount from
        # the brain (asemic/adapter/orca/schema) — None = brain unreachable or orca not a
        # configured adapter; every orca affordance below then shows "orca adapter not running".
        self._orca_view: dict[str, str] | None = None
        self._orca_path: RowPath | None = None  # row path a live PtyTerminal is editing, if any
        self._orca_mtime: float | None = None
        self._orca_poll: Any = None  # Textual Timer
        # --- orca regions (plan §3): every orca row anywhere in the doc = a region of the one
        # shared grid file/process; recomputed (`_reseed_orca`) on every render, keyed by path.
        self._orca_layout: dict[RowPath, tuple[int, int, int, int]] = {}
        self._orca_composed = ""  # last grid text written to the orca adapter's grid file
        self._orca_capture: str | None = None  # last `tmux capture-pane -p -e`, None = no session
        self._orca_pane_size: tuple[int, int] | None = None  # (ncol, nrow) the capture was taken at
        # --- row/doc-level vim state (nvim tutor semantics; row = a line); in-row editing
        # itself (motions, counts, i/a/I/A, x, dw/cw/yw, char-level visual) = `RowVimTextArea`
        # (`textual-vim-textarea`'s `VimTextArea`), `self.line` below.
        self._row_register: list[str] | None = None  # last row-wise yank/delete (dd/yy -> p/P)
        # undo/redo journal, u/U/ctrl+r (still ours: spans row add/remove + committed row edits,
        # the library only ever sees 1 row's own in-progress text). Entries (tagged, so
        # dd/o/O/p/P row ops share 1 stack w/ committed char edits): ("edit", path, before,
        # after) | ("del", parent, index, [texts]) rows deleted starting at index | ("ins",
        # parent, index, [texts]) rows inserted there.
        self._undo: list[tuple] = []
        self._redo: list[tuple] = []
        self._search = ""  # last search pattern (n/N repeat)
        self._search_dir = 1
        self._search_pending_dir = 1
        self._input_purpose: str | None = None  # None | "search" (`/`/`?`; ":" = the library's own COMMAND mode)
        self._new_at: int | None = None  # pending insert index for `o`/`O` (not yet a real row)
        # slash dropdown (`SlashDropdown`, mounted right under `#line`): same candidate source as
        # the old `AutoComplete` (LOCAL_COMMANDS + brain verbs), prefix-filtered.
        self._slash_items = [(c["verb"], c["args"]) for c in (*LOCAL_COMMANDS, *self.commands)]
        self._slash_open = False
        # `/open` file mode (plan: fzf-ranked `.py` file picker reusing `SlashDropdown`): query
        # debounced off the UI thread (`@work(thread=True)`); `_py_files_cache` built once/instance.
        self._slash_file_mode = False
        self._open_timer: Any = None
        self._py_files_cache: list[str] | None = None
        self._jumps: list[tuple[RowPath, int]] = []  # jumplist (`goto_comp`/`focus_label`)
        self._jump_i = 0
        # fold-peek (`za`): nest paths expanded to show their children inline, read-only, under
        # the current level (plan 2026-10-10 "expand to rows, don't render components until
        # zoom in"). Rows start collapsed; persists across cursor moves, cleared only on
        # `/open`ing a different file.
        self._expanded: set[RowPath] = set()
        # fold level (`zr`/`zm`/`zR`/`zM`): blocks nested < this many levels deep (under the
        # current level) are open; `zR` = max depth present, `zM` = 0. Independent knob from
        # manual `za`/`zA` toggles, which win until the next foldlevel change recomputes
        # `self._expanded` wholesale.
        self._foldlevel = 0

    def compose(self) -> ComposeResult:
        yield Static(id="crumb")
        if self.nvim_mode:  # code line on top, under the crumb (J 2026-10-12)
            yield NvimRowEditor(self.doc.path or Path("untitled.py"), id="line")
        else:
            yield RowVimTextArea(
                "", id="line", placeholder="new row", show_line_numbers=False, soft_wrap=False,
                tab_behavior="focus", compact=True, highlight_cursor_line=False,
            )
        yield VerticalScroll(id="rows")
        with Vertical(id="bottom"):
            yield VerticalScroll(Static(id="manhelp-text", markup=False), id="manhelp")
            yield SlashDropdown(id="slash-dropdown")
            yield CmdBar(placeholder=":command  (tab complete, enter run, esc cancel)", id="cmdbar")
            yield Static(id="quickhelp")
        with Horizontal(id="toast"):
            yield Static("file changed above the cursor: rows/drafts may be misplaced", id="toast-msg")
            yield Button("reparse", id="reparse", variant="warning")
            yield Button("dismiss", id="dismiss")

    def on_mount(self) -> None:
        self._load()
        self.line.mode = Mode.NORMAL  # start NORMAL (J 2026-10-11: !start in INSERT)
        # Textual auto-focuses the 1st focusable widget on mount; the old `Input` (LineInput)
        # had `select_on_focus=True` by default, so that 1 initial focus selected the whole row
        # and the very first keystroke replaced it (several slash-command tests rely on this
        # exact one-shot behavior). `TextArea` has no such default, so it's replicated by hand,
        # once, here -- every later `_load()`/row switch overwrites `.text` wholesale anyway
        # (nothing left to select), so this never fights normal in-row editing.
        self.line.focus()
        self.line.select_all()
        self._fetch_orca_view()
        self.set_interval(0.25, self._sync)
        self.set_interval(0.2, self._sample_orca)  # inline subcanvases (plan §3)

    def _fetch_orca_view(self) -> None:
        """Cache the orca adapter's `[view]` manifest facts once (brain `asemic/adapter/orca/schema`,
        crates/schema's `ViewSpec` — attach/session/seed). Brain down or orca not configured as an
        adapter: `self._orca_view` stays None, every orca affordance shows "orca adapter not
        running" (feedback-adapter-viewers: never hard-code what only the adapter's own lifecycle
        owns)."""
        if self.client is None:
            return
        try:
            replies = self.client.get("asemic/adapter/orca/schema", timeout=1.0)
        except Exception:
            return
        for _, manifest in replies:
            view = (manifest or {}).get("view")
            if view:
                self._orca_view = view
                return

    @property
    def _orca_grid_file(self) -> Path | None:
        if self._orca_view is None:
            return None
        return ORCA_ADAPTER_DIR / self._orca_view["seed"]

    @property
    def _orca_session(self) -> str | None:
        return self._orca_view["session"] if self._orca_view is not None else None

    def _sync(self) -> None:
        """External file edits -> reload rows; keep the edit line if J is mid-edit."""
        before = (self.doc.src_at(self.path), self.path) if self.path is not None else None
        if not self.doc.sync():
            return
        if before and before[0] is not None and self.doc.src_at(before[1]) != before[0] or self.doc.misplaced:
            if before is not None:
                self._anchor = self._anchor or before  # keep the first anchor until resolved
            self.query_one("#toast").add_class("shown")
        editing = self.line.text != self._loaded
        rows = self.rows if self.doc._exists(self.parent_path) and self.doc.is_nest(self.parent_path) else None
        if rows is None:
            self.parent_path, self.cursor = (), 0
            rows = self.rows
        self.cursor = min(self.cursor, len(self.visible))
        if not editing:
            self._load()
        else:
            self.refresh_rows()

    # ------------------------------------------------------------ state
    @property
    def rows(self) -> list[Row]:
        return self.doc.rows(self.parent_path)

    def _flatten(self, parent: RowPath, depth: int = 0) -> list[tuple[RowPath, Row, int]]:
        """`parent`'s own rows (depth 0) + every expanded nest's children, recursively, each
        tagged with its peek depth (0 = current level, editable; >0 = peeked, read-only).
        Fold-peek (plan 2026-10-10): `za` toggles membership in `self._expanded`."""
        out: list[tuple[RowPath, Row, int]] = []
        for r in self.doc.rows(parent):
            out.append((r.path, r, depth))
            if r.name is not None and r.path in self._expanded:
                out.extend(self._flatten(r.path, depth + 1))
        return out

    @property
    def visible(self) -> list[tuple[RowPath, Row, int]]:  # type: ignore[override]
        """Flat display order at the current level: `self.rows` interleaved w/ any peeked
        descendants. `self.cursor` indexes into this, not into `self.rows` directly."""
        return self._flatten(self.parent_path)

    @property
    def path(self) -> RowPath | None:
        """Path of the row under the cursor (possibly a peeked descendant); None on the
        new-row slot (cursor at the end of `visible`)."""
        vis = self.visible
        return vis[self.cursor][0] if self.cursor < len(vis) else None

    @property
    def cursor_depth(self) -> int:
        """0 = cursor on a current-level row (or the new-row slot); >0 = on a peeked row."""
        vis = self.visible
        return vis[self.cursor][2] if self.cursor < len(vis) else 0

    @property
    def cursor_peeked(self) -> bool:
        return self.cursor_depth > 0

    @property
    def _depth0_index(self) -> int:
        """Index into `self.rows` the cursor corresponds to: the path's own index when the
        cursor is on a current-level row, else `len(self.rows)` (new-row slot, or -- row ops
        are guarded off of peeked rows -- harmlessly the tail when it isn't)."""
        p = self.path
        if p is not None and len(p) == len(self.parent_path) + 1:
            return p[-1]
        return len(self.rows)

    def _cursor_for_row(self, idx: int) -> int:
        """Visible-list cursor position for current-level row index `idx` (>= `len(self.rows)`
        = the new-row slot) -- converts a depth-0 row index to a `visible` index, accounting
        for any peeked rows interleaved before it."""
        vis = self.visible
        depth0 = [i for i, (_, _, d) in enumerate(vis) if d == 0]
        return depth0[idx] if idx < len(depth0) else len(vis)

    def _cursor_for_path(self, path: RowPath) -> int:
        """Visible-list cursor position for `path` if it's still shown, else the current
        cursor clamped (used after `za` changes what's visible)."""
        for i, (p, _, _) in enumerate(self.visible):
            if p == path:
                return i
        return min(self.cursor, len(self.visible))

    def _guard_edit(self) -> bool:
        """True (+ hint) if the cursor is on a peeked row: those are read-only -- zoom in
        (`l`/`→`) to edit them."""
        if self.cursor_peeked:
            self.notify("zoom in to edit", severity="warning")
            return True
        return False

    @property
    def line(self) -> "RowVimTextArea | NvimRowEditor":
        return self.query_one("#line", NvimRowEditor if self.nvim_mode else RowVimTextArea)

    def on_nvim_row_editor_changed(self, ev: NvimRowEditor.Changed) -> None:
        """DRY w/ `on_text_area_changed` below: nvim's own buffer-change bridge (`asemic_text`)
        drives the same slash-dropdown update the library's `TextArea.Changed` drives."""
        self._update_slash_dropdown()

    def _row_at(self, path: RowPath) -> Row:
        return self.doc.rows(path[:-1])[path[-1]]

    def _text_for(self, path: RowPath | None) -> str:
        if path is None:
            return self.new_draft
        r = self._row_at(path)
        return r.draft if r.draft is not None else r.src

    def _load(self) -> None:
        if self._new_at is not None:
            self.line.text = self._loaded = ""
        else:
            self.line.text = self._loaded = self._text_for(self.path)
        self.line.cursor_location = self.line.document.end
        self.line.read_only = self.cursor_peeked
        self.refresh_rows()

    def _stash(self) -> None:
        """Leaving the row: write back if changed (bad text stays a draft). Peeked rows are
        read-only -- never staged. In nvim mode, reads the scratch buffer authoritatively
        (`NvimRowEditor.sync_text`, see `nvim_view.py`) rather than the local cache, which is
        only eventually consistent with nvim's own buffer-change notifications."""
        if self.cursor_peeked:
            return
        text = self.line.sync_text() if self.nvim_mode else self.line.text
        path = self.path
        if path is None:
            self.new_draft = text
        elif text != self._text_for(path):
            self.doc.stage(path, text)

    # ------------------------------------------------------------ slash dropdown (plan
    # 2026-10-10: renders directly under the edit line, no side overlay; replaces the old
    # `textual_autocomplete.AutoComplete`, which hard-required an `Input` target)
    @property
    def slash_dropdown(self) -> SlashDropdown:
        return self.query_one("#slash-dropdown", SlashDropdown)

    def _slash_candidates(self, prefix: str) -> list[tuple[str, list[str]]]:
        """Verb completion (no space yet after the verb): every `LOCAL_COMMANDS`/brain-verb
        name fuzzy-ranked against `prefix` (`_matcher_rank`; `/hp` -> `/help`)."""
        by_verb = dict(self._slash_items)
        return [(verb, by_verb[verb]) for verb in _matcher_rank(prefix, list(by_verb))]

    def on_text_area_changed(self, event: TextArea.Changed) -> None:
        pass  # row text never drives commands (J 2026-10-12): `CmdBar` does

    def on_input_changed(self, ev: Input.Changed) -> None:
        if ev.input.id == "cmdbar":
            ev.stop()
            self._update_slash_dropdown("/" + ev.value)

    def open_cmdbar(self) -> None:
        self._stash()  # commit the open row before any global command moves/edits rows
        bar = self.query_one("#cmdbar", CmdBar)
        bar.value = ""
        bar.add_class("shown")
        bar.focus()
        self._update_slash_dropdown("/")
        self.refresh_crumb()

    def close_cmdbar(self) -> None:
        self.slash_close()
        bar = self.query_one("#cmdbar", CmdBar)
        bar.remove_class("shown")
        bar.value = ""
        self.line.focus()
        self.refresh_crumb()

    def cmdbar_enter(self) -> None:
        """Enter: highlighted candidate unless the verb is already typed exactly; then run."""
        bar, dd = self.query_one("#cmdbar", CmdBar), self.slash_dropdown
        if self._slash_open and dd.option_count:
            sel = dd.get_option_at_index(dd.highlighted or 0).id
            if self._slash_file_mode or (sel is not None and " " not in bar.value.strip() and bar.value.strip() != sel):
                self.slash_accept()
                if not bar.has_class("shown") or self._slash_file_mode:
                    return
                if bar.value.strip().split(" ")[0] in _OPEN_VERBS:
                    return  # `open ` completed: now pick a block/file
        text = bar.value.strip()
        self.close_cmdbar()
        if text:
            self.run_command("/" + text)

    def _update_slash_dropdown(self, text: str | None = None) -> None:
        dd = self.slash_dropdown
        text = self.line.text if text is None else text
        if self._input_purpose is not None or not text.startswith("/"):
            self.slash_close()
            return
        verb, _, rest = text[1:].partition(" ")
        if verb in _OPEN_VERBS and " " in text[1:]:
            if not self._slash_file_mode:
                dd.clear_options()  # leaving verb-mode: drop its stale options/ids first
            self._slash_file_mode = True
            self._schedule_open_search(rest)
            return
        self._slash_file_mode = False
        if " " in text:  # args typed for a non-`/open` verb: nothing left to complete
            self.slash_close()
            return
        candidates = self._slash_candidates(verb)
        if not candidates:
            self.slash_close()
            return
        dd.clear_options()
        for v, args in candidates:
            arglist = f"({', '.join(args)}) " if args else ""
            dd.add_option(Option(Content(arglist) + _highlight(verb, f":{v}"), id=v))
        dd.highlighted = 0
        self._slash_open = True
        dd.add_class("shown")

    # -------------------------------------------------- `/open` file mode (fzf, debounced)
    def _py_files(self) -> list[str]:
        if self._py_files_cache is None:
            self._py_files_cache = _rg_py_files(PROJECT_ROOT)
        return self._py_files_cache

    def _schedule_open_search(self, query: str) -> None:
        if self._open_timer is not None:
            self._open_timer.stop()
        self._open_timer = self.set_timer(0.12, lambda: self._search_files(query))

    @work(thread=True, exclusive=True, group="open-search")
    def _search_files(self, query: str) -> None:
        """Off the UI thread (plan: real `fzf --filter`, async/debounced): ranks `self._py_files()`
        against `query`, falling back to `_matcher_rank` when `fzf` isn't on PATH."""
        labels = [self.doc.label(p) for p, _ in self.doc.walk() if self.doc.is_nest(p)]
        blocks = _matcher_rank(query, labels)
        files = self._py_files()
        ranked = _fzf_rank(query, files)
        if ranked is None:
            ranked = _matcher_rank(query, files)
        self.app.call_from_thread(self._show_open_results, query, blocks, ranked[:50])

    def _show_open_results(self, query: str, blocks: list[str], files: list[str]) -> None:
        """Blocks of this doc first (`b:` ids -> `focus_label`), then `.py` files (`f:` ids)."""
        dd = self.slash_dropdown
        dd.clear_options()
        for b in blocks:
            dd.add_option(Option(Content("▸ ") + _highlight(query, b), id=f"b:{b}"))
        for f in files:
            highlighted = _highlight(query, f)
            dd.add_option(Option(file_link_content(PROJECT_ROOT / f, label=f, base=highlighted), id=f"f:{f}"))
        dd.highlighted = 0 if blocks or files else None
        self._slash_open = True
        dd.add_class("shown")

    def slash_move(self, d: int) -> None:
        dd = self.slash_dropdown
        if dd.option_count == 0:
            return
        dd.highlighted = max(0, min(dd.option_count - 1, (dd.highlighted or 0) + d))

    def slash_accept(self) -> None:
        dd = self.slash_dropdown
        if dd.option_count == 0:
            return
        selected = dd.get_option_at_index(dd.highlighted or 0).id
        if selected is None:
            return
        file_mode = self._slash_file_mode
        self.slash_close()
        if file_mode:
            kind, _, target = selected.partition(":")
            self.close_cmdbar()
            if kind == "b":
                self.focus_label(target)
            else:
                self.open_file(Path(target))
            return
        bar = self.query_one("#cmdbar", CmdBar)
        bar.value = f"{selected} "
        bar.cursor_position = len(bar.value)

    def slash_close(self) -> None:
        self._slash_open = False
        self._slash_file_mode = False
        if self._open_timer is not None:
            self._open_timer.stop()
            self._open_timer = None
        self.slash_dropdown.remove_class("shown")

    def open_file(self, path: Path) -> None:
        """`/open`/`/o`: save the current row (same stash `action_quit` relies on), then load
        `path` as the doc -- the same `Doc.load` the CLI `file` arg uses."""
        self._stash()
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        try:
            doc = Doc.load(path)
        except Exception as e:  # noqa: BLE001 - bad file: report, keep the current doc
            self.notify(str(e).split("\n", 1)[0], severity="error")
            return
        self.doc = doc
        self.parent_path, self.cursor = (), 0
        self._new_at = None
        self.new_draft = ""
        self._row_register = None
        self._undo.clear()
        self._redo.clear()
        self._anchor = None
        self._expanded.clear()
        self.post_message(self.FileOpened(doc))
        self._load()

    # ------------------------------------------------------------ actions
    def action_move(self, d: int) -> None:
        self._new_at = None
        self._stash()
        self.cursor = (self.cursor + d) % (len(self.visible) + 1)  # wraps (J 2026-10-12); +1 = new-row slot
        self._load()

    def action_first(self) -> None:
        self._new_at = None
        self._stash()
        self.cursor = 0
        self._load()

    def action_last(self) -> None:
        self._new_at = None
        self._stash()
        self.cursor = len(self.visible)
        self._load()

    def action_goto(self, n: int) -> None:
        """`{n}G`: 1-indexed row n of the current level."""
        self._new_at = None
        self._stash()
        self.cursor = self._cursor_for_row(max(0, min(n - 1, len(self.rows))))
        self._load()

    def toggle_peek(self) -> None:
        """`za` on a nest row (current-level or itself already peeked): expand it to show its
        children inline (full width, no indent, `│ ` gutter per peek depth), read-only, or
        collapse it back. Recurses: `za` on a peeked nest row peeks it too."""
        p = self.path
        if p is None or not self.doc.is_nest(p):
            self.notify("za: not a nest row", severity="warning")
            return
        if p in self._expanded:
            self._expanded.discard(p)
        else:
            self._expanded.add(p)
        self.cursor = self._cursor_for_path(p)
        self._load()

    def toggle_peek_recursive(self) -> None:
        """`zA`: like `za`, but recursive -- opens/closes every nest below the cursor's nest
        row too, not just itself."""
        p = self.path
        if p is None or not self.doc.is_nest(p):
            self.notify("zA: not a nest row", severity="warning")
            return
        if p in self._expanded:
            self._expanded = {q for q in self._expanded if q != p and q[: len(p)] != p}
        else:
            self._expanded.add(p)
            self._expanded.update(q for q, _ in self.doc.walk(p) if self.doc.is_nest(q))
        self.cursor = self._cursor_for_path(p)
        self._load()

    def _all_nest_depths(self) -> list[tuple[RowPath, int]]:
        """Every nest row under the current level, tagged w/ nesting depth (0 = a direct
        child of the current level) -- `self._foldlevel`'s own unit."""
        out: list[tuple[RowPath, int]] = []

        def walk(parent: RowPath, depth: int) -> None:
            for r in self.doc.rows(parent):
                if r.name is not None:
                    out.append((r.path, depth))
                    walk(r.path, depth + 1)

        walk(self.parent_path, 0)
        return out

    def _max_foldlevel(self) -> int:
        return max((d for _, d in self._all_nest_depths()), default=-1) + 1

    def _apply_foldlevel(self) -> None:
        """Recompute `self._expanded` wholesale from `self._foldlevel`: a nest at depth `d`
        (0 = direct child of the current level) is open iff `d < self._foldlevel`. Overrides
        any prior manual `za`/`zA` state, same as vim's own foldlevel."""
        self._expanded = {p for p, d in self._all_nest_depths() if d < self._foldlevel}
        p = self.path
        if p is not None:
            self.cursor = self._cursor_for_path(p)
        self._load()

    def fold_open_all(self) -> None:
        """`zR`: open every fold under the current level, recursively (foldlevel = max)."""
        self._foldlevel = self._max_foldlevel()
        self._apply_foldlevel()

    def fold_close_all(self) -> None:
        """`zM`: close every fold under the current level (foldlevel = 0)."""
        self._foldlevel = 0
        self._apply_foldlevel()

    def fold_level_step(self, delta: int) -> None:
        """`zr`/`zm`: foldlevel +/- 1 (clamped to [0, max depth present])."""
        self._foldlevel = max(0, min(self._max_foldlevel(), self._foldlevel + delta))
        self._apply_foldlevel()

    def fold_next(self) -> None:
        """`zj`: cursor to the next fold start -- the next block (nest) row below, across the
        visible list (peeked rows included)."""
        vis = self.visible
        for i in range(self.cursor + 1, len(vis)):
            if self.doc.is_nest(vis[i][0]):
                self._new_at = None
                self._stash()
                self.cursor = i
                self._load()
                return

    def fold_prev_end(self) -> None:
        """`zk`: cursor to the previous fold end -- the last visible row of the previous
        block (vim semantics: skips the cursor's own enclosing fold, landing on a strictly
        earlier block's last shown line)."""
        vis = self.visible
        for i in range(self.cursor - 1, -1, -1):
            path = vis[i][0]
            if not self.doc.is_nest(path):
                continue
            j = i
            while j + 1 < len(vis) and len(vis[j + 1][0]) > len(path) and vis[j + 1][0][: len(path)] == path:
                j += 1
            if j < self.cursor:
                self._new_at = None
                self._stash()
                self.cursor = j
                self._load()
                return

    def enter_level(self, controls: bool = True) -> None:
        """Regular `→` = tree nav into the current node: peeked row -> zoom to its level; nest
        -> its child level; orca row -> open its live view. `controls=True` (widget fallback /
        leaf rows) also focuses a leaf's own `ComponentPanel`; the app passes `controls=False`
        so regular `→` never focuses controls -- that's ⇧→ (J 2026-10-12)."""
        p = self.path
        if p is None:
            return
        if self.cursor_peeked:
            self.zoom_to_peeked(p)
            return
        if self.doc.is_nest(p):
            self._stash()
            self.parent_path, self.cursor = p, 0
            self._load()
        elif is_orca_row(self.rows[p[-1]].src):
            self.open_orca(p)
        elif controls:
            self.focus_leaf_panel()

    def focus_leaf_panel(self) -> None:
        """`l`/`→` at end of a leaf row w/ no nest/orca to enter: focus its mounted
        `ComponentPanel`'s first interactive control (`NumberBox`/`TextualXYPad`) instead --
        no-op (same as before) off a row with no panel. Fast parameter tweaking w/o a mouse."""
        panel = self._current_component_panel()
        if panel is None:
            return
        controls = self._panel_focusables(panel)
        if controls:
            controls[0].focus()

    def focus_row_controls(self) -> bool:
        """`→` (J 2026-10-12: `→` = this row's own controls, `⇧→` = enter/drill into a block):
        focus the current row's inline panel -- a nest's `BlockPanel` (timestretch box) or a
        leaf's `ComponentPanel`/`TexPanel` first control. -> False (caller falls back to
        `enter_level`) off a peeked row or a row with no panel mounted."""
        if self.cursor_peeked:
            return False
        try:
            box = self.query_one(f"#box-rl-{self._depth0_index}", RowBox)
        except Exception:
            return False
        panel = next((c for c in box.children
                      if type(c).__name__ in ("BlockPanel", "ComponentPanel", "TexPanel")), None)
        if panel is None:
            return False
        controls = self._panel_focusables(panel)
        if not controls:
            return False
        controls[0].focus()
        return True

    def focus_line_normal(self) -> None:
        """`h`/`←`/`Escape` inside a leaf panel control (`ComponentPanel.action_blur_panel`):
        blur it and return focus to this row's own edit line, forced NORMAL (mirrors `exit_level`'s
        own mode -- a panel control is "inside" the row, not a sibling level)."""
        self.line.mode = Mode.NORMAL
        self.line.focus()

    def _current_component_panel(self) -> Widget | None:
        """The `ComponentPanel` mounted right after the cursor row's own `Static` in `#rows`,
        if any -- None off a peeked row (read-only, fold-peek never offers panel focus) or a
        leaf row with no live panel mounted (`app.py`'s `_sync`/`_rehome`)."""
        if self.cursor_peeked:
            return None
        try:
            box = self.query_one(f"#box-rl-{self._depth0_index}", RowBox)
        except Exception:
            return None
        return next((c for c in box.children if type(c).__name__ in ("ComponentPanel", "TexPanel")), None)

    @staticmethod
    def _panel_focusables(panel: Widget) -> list[Widget]:
        """A panel's interactive controls in compose order (duck-typed on `can_focus`, not
        imported types -- `app.py` imports `columns.py`, not the other way around)."""
        return [w for w in panel.query("*") if getattr(w, "can_focus", False)]

    def focus_label(self, label: str) -> bool:
        """`asemic://` scheme handler's landing move (`app.py`'s `_do_jump`): zoom straight to
        the nest whose dotted `doc.breadcrumb()` joins to `label` ("root" = top level), cursor
        on its first row -- same move `zoom_to_peeked` makes, just addressed by label instead of
        a `RowPath` already in hand. -> False (no-op, caller reports "stale link") if no nest in
        the doc matches (renamed/deleted block since the link was made)."""
        if label == "root":
            target: RowPath | None = ()
        else:
            target = next(
                (p for p, _ in self.doc.walk()
                 if self.doc.is_nest(p) and self.doc.label(p) == label),
                None,
            )
        if target is None:
            return False
        self._push_jump()
        self._stash()
        self.parent_path, self.cursor = target, 0
        self._load()
        self.line.focus()
        return True

    # ------------------------------------------------------------ component links + jumplist
    # (nvim-style: every link jump records where it left from; ctrl+o back, ctrl+i forward)
    def comp_row(self, kind: str, ident: str) -> RowPath | None:
        """Doc path of the row that declares component `kind`/`ident` anywhere in the doc (same
        `row_anchor` match `anchor_widget` uses, just not limited to the current zoom level)."""
        want = anchor_id(kind, ident)
        for p, src in self.doc.walk():
            if want in (row_anchor(src, self.doc.label(p[:-1])), row_anchor(src)):
                return p
        return None

    def route_row(self, rid: str) -> RowPath | None:
        """Doc path of the `route(src, dst, ...)` row whose brain route id is `rid`: same
        route id = canonical resolved dst (verbs.rs), recomputed from the row source."""
        for p, src in self.doc.walk():
            call = bare_call(src, {"route"})
            if call is None or len(call[1]) < 2 or None in call[1][:2]:
                continue
            dst_arg = call[1][1]
            if dst_arg is not None and resolve_path(self.doc.label(p[:-1]), dst_arg) == rid:
                return p
        return None

    def goto_comp(self, kind: str, ident: str) -> bool:
        """Clicked `~ <source>` / backlink in a panel title (`app.py`'s `action_goto_comp`):
        zoom to that component's (or `kind == "route"`: route's) row, recording the jump.
        -> False if no row declares it."""
        p = self.route_row(ident) if kind == "route" else self.comp_row(kind, ident)
        if p is None:
            return False
        self._push_jump()
        self.zoom_to_peeked(p)
        self.line.focus()
        return True

    def _here(self) -> tuple[RowPath, int]:
        return (self.parent_path, self.cursor)

    def _push_jump(self) -> None:
        del self._jumps[self._jump_i:]
        self._jumps.append(self._here())
        self._jump_i = len(self._jumps)

    def jump_history(self, step: int) -> bool:
        """ctrl+o (`step=-1`) / ctrl+i (`step=1`) through the jumplist; entries whose level no
        longer exists (block deleted/renamed since) are skipped. -> False at either end."""
        if step < 0 and self._jump_i == len(self._jumps):
            self._jumps.append(self._here())  # so ctrl+i can come back here
        i = self._jump_i + step
        while 0 <= i < len(self._jumps):
            pp, cur = self._jumps[i]
            try:
                ok = pp == () or self.doc.is_nest(pp)
            except Exception:  # noqa: BLE001 - stale path into an edited doc
                ok = False
            if ok:
                self._jump_i = i
                self._stash()
                self.parent_path, self.cursor = pp, cur
                try:
                    self._load()
                except IndexError:  # level shrank since: land on its first row
                    self.cursor = 0
                    self._load()
                self.line.focus()
                return True
            i += step
        return False

    def zoom_to_peeked(self, p: RowPath) -> None:
        """`→`/`l` on a peeked row: jump straight to that row's own level, cursor on it --
        fast deep navigation, the point of fold-peek -- rather than entering *into* it like
        `l` on a current-level nest row does."""
        self._stash()
        self.parent_path = p[:-1]
        self.cursor = self._cursor_for_row(p[-1])
        self._load()

    # ------------------------------------------------------------ orca regions (plan §3;
    # feedback-adapter-viewers): ONE orca process (adapter-started tmux session, per the manifest's [view]);
    # every orca row anywhere in the doc gets its own rectangle (region) of that single shared
    # grid (orca_literal.layout_grids, depth-first `doc.walk()` order). Python only ever
    # reads/writes the adapter's grid file + tmux-samples the pane; it never starts/stops orca.
    def _orca_entries(self) -> list[tuple[RowPath, str]]:
        out = []
        for p, src in self.doc.walk():
            if is_orca_row(src) and (grid := grid_from_src(src)) is not None:
                out.append((p, grid))
        return out

    def _reseed_orca(self) -> None:
        """Doc's orca rows -> recomposed shared grid; written to the adapter's grid file only
        when it actually changed (this seeds the NEXT orca start; orca doesn't live-reload)."""
        if not self._orca_composed and not any(is_orca_row(src) for _, src in self.doc.walk()):
            return
        entries = self._orca_entries()
        composed, self._orca_layout = layout_grids(entries)
        if composed != self._orca_composed:
            self._orca_composed = composed
            if (grid_file := self._orca_grid_file) is not None:
                grid_file.write_text(composed + "\n")

    def open_orca(self, path: RowPath) -> None:
        """→ (caret at end) on an orca row: attach to the one orca process the adapter's
        `[lifecycle] start` already launched (tmux session from the manifest's `[view]`,
        adapters/orca/adapter.toml) — this view never starts/stops that process, just views it
        (the whole shared grid, every row's region at once; orca's own cursor moves freely
        across them)."""
        if self._orca_path is not None:
            return
        if self._orca_view is None:
            self.notify("orca adapter not running", severity="error")
            return
        session = self._orca_session
        if session is None:
            self.notify("orca adapter not running", severity="error")
            return
        has_session = subprocess.run(
            ["tmux", "has-session", "-t", session], capture_output=True
        ).returncode == 0
        if not has_session:
            self.notify("orca adapter not running: play its block('orca')", severity="error")
            return
        lines = self._orca_composed.split("\n")
        ncol = max((len(l) for l in lines), default=0) + 2
        nrow = len(lines) + _ORCA_CHROME_ROWS
        self._orca_path = path
        grid_file = self._orca_grid_file
        try:
            self._orca_mtime = grid_file.stat().st_mtime if grid_file is not None else None
        except FileNotFoundError:
            self._orca_mtime = None
        term = PtyTerminal(
            command=shlex.split(self._orca_view["attach"]),
            ncol=max(ncol, _ORCA_MIN_COLS), nrow=min(nrow, _ORCA_MAX_ROWS), id="orca-term",
        )
        self.mount(term, after=self.query_one("#rows"))
        self._orca_poll = self.set_interval(0.5, self._poll_orca)

    def _poll_orca(self) -> None:
        if self._orca_path is None or self._orca_grid_file is None:
            return
        try:
            m = self._orca_grid_file.stat().st_mtime
        except FileNotFoundError:
            return
        if m != self._orca_mtime:
            self._orca_mtime = m
            self._stage_orca_grid()

    def _stage_orca_grid(self) -> None:
        """An in-orca Ctrl+S (or exit): split the shared grid file by the current layout and
        stage each region whose text actually changed back into its row (point 4)."""
        if self._orca_path is None or self._orca_grid_file is None:
            return
        try:
            composed = self._orca_grid_file.read_text().rstrip("\n")
        except FileNotFoundError:
            return
        by_path = split_grid(composed, self._orca_layout)
        for path, grid in by_path.items():
            row = next((r for r in self.doc.rows(path[:-1]) if r.path == path), None)
            if row is None:  # row vanished from under us (e.g. an external edit)
                continue
            cur = grid_from_src(row.src)
            if cur == grid:
                continue
            new_src = replace_grid(row.src, grid)
            if self.doc.stage(path, new_src) is None:
                self.post_message(self.Committed(path))

    def on_pty_terminal_exited(self, ev: PtyTerminal.Exited) -> None:
        """Pty exit here = `tmux attach` client exiting, i.e. detach — orca itself (the tmux
        session) keeps running; only the adapter's own `[lifecycle] stop` kills it."""
        self._stage_orca_grid()
        if self._orca_poll is not None:
            self._orca_poll.stop()
            self._orca_poll = None
        self._orca_path = self._orca_mtime = None
        ev.terminal.remove()
        self._load()
        self.line.focus()

    def _sample_orca(self) -> None:
        """Inline subcanvases (point 3): ~0.2s tmux sample, shared by every orca row's render.
        No-op unless an orca row is at the current level, and `refresh_rows` only on a changed
        sample -- else 3 blocking tmux spawns + a full row re-render 5x/s at idle (profiled)."""
        if not any(r.name is None and is_orca_row(r.src) for r in self.rows):
            return
        if self._orca_view is None:
            self._fetch_orca_view()  # brain may have come up since the last attempt
        session = self._orca_session
        has_session = session is not None and subprocess.run(
            ["tmux", "has-session", "-t", session], capture_output=True
        ).returncode == 0
        if not has_session:
            if self._orca_capture is not None:
                self._orca_capture = self._orca_pane_size = None
                self.refresh_rows()
            return
        cap = subprocess.run(["tmux", "capture-pane", "-p", "-e", "-t", session], capture_output=True, text=True)
        size = subprocess.run(
            ["tmux", "display-message", "-p", "-t", session, "-F", "#{pane_width}x#{pane_height}"],
            capture_output=True, text=True,
        )
        try:
            w, h = size.stdout.strip().split("x")
            pane_size = (int(w), int(h))
        except ValueError:
            pane_size = None
        if (cap.stdout, pane_size) == (self._orca_capture, self._orca_pane_size):
            return
        self._orca_capture, self._orca_pane_size = cap.stdout, pane_size
        self.refresh_rows()

    def _orca_subcanvas_lines(self, path: RowPath, grid: str) -> list[Text]:
        """Rendered lines for 1 orca row: a live crop of the shared tmux pane if the orca session
        is up, else the row's own (dimmed) grid + a hint that the adapter isn't running."""
        if self._orca_capture is None or self._orca_pane_size is None:
            out = [Text(l, style="dim") for l in grid.split("\n")]
            out.append(Text("  orca adapter not running", style="dim italic"))
            return out
        rect = self._orca_layout.get(path)
        if rect is None:
            return [Text(l, style="dim") for l in grid.split("\n")]
        composed_lines = self._orca_composed.split("\n")
        grid_w = max((len(l) for l in composed_lines), default=0)
        grid_h = len(composed_lines)
        ncol, nrow = self._orca_pane_size
        pane_lines, col, w = crop_capture(self._orca_capture, rect, ncol, nrow, grid_w, grid_h)
        out = []
        for l in pane_lines:
            t = Text.from_ansi(l)
            out.append(t[col : col + w] if len(t) >= col else Text(" " * w))
        return out

    def enter_or_create_nest(self, name: str) -> None:
        """`/block NAME`: enter an existing sibling nest named `name`, else commit a new one then enter it."""
        for i, r in enumerate(self.rows):
            if r.name == name:
                self._stash()
                self.cursor = self._cursor_for_row(i)
                self.enter_level()
                return
        try:
            p = self.doc.insert(self.parent_path, self._depth0_index, f'with block("{name}"):')
        except Exception as e:  # noqa: BLE001 - parse error: report, don't enter
            self.notify(str(e).split("\n", 1)[0], severity="error")
            return
        self.post_message(self.Committed(p))
        self.cursor = self._cursor_for_row(p[-1])
        self._load()  # edit line := new header, else enter_level's stash writes the old row over it
        self.enter_level()

    def insert_call(self, text: str) -> RowPath | None:
        """Insert `text` as a new row at the cursor (current block) and commit it -- same move
        `/orca` makes (`insert_orca` below), reused by the `/adapters` panel's Enter-to-insert
        (`AdaptersPanel.on_option_list_option_selected` in `app.py`). None (+ notify) on a
        parse error; the slot is left untouched."""
        try:
            p = self.doc.insert(self.parent_path, self._depth0_index, text)
        except Exception as e:  # noqa: BLE001 - parse error: report, don't insert
            self.notify(str(e).split("\n", 1)[0], severity="error")
            return None
        self.post_message(self.Committed(p))
        self.cursor = self._cursor_for_row(p[-1] + 1)
        self._load()
        return p

    def insert_orca(self) -> None:
        """`/orca`: insert an `orca(<triple-quoted grid>)` row at the cursor, default 8x4 dots."""
        self.insert_call(f'orca("""\n{DEFAULT_ORCA_GRID}\n""")')

    def exit_level(self) -> None:
        if not self.parent_path:
            return
        self._stash()
        idx = self.parent_path[-1]
        self.parent_path = self.parent_path[:-1]
        self.cursor = self._cursor_for_row(idx)
        self._load()

    def action_drop(self) -> None:
        """Esc, row/doc-level only: the library owns INSERT->NORMAL (+ stash, triggered from
        `RowVimTextArea._on_key`) and cancelling a pending NORMAL count/operator/`g` itself.
        This only covers what the library can't know about: a pending `/`/`?` search line, or
        a pending `o`/`O` slot. Mostly a fallback -- `RowVimTextArea` calls this directly for
        both cases since the library swallows Escape before this Binding would ever see it."""
        if self._input_purpose is not None:
            self._input_purpose = None
            self._load()
            return
        if self._new_at is not None:
            self._new_at = None
            self.cursor = min(self.cursor, len(self.visible))
            self.line.mode = Mode.NORMAL
            self._load()

    # ------------------------------------------------------------ row/doc-level vim commands
    # (called from `RowVimTextArea`'s interception of dd/yy/p/o/O/j/k/gg/G/h/l-at-edge/%/
    # search/ctrl+g/u/ctrl+r/U -- everything the library can't do because it only ever sees 1
    # row's own text, never the tree of rows around it.)
    def enter_new_row(self, below: bool) -> None:
        """`o`/`O`: blank NORMAL->INSERT slot below/above the cursor row; commits as a real
        row only on Enter (`_submit_text`'s `_new_at` branch), mirroring the trailing
        new-row slot's own insert-on-submit design (DRY). No-ops w/ a hint on a peeked row
        (fold-peek: read-only, zoom in to edit)."""
        if self._guard_edit():
            return
        depth0 = self._depth0_index
        idx = depth0 + 1 if (below and self.path is not None) else depth0
        self._stash()
        self._new_at = idx
        self.cursor = self._cursor_for_row(min(idx, len(self.rows)))
        self.line.text = self._loaded = ""
        self.line.cursor_location = (0, 0)
        self.line.mode = Mode.INSERT
        self.refresh_rows()

    def replace_char(self, ch: str) -> None:
        """`r`: replace the char under the caret, stay NORMAL (the library has no `r`). No-op
        on a peeked row (read-only)."""
        if self._guard_edit():
            return
        row, col = self.line.cursor_location
        s = str(self.line.get_line(row))
        if col >= len(s) or len(ch) != 1:
            return
        self.line.delete((row, col), (row, col + 1))
        self.line.insert(ch, location=(row, col))
        self.line.cursor_location = (row, col)

    def row_op_line(self, op: str, count: int = 1) -> None:
        """dd/yy (+ counts): `count` whole rows from the cursor down (the library's own
        dd/yy just clear this 1 row's text -- this is the document-row op instead). Guarded
        off of peeked rows (read-only fold-peek)."""
        if self._guard_edit():
            return
        p = self.path
        if p is None:
            return
        rows = self.rows
        lo = p[-1]
        hi = min(lo + count, len(rows))
        span = rows[lo:hi]
        if not span:
            return
        # linewise register = the list of row texts (never joined into 1 blob: each row
        # may itself be multi-line, e.g. an orca grid, and `p`/`P` reinsert them 1 row each).
        self._row_register = [r.src for r in span]
        if op == "y":
            return
        parent = p[:-1]
        labels = [l for r in span if r.name is not None for l in self._subtree_labels(r.path)]
        for _ in span:
            self.doc.delete((*parent, lo))
        self._undo.append(("del", parent, lo, [r.src for r in span]))
        self._redo.clear()
        self.cursor = self._cursor_for_row(min(lo, len(self.rows)))
        self._load()
        if labels:
            self.post_message(self.Deleted(labels))

    def row_put(self, after: bool, count: int = 1) -> None:
        """`p`/`P` (+ counts): reinsert the last dd/yy'd rows below/above the cursor. Guarded
        off of peeked rows (read-only fold-peek)."""
        if self._guard_edit():
            return
        if self._row_register is None:
            return
        idx = self._depth0_index + (1 if after else 0)
        parent = self.parent_path
        texts = list(self._row_register) * count
        p = None
        try:
            for offset, t in enumerate(texts):
                p = self.doc.insert(parent, idx + offset, t)
        except Exception as e:  # noqa: BLE001 - parse error: report, don't insert
            self.notify(str(e).split("\n", 1)[0], severity="error")
            return
        self._undo.append(("ins", parent, idx, texts))
        self._redo.clear()
        self.post_message(self.Committed(p))
        self.cursor = self._cursor_for_row(idx)
        self._load()

    # ------------------------------------------------------------ fold/block ops (zf/zd/zD/[z/]z
    # -- 2026-10-11 design: "fold" = tree block, mapped onto libcst via `Doc`. `?` = this corner
    # of the spec is thinner than the rest (no dedicated undo-journal entries yet, no prompt for
    # the new block's name -- see class docstring note below each method).
    def fold_wrap_rows(self, span: int, name: str = "block") -> None:
        """`zf{motion}` (j/k -> `span`=2; a count/`G`/`gg` -> `span` = however many rows):
        wrap `span` rows starting at the cursor's current-level row into a new
        `with block("<name>"):`, re-indented as that block's children (DRY: the same
        `Doc.insert`/`Doc.source` the rest of this class already uses for every other row
        write -- no separate libcst pass of its own).

        `?` No slash/cmd hook wired up yet for naming the block (spec: "prompt for it via the
        existing slash/cmd input if there's an easy hook, else default it and note that") --
        this always defaults to "block"; a caller can still rename after (`r`-rename isn't a
        thing here, but `/block NAME` immediately after `zf` reuses the existing nest-entry
        path to rename by re-staging the header). No undo-journal entry yet either (`_undo`
        only knows single-row edits/inserts/deletes, not this 1-op/many-rows transform)."""
        if self._guard_edit():
            return
        parent = self.parent_path
        rows = self.rows
        lo = self._depth0_index
        if lo is None:
            return
        hi = min(lo + max(1, span), len(rows))
        if hi - lo < 1:
            return
        texts = [self.doc.source(r.path) for r in rows[lo:hi]]
        for i in range(hi - 1, lo - 1, -1):
            self.doc.delete((*parent, i))
        try:
            p = self.doc.insert(parent, lo, f'with block("{name}"):')
        except Exception as e:  # noqa: BLE001 - parse error: bail, nothing's been lost (texts still exist)
            for offset, t in enumerate(texts):
                self.doc.insert(parent, lo + offset, t)
            self.notify(str(e).split("\n", 1)[0], severity="error")
            return
        for offset, t in enumerate(texts):
            self.doc.insert(p, 1 + offset, t)  # after the placeholder `pass` (index 0)
        self.doc.delete((*p, 0))  # drop that placeholder now there are real children
        self.post_message(self.Committed(p))
        self.cursor = self._cursor_for_row(lo)
        self._load()

    def fold_unwrap_block(self, recursive: bool = False) -> None:
        """`zd`/`zD`: the block containing the cursor (the row itself, if it's a nest header,
        else the block it's inside) is unwrapped -- its children spliced into the parent at
        its old position, 1 level dedented. `zD` repeats this on any nest that was itself a
        child (full flatten); `zd` only the 1 level."""
        if self._guard_edit():
            return
        path = self.path
        target = path if (path is not None and self.doc.is_nest(path)) else (self.parent_path or None)
        if not target:
            self.notify("not inside a block", severity="warning")
            return
        if recursive:
            self._unwrap_recursive(target)
        else:
            self._unwrap_once(target)
        self.cursor = self._cursor_for_row(target[-1])
        self._load()

    def _unwrap_once(self, path: RowPath) -> RowPath:
        """1 nest -> its children spliced in at its old position. -> that position's path
        (so `_unwrap_recursive` can re-examine what landed there)."""
        parent, idx = path[:-1], path[-1]
        texts = [self.doc.source(c.path) for c in self.doc.rows(path)]
        self.doc.delete(path)
        for offset, t in enumerate(texts):
            self.doc.insert(parent, idx + offset, t)
        return (*parent, idx)

    def _unwrap_recursive(self, path: RowPath) -> None:
        """`?` bounded worklist flatten: unwrap, then re-check every row that landed in its
        place (now at the same depth as the thing we just removed) for still being a nest,
        and unwrap those too -- until nothing left in that span is a nest."""
        stack = [path]
        while stack:
            p = stack.pop()
            parent, idx = p[:-1], p[-1]
            n_children = len(self.doc.rows(p))
            self._unwrap_once(p)
            for k in range(idx, idx + n_children):
                cp = (*parent, k)
                if self.doc._exists(cp) and self.doc.is_nest(cp):
                    stack.append(cp)

    def jump_block_start(self) -> None:
        """`[z`: first row of the current block (current level)."""
        self.action_goto(1)

    def jump_block_end(self) -> None:
        """`]z`: last row of the current block (current level)."""
        self.action_goto(len(self.rows))

    def _commit_current(self, new_text: str) -> None:
        if self._guard_edit():
            return
        p = self.path
        if p is None:
            return
        before = self._text_for(p)
        if new_text == before:
            return
        err = self.doc.stage(p, new_text)
        if err is None:
            self._undo.append(("edit", p, before, new_text))
            self._redo.clear()
            self.post_message(self.Committed(p))
        self._load()

    def _apply_journal(self, entry: tuple, reverse: bool) -> RowPath | None:
        """Apply one undo-journal entry (or its inverse on redo). -> row path touched, if any."""
        kind = entry[0]
        if kind == "edit":
            _, path, before, after = entry
            text = before if reverse else after
            return path if self.doc.stage(path, text) is None else None
        parent, index, texts = entry[1], entry[2], entry[3]
        inserting = (kind == "del") == reverse  # undoing a del, or redoing an ins, = (re)insert
        if inserting:
            p = None
            for offset, t in enumerate(texts):
                p = self.doc.insert(parent, index + offset, t)
            self.cursor = self._cursor_for_row(index) if parent == self.parent_path else self.cursor
            return p
        else:
            for _ in texts:
                self.doc.delete((*parent, index))
            self.cursor = self._cursor_for_row(min(index, len(self.rows))) if parent == self.parent_path else self.cursor
            return parent  # a nest path; the row(s) at index are gone

    def _history(self, undo: bool) -> None:
        """u / ctrl+r: whole-tree snapshot step (`Doc.undo`/`redo`); commits the open row first
        so its pending edit is itself 1 step. Re-evals the current level after."""
        self._stash()
        if not (self.doc.undo() if undo else self.doc.redo()):
            self.notify("already at oldest change" if undo else "already at newest change")
            return
        while self.parent_path and not self.doc.is_nest(self.parent_path):
            self.parent_path = self.parent_path[:-1]
        self.cursor = min(self.cursor, len(self.visible))
        self.new_draft = ""
        if (p := self.path) is not None:
            self.post_message(self.Committed(p))
        self._load()

    def action_undo(self) -> None:
        self._history(undo=True)

    def action_undo_line(self) -> None:
        """`U`: revert the current row to the earliest state recorded this session.
        ? simplified vs real per-line vim undo (one flat stack, not a full undo tree);
        only covers in-place text edits (row add/remove undo is `u`'s job, per-row below)."""
        p = self.path
        if p is None:
            return
        baseline, kept = None, []
        for e in self._undo:
            if e[0] == "edit" and e[1] == p and baseline is None:
                baseline = e[2]
            elif not (e[0] == "edit" and e[1] == p):
                kept.append(e)
        self._undo = kept
        if baseline is not None and self.doc.stage(p, baseline) is None:
            self.post_message(self.Committed(p))
            self._load()

    def action_redo(self) -> None:
        self._history(undo=False)

    def enter_search(self, prefix: str, direction: int = 1) -> None:
        """`/`/`?` (the library has neither): a bare editable line reusing `self.line` itself
        (its own COMMAND mode is reserved for `:`), terminated on Enter via `handle_search_key`."""
        self._input_purpose = "search"
        self._search_pending_dir = direction
        self.line.text = self._loaded = prefix
        self.line.cursor_location = (0, len(prefix))
        self.line.mode = Mode.INSERT
        self.refresh_rows()

    def handle_search_key(self, event: events.Key) -> None:
        """Called by `RowVimTextArea._on_key` while `_input_purpose == "search"`. Enter runs
        the search; Escape cancels (`action_drop` already handles that branch)."""
        if event.key == "enter":
            self._run_search(self.line.text)
        elif event.key == "escape":
            self.action_drop()

    def _run_search(self, text: str) -> None:
        pat = text[1:] if text[:1] in ("/", "?") else text
        direction = self._search_pending_dir
        self._input_purpose = None
        self.line.mode = Mode.NORMAL
        if pat:
            self._search, self._search_dir = pat, direction
        self._jump_search(self._search, direction)

    def _jump_search(self, pattern: str, direction: int) -> None:
        """Substring search over the whole tree (depth-first), jumping into nests."""
        if not pattern:
            self._load()
            return
        flat = self.doc.walk()
        if not flat:
            self._load()
            return
        cur = self.path
        idx = next((i for i, (p, _) in enumerate(flat) if p == cur), len(flat) - 1)
        n = len(flat)
        order = range(1, n + 1) if direction > 0 else range(-1, -(n + 1), -1)
        for off in order:
            p, src = flat[(idx + off) % n]
            if pattern in src:
                self.parent_path = p[:-1]
                self.cursor = self._cursor_for_row(p[-1])
                self._load()
                return
        self.notify(f"no match: {pattern}", severity="warning")
        self._load()

    def repeat_search(self, reverse: bool) -> None:
        if not self._search:
            return
        self._jump_search(self._search, self._search_dir * (-1 if reverse else 1))

    def show_location(self) -> None:
        crumb = "/".join(display_path(name) for name in ["root", *self.doc.breadcrumb(self.parent_path)])
        if self.cursor_peeked:
            self.notify(f"{crumb}  peeked row (zoom in to see its own position)")
        else:
            self.notify(f"{crumb}  row {self._depth0_index + 1}/{len(self.rows)}")

    def jump_match_bracket(self) -> None:
        """`%`: nearest bracket at/after the caret on this row -> its match."""
        row, col = self.line.cursor_location
        s = str(self.line.get_line(row))
        j = next((k for k in range(col, len(s)) if s[k] in _BRACKETS or s[k] in _BRACKETS_REV), None)
        if j is None:
            return
        ch = s[j]
        forward = ch in _BRACKETS
        target = _BRACKETS[ch] if forward else _BRACKETS_REV[ch]
        step, depth, k = (1 if forward else -1), 0, j
        while 0 <= k < len(s):
            if s[k] == ch:
                depth += 1
            elif s[k] == target:
                depth -= 1
                if depth == 0:
                    self.line.cursor_location = (row, k)
                    return
            k += step

    def on_vim_text_area_command_entered(self, ev: VimTextArea.CommandEntered) -> None:
        """Any `:` command the library doesn't itself handle (not `:w`/`:q`/`:wq`, which post
        `SaveRequested`/`QuitRequested` instead, handled below): `:s/old/new/[g]`, else reused
        as `/verb args` (DRY: same slash dispatch `_submit_text` already gives the editable line)."""
        ev.stop()
        body = ev.command.strip()
        if body.startswith("s/") or body.startswith("s,"):
            self._ex_substitute(body)
            self._load()
            return
        self._submit_text("/" + body)

    def on_vim_text_area_save_requested(self, ev: VimTextArea.SaveRequested) -> None:
        ev.stop()
        self._stash()
        self.notify("saved")
        self._load()

    def on_vim_text_area_quit_requested(self, ev: VimTextArea.QuitRequested) -> None:
        ev.stop()
        self._stash()
        quit_action = getattr(self.app, "action_quit", None)
        if quit_action is not None:
            quit_action()

    def on_vim_text_area_mode_changed(self, ev: VimTextArea.ModeChanged) -> None:
        ev.stop()
        self.refresh_rows()

    def on_vim_text_area_status_changed(self, ev: VimTextArea.StatusChanged) -> None:
        ev.stop()
        self.refresh_rows()

    def _ex_substitute(self, body: str) -> None:
        parts = body.split(body[1])  # "s/old/new/g" -> split on the chosen delimiter
        if len(parts) < 3:
            self.notify("usage: :s/old/new/[g]", severity="error")
            return
        old, new = parts[1], parts[2]
        flags = parts[3] if len(parts) > 3 else ""
        cur = self.line.text
        new_text = cur.replace(old, new) if "g" in flags else cur.replace(old, new, 1)
        if new_text != cur:
            self._commit_current(new_text)

    def _subtree_labels(self, path: RowPath) -> list[str]:
        """`path` (a nest) + every nested nest under it, as eval labels."""
        labels = [self.doc.label(path)]
        labels += [self.doc.label(p) for p, _ in self.doc.walk(path) if self.doc.is_nest(p)]
        return labels

    def action_delete_row(self) -> None:
        if self._guard_edit():
            return
        if (p := self.path) is not None:
            labels = self._subtree_labels(p) if self.doc.is_nest(p) else []
            src = self.rows[p[-1]].src
            self.doc.delete(p)
            self._undo.append(("del", p[:-1], p[-1], [src]))
            self._redo.clear()
            self.cursor = self._cursor_for_row(min(p[-1], len(self.rows)))
            self._load()
            if labels:
                self.post_message(self.Deleted(labels))

    def run_command(self, text: str) -> None:
        """`CmdBar` line (`/verb args`): local verbs act; brain verbs append their call as a row."""
        parsed = parse_slash(text)
        name = parsed[0] if parsed is not None else ""
        if name in LOCAL_COMMAND_NAMES:
            if name == "block" and parsed[1]:
                self.enter_or_create_nest(parsed[1][0])
            elif name == "orca":
                self.insert_orca()
            elif name in _OPEN_VERBS and parsed[1]:
                if not self.focus_label(parsed[1][0]):
                    self.open_file(Path(parsed[1][0]))
            else:
                self.post_message(self.Command(name, parsed[1]))
            return
        call = slash_to_call(text) if name in {c["verb"] for c in self.commands} else None
        if call is None:
            self.notify(f"unknown command: :{name}", severity="error")
            return
        try:
            p = self.doc.insert(self.parent_path, len(self.rows), call[1])
        except Exception as e:  # noqa: BLE001
            self.notify(str(e).split("\n", 1)[0], severity="error")
            return
        self.post_message(self.Committed(p))
        self._load()

    def _submit_text(self, text: str) -> None:
        if self.cursor_peeked and self._new_at is None:
            self.notify("zoom in to edit", severity="warning")
            self._load()
            return
        if self._new_at is not None:
            idx = self._new_at
            if not text.strip():
                self._new_at = None
                self.cursor = min(self.cursor, len(self.visible))
                self.line.mode = Mode.NORMAL
                self._load()
                return
            try:
                p = self.doc.insert(self.parent_path, idx, text)
            except Exception as e:  # noqa: BLE001 - parse error: keep editing the slot
                self.notify(str(e).split("\n", 1)[0], severity="error")
                return
            self._new_at = None
            self._undo.append(("ins", self.parent_path, idx, [text]))
            self._redo.clear()
            self.post_message(self.Committed(p))
            self.cursor = self._cursor_for_row(p[-1])
            self.line.mode = Mode.NORMAL
            self._load()
            return
        p = self.path
        if p is None:
            if not text.strip():
                return
            try:
                p = self.doc.insert(self.parent_path, len(self.rows), text)
            except Exception as e:  # noqa: BLE001 - parse error: keep in slot
                self.new_draft = text
                self.notify(str(e).split("\n", 1)[0], severity="error")
                return
            self.new_draft = ""
            self.cursor = self._cursor_for_row(len(self.rows))  # stay on the new-row prompt, REPL style
        elif (err := self.doc.stage(p, text)) is not None:
            self.notify(err, severity="error")
            self.refresh_rows()
            return
        self.post_message(self.Committed(p))
        self._load()

    def on_button_pressed(self, ev: Button.Pressed) -> None:
        ev.stop()
        if ev.button.id == "reparse":
            self.reparse()
        else:
            self.doc.misplaced, self._anchor = [], None
            self.query_one("#toast").remove_class("shown")

    def reparse(self) -> None:
        """Re-key drafts + cursor onto rows matching their pre-edit text."""
        editing = self.line.text != self._loaded
        self.doc.relocate()
        if self._anchor and self._anchor[0] is not None and (p := self.doc.find(*self._anchor)) is not None:
            self.parent_path = p[:-1]
            self.cursor = self._cursor_for_row(p[-1])
        self._anchor = None
        self.query_one("#toast").remove_class("shown")
        if editing:
            self.refresh_rows()
        else:
            self._load()
        self.line.focus()

    # ------------------------------------------------------------ render
    def anchor_widget(self, kind: str, ident: str) -> Widget | None:
        """The currently-mounted row Static (if any) that `kind`/`ident`'s panel belongs right
        after -- None if that row isn't visible at the current zoom level (app.py then hides
        that panel instead of mounting it floating at the bottom).

        `anchor_id -> row index` is cached on `(doc.version, parent_path)` -- rebuilt only when
        the doc mutates or zoom changes, not on every call (every component/tex panel calls this
        every tick otherwise)."""
        key = (id(self.doc), self.doc.version, self.parent_path)
        if self._anchor_map_key != key:
            parent_label = self.doc.label(self.parent_path)
            amap: dict[str, int] = {}
            for i, r in enumerate(self.rows):
                for a in (row_anchor(r.src, parent_label), row_anchor(r.src)):
                    if a is not None:
                        amap.setdefault(a, i)
            self._anchor_map, self._anchor_map_key = amap, key
        i = self._anchor_map.get(anchor_id(kind, ident))
        if i is None:
            return None
        try:
            return self.query_one(f"#box-rl-{i}", RowBox)
        except Exception:
            return None

    def row_box(self, index: int) -> Widget | None:
        """The currently-mounted `RowBox` for current-level row `index` (`#box-rl-{index}`),
        else None -- `app.py` mounts each block's own preview panel (timestretch number)
        into its nest row's box, mirroring `anchor_widget` for component panels."""
        try:
            return self.query_one(f"#box-rl-{index}", RowBox)
        except Exception:
            return None

    def _crumb_text(self, mode_tag: str) -> Text:
        """`mode_tag  root › a › b` -- each `root`/level segment an OSC 8 link to the
        `asemic://open?file=...&label=...` placeholder (Ghostty part A; the scheme's
        actual macOS handler is a later task -- `asemic_uri()` is the one call site
        it will replace). No-op (plain `Text`) when links are off or the doc has no
        backing file (`self.doc.path` is None, e.g. an unsaved buffer)."""
        names = ["root", *self.doc.breadcrumb(self.parent_path)]
        out = Text(f"{mode_tag}  ", no_wrap=True, overflow="ellipsis")
        for i, name in enumerate(names):
            if i:
                out.append(" › ")
            if self.doc.path is not None:
                label = "/".join(n for n in names[1 : i + 1]) or "root"
                out.append_text(link_text(display_path(name), asemic_uri(self.doc.path, label)))
            else:
                out.append(display_path(name))
        return out

    def on_nvim_row_editor_cmdline_changed(self, ev) -> None:
        ev.stop()
        self.refresh_crumb()

    _QUICKHELP = {
        "NORMAL": "↑↓ rows  → enter  ← out  tab/⇧→ controls  ⇧← back  o new  dd del  yy/p yank/put  zR/zM folds  : cmd  :help",
        "INSERT": "esc normal  enter commit  esc+: cmd",
        "CMD": "tab complete  ↑/↓ pick  enter run  esc cancel",
    }

    def refresh_crumb(self) -> None:
        mode_tag = self.line.status_text if self._input_purpose is None else "-- SEARCH --"
        bar = self.query("#cmdbar")
        key = "CMD" if bar and bar.first().has_class("shown") else "INSERT" if "INSERT" in mode_tag else "NORMAL"
        self.query_one("#quickhelp", Static).update(Text(self._QUICKHELP[key], style="dim"))
        self.refresh_manhelp()
        crumb = self._crumb_text(mode_tag)
        if self.doc.file_error:
            crumb.append(f"  ✗ file: {self.doc.file_error}")
        self.query_one("#crumb", Static).update(crumb)

    def refresh_manhelp(self) -> None:
        """QUICKHELP buffer at the bottom: man page of the picked row's call."""
        name = called(self.line.text, self.ns)
        box = self.query_one("#manhelp")
        box.set_class(name is not None and callable(self.ns.get(name)), "shown")
        if box.has_class("shown"):
            self.query_one("#manhelp-text", Static).update(manpage(name, self.ns[name]))

    def refresh_rows(self) -> None:
        self._reseed_orca()
        self.refresh_crumb()
        rows_w = self.query_one("#rows", VerticalScroll)
        existing = {w.id[4:]: w for w in rows_w.children if w.id and w.id.startswith("box-rl-")}
        used: set[str] = set()
        prev: Widget | None = None
        cursor_widget: Widget | None = None

        def place(rid: str, text: Text) -> Static:
            nonlocal prev
            used.add(rid)
            text.no_wrap, text.overflow = True, "ellipsis"
            box = existing.get(rid)
            if box is None:
                w = Static(text, id=rid, markup=False)
                box = RowBox(w, id=f"box-{rid}")
                if prev is None:
                    rows_w.mount(box, before=0) if rows_w.children else rows_w.mount(box)
                else:
                    rows_w.mount(box, after=prev)
                self._row_gen += 1
            else:
                w = box.line
                w.update(text)
            prev = box
            return w

        vis_index = 0  # position in the flat `visible` list (== cursor target), peeks included

        def render_peeked(parent: RowPath, depth: int) -> None:
            nonlocal vis_index, cursor_widget
            for r in self.doc.rows(parent):
                here = vis_index == self.cursor
                text = self._render_peek_row(r, depth, here)
                w = place("rl-peek-" + "-".join(map(str, r.path)), text)
                if here:
                    cursor_widget = w
                vis_index += 1
                if r.name is not None and r.path in self._expanded:
                    render_peeked(r.path, depth + 1)

        for i, r in enumerate(self.rows):
            here = vis_index == self.cursor
            text = self._render_row(r, here)
            if r.name is None and is_orca_row(r.src) and (grid := grid_from_src(r.src)) is not None:
                text = Text("\n").join([text, *self._orca_subcanvas_lines(r.path, grid)])
            w = place(f"rl-{i}", text)
            if here:
                cursor_widget = w
            if err := (r.error if r.draft is not None else None) or r.run_error:
                # error view under its row (J 2026-10-12: !status bar / !1-line suffix)
                place(f"rl-{i}-err", Text("\n").join(Text("    ✗ " + l if not n else "      " + l, style="red")
                                                      for n, l in enumerate(err.rstrip().splitlines()[-8:])))
            vis_index += 1
            if r.name is not None and r.path in self._expanded:
                render_peeked(r.path, 1)
        new_here = self.cursor == vis_index
        text = Text("› " if new_here else "  ", style="dim") + Text("…", style="dim")
        w = place("rl-new", text)
        if new_here:
            cursor_widget = w
        for rid, w in existing.items():
            if rid not in used:
                w.remove()
                self._row_gen += 1
        if (self._row_gen, self.parent_path) != getattr(self, "_rows_posted", None):
            self._rows_posted = (self._row_gen, self.parent_path)
            self.post_message(self.RowsChanged())
        if cursor_widget is not None:
            target = cursor_widget.parent if isinstance(cursor_widget.parent, RowBox) else cursor_widget
            target.scroll_visible(animate=False)  # minimal scroll: !jerk the cursor row to the top

    @staticmethod
    def _row_label(r: Row) -> str:
        """1st line of a row's src; a multi-line literal (e.g. an orca grid) also gets a
        ``▦ WxH``/line-count gloss so it reads as something, not just a dangling triple-quote."""
        first, _, rest = r.src.partition("\n")
        if not rest:
            return first
        lines = rest.rstrip("\n").split("\n")
        body = lines[:-1] if first.lstrip().startswith("orca(") else lines  # drop the closing `""")`
        if body and first.lstrip().startswith("orca("):
            return f"{first}  ▦ {max((len(l) for l in body), default=0)}x{len(body)}"
        return f"{first}  ⋯ {len(lines) + 1} lines"

    @staticmethod
    def _render_row(r: Row, here: bool) -> Text:
        t = Text("› " if here else "  ", style="bold" if here else "")
        if r.draft is not None:
            t.append(r.draft, style="red")
            t.append("  ✗", style="dim red")
        else:
            t.append(BlockColumns._row_label(r), style="reverse" if here else "")
        if r.name is not None:
            t.append(f"  › ({r.n_children})", style="dim")
        if r.run_error:
            t.append("  ✗", style="red")
        return t

    @staticmethod
    def _render_peek_row(r: Row, depth: int, here: bool) -> Text:
        """A fold-peeked row: full width, no indent, `│ ` gutter per peek depth -- source text
        only, read-only (no component/param/tex/view panel; those mount at the zoomed-in
        level, as they do now)."""
        t = Text("› " if here else "  ", style="bold" if here else "")
        t.append("│ " * depth, style="dim")
        t.append(BlockColumns._row_label(r), style="reverse" if here else "dim")
        if r.name is not None:
            t.append(f"  › ({r.n_children})", style="dim")
        return t

    def on_resize(self, _: events.Resize) -> None:
        self.refresh_rows()
