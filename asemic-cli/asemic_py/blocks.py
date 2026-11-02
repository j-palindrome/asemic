"""Block tree over a livecode `.py` file (libcst, lossless).

Every statement = 1 row. `with block("name"):` = a nest row whose body is the child column.
Rows are addressed by path = tuple of indices from the module body down.
Edits go to a per-row draft buffer and are written back only once they parse,
so the file never holds broken Python.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from pathlib import Path as FsPath
from typing import Callable, Sequence, TypeGuard

import libcst as cst

RowPath = tuple[int, ...]
_EMPTY = cst.Module(body=[])
LABEL_RE = re.compile(r"^\s*#\s*@([A-Za-z0-9_.-]+)\s*$")


@dataclass(frozen=True)
class Row:
    path: RowPath
    src: str  # statement text w/o leading comments; nest rows = header line only
    name: str | None  # block name if nest row
    n_children: int
    draft: str | None  # pending unparsed edit, if any
    error: str | None
    # last eval's exception on this row (Repl.run_nest)
    run_error: str | None = None
    # Effective timestretch (0.0=frozen/paused, 1.0=real-time, >1 faster, <0 reverse);
    # None = not a block row. The block-preview NumberBox reads/writes this (J 2026-10-12:
    # play/pause is a block's own number parameter, not a global row button).
    timestretch: float | None = None
    # Playback length in seconds (None = infinite); loop envelope name (None = inherit/default).
    # These + `timestretch` are the block's timing parameters (J 2026-10-13): the brain runs
    # each block's own playhead (`asemic/block/<label>.time`) from them.
    length: float | None = None
    loop: str | None = None


def is_with_block(node: cst.CSTNode) -> TypeGuard[cst.With]:
    """`with block("x"):` w/ indented body."""
    return (isinstance(node, cst.With) and
            isinstance(node.body, cst.IndentedBlock) and
            len(node.items) == 1)


def is_module(node: cst.CSTNode) -> TypeGuard[cst.Module]:
    return isinstance(node, cst.Module)


def block_name(node: cst.CSTNode) -> str | None:
    """`with block("x"):` w/ indented body -> "x"."""
    if not is_with_block(node):
        return None
    call = node.items[0].item
    if not (isinstance(call, cst.Call) and isinstance(call.func, cst.Name) and call.func.value == "block" and call.args):
        return None
    arg = call.args[0].value
    val = arg.evaluated_value if isinstance(arg, cst.SimpleString) else None
    return val


def row_call(node: cst.CSTNode) -> cst.Call | None:
    """The call a row is about: a nest's `block(...)`, else a leaf's `verb(...)` / `x = verb(...)`."""
    if is_with_block(node):
        item = node.items[0].item
        return item if isinstance(item, cst.Call) else None
    if isinstance(node, cst.SimpleStatementLine) and len(node.body) == 1:
        v = getattr(node.body[0], "value", None)
        return v if isinstance(v, cst.Call) else None
    return None


def row_timestretch(node: cst.CSTNode) -> float | None:
    """Own scope's timestretch: float value (0.0=frozen, 1.0=normal, None=inherit)."""
    call = row_call(node)
    for a in call.args if call else ():
        if a.keyword and a.keyword.value == "timestretch":
            v = a.value
            if isinstance(v, cst.Float):
                return v.evaluated_value
            if isinstance(v, cst.SimpleString):
                try:
                    return float(v.evaluated_value)
                except ValueError:
                    pass
    return None


def row_length(node: cst.CSTNode) -> float | None:
    """Own scope's `length=<seconds>` (None = not declared / infinite playback)."""
    call = row_call(node)
    for a in call.args if call else ():
        if a.keyword and a.keyword.value == "length":
            v = a.value
            if isinstance(v, cst.Float):
                return v.evaluated_value
            if isinstance(v, cst.Integer):
                return float(v.evaluated_value)
            if isinstance(v, cst.SimpleString):
                try:
                    return float(v.evaluated_value)
                except ValueError:
                    pass
    return None


def row_loop(node: cst.CSTNode) -> str | None:
    """Own scope's `loop="..."` envelope name (None = not declared / default `loop`)."""
    call = row_call(node)
    for a in call.args if call else ():
        if a.keyword and a.keyword.value == "loop":
            v = a.value
            if isinstance(v, cst.SimpleString):
                return v.evaluated_value
    return None


def _body(node: cst.CSTNode) -> Sequence[cst.BaseStatement]:
    if is_module(node):
        return node.body
    if isinstance(node, cst.With) and isinstance(node.body, cst.IndentedBlock):
        return node.body.body
    # Fallback for other nodes that might have a .body attribute (like classes/defs)
    body = getattr(node, "body", None)
    if isinstance(body, cst.IndentedBlock):
        return body.body
    if isinstance(body, Sequence):
        return body  # type: ignore
    return []


def _with_body(node: cst.CSTNode, body: Sequence[cst.BaseStatement]) -> cst.CSTNode:
    if is_module(node):
        return node.with_changes(body=list(body))
    if isinstance(node, cst.With) and isinstance(node.body, cst.IndentedBlock):
        return node.with_changes(body=node.body.with_changes(body=list(body)))
    return node


def _header(node: cst.With) -> str:
    code = _EMPTY.code_for_node(node.with_changes(leading_lines=[
    ], body=node.body.with_changes(body=[cst.SimpleStatementLine([cst.Pass()])])))
    return code.split("\n", 1)[0].rstrip()


def _row_src(n: cst.CSTNode) -> str:
    if is_with_block(n):
        return _header(n)
    return _EMPTY.code_for_node(n.with_changes(leading_lines=[])).rstrip("\n")


def _parse(text: str, old: cst.BaseStatement | None) -> cst.BaseStatement:
    """Row text -> node. A header (`... :`) on a nest row keeps the old body."""
    stripped = text.rstrip()
    if stripped.endswith(":"):
        new = cst.parse_statement(stripped + "\n    pass\n")
        if not block_name(new):
            raise cst.ParserSyntaxError("header must be `with block(\"name\"):`", lines=[
                                        text], raw_line=1, raw_column=0)

        # Narrow 'new' to cst.With to access .body
        if isinstance(new, cst.With) and isinstance(new.body, cst.IndentedBlock):
            body = old.body if old is not None and isinstance(old, cst.With) and isinstance(
                old.body, cst.IndentedBlock) and block_name(old) else new.body
            new = new.with_changes(body=body)
    else:
        # multi-line text = ok iff it's still exactly 1 statement (e.g. a triple-quoted
        # literal, orca grids); parse_statement itself rejects a genuine multi-statement paste.
        new = cst.parse_statement(stripped + "\n")
    if old is not None:
        # Cast old to a type that has leading_lines (most statements do)
        if hasattr(old, "leading_lines"):
            new = new.with_changes(leading_lines=getattr(old, "leading_lines"))
    return new


class Doc:
    def __init__(self, text: str = "", path: FsPath | None = None, on_write: Callable[[str], None] | None = None,
                 autosave: bool = True):
        self.module = cst.parse_module(text)
        self.path = path
        self.on_write = on_write
        # False: commits apply in-memory only; `flush()`/`:w` writes `path`
        self.autosave = autosave
        self.dirty = False  # True once `module` diverges from `_disk` under autosave=False
        self.drafts: dict[RowPath, str] = {}
        self.errors: dict[RowPath, str] = {}
        # eval exceptions by leaf row (`set_run_errors`)
        self.run_errors: dict[RowPath, str] = {}
        # committed row text a draft was made against
        self.bases: dict[RowPath, str] = {}
        # drafts whose row no longer matches its base (external edit)
        self.misplaced: list[RowPath] = []
        self.file_error: str | None = None  # external edit that doesn't parse
        self._disk = text
        self.version = 0  # bumped on any mutation touching `module`/drafts/errors; `rows()` cache key
        self._rows_cache: dict[RowPath, tuple[int, list[Row]]] = {}
        # whole-tree snapshots, 1 per `_splice` (cst = immutable, cheap)
        self.undo_stack: list[cst.Module] = []
        self.redo_stack: list[cst.Module] = []
        self._in_step = False

    @classmethod
    def load(cls, path: FsPath, autosave: bool = True) -> "Doc":
        return cls(path.read_text() if path.exists() else "", path=path, autosave=autosave)

    @property
    def code(self) -> str:
        if is_module(self.module):
            return self.module.code
        return _EMPTY.code_for_node(self.module)

    def sync(self) -> bool:
        """Pick up external edits to `path`. -> True if the tree changed.
        Unparseable file text keeps the last good tree (+ `file_error`) and is never overwritten silently."""
        if not self.path or not self.path.exists():
            return False
        text = self.path.read_text()
        if text == self._disk:
            return False
        self._disk = text
        try:
            module = cst.parse_module(text)
        except cst.ParserSyntaxError as e:
            self.file_error = str(e).split("\n", 1)[0]
            return True
        self.file_error = None
        self.module = module
        self.misplaced = [
            p for p in self.drafts if self.src_at(p) != self.bases.get(p)]
        self._touch()
        return True

    def set_run_errors(self, nest: RowPath, errs: dict[RowPath, str]) -> None:
        """Replace `nest`'s direct leaves' eval errors (a nest eval = its leaves only)."""
        old = {p: e for p, e in self.run_errors.items() if p[:-1] == nest}
        if old != errs:
            for p in old:
                del self.run_errors[p]
            self.run_errors.update(errs)
            self._touch()

    def _touch(self) -> None:
        """Bump `version`, invalidating `rows()`'s cache. Called on every mutation of
        `module`/`drafts`/`errors` (`_splice`, `stage`'s draft branch, `discard`)."""
        self.version += 1

    def walk(self, parent: RowPath = ()) -> list[tuple[RowPath, str]]:
        """Every row in the tree, depth first: (path, src)."""
        out = []
        for r in self.rows(parent):
            out.append((r.path, r.src))
            if r.name is not None:
                out += self.walk(r.path)
        return out

    def find(self, src: str, near: RowPath) -> RowPath | None:
        """Row w/ text `src` closest to `near` (same parent first, then index distance)."""
        hits = [p for p, t in self.walk() if t == src]
        return min(hits, key=lambda p: (p[:-1] != near[:-1], abs(p[-1] - near[-1]) if p else 0, len(p)), default=None)

    def relocate(self) -> dict[RowPath, RowPath | None]:
        """Re-key misplaced drafts onto the row matching their base. Unmatched -> dropped. -> {old: new}."""
        moves: dict[RowPath, RowPath | None] = {}
        keep = {p: (self.drafts[p], self.errors.get(p), self.bases.get(
            p)) for p in self.drafts if p not in self.misplaced}
        for p in self.misplaced:
            new = self.find(self.bases.get(p, ""), p)
            moves[p] = new if new is not None and new not in keep else None
            if moves[p] is not None:
                m_p: RowPath = moves[p]  # type: ignore
                keep[m_p] = (
                    self.drafts[p], self.errors.get(p), self.bases.get(p))
        self.drafts = {p: v[0] for p, v in keep.items()}
        self.errors = {p: v[1] for p, v in keep.items() if v[1] is not None}
        self.bases = {p: v[2] for p, v in keep.items() if v[2] is not None}
        self.misplaced = []
        self._touch()
        return moves

    def src_at(self, path: RowPath) -> str | None:
        if not path or not self._exists(path):
            return None
        return _row_src(self.node(path))

    def _exists(self, path: RowPath) -> bool:
        try:
            n: cst.CSTNode = self.module
            for k, i in enumerate(path):
                if k and not block_name(n):
                    return False
                n = _body(n)[i]
            return True
        except (IndexError, AttributeError):
            return False

    # ------------------------------------------------------------ read
    def node(self, path: RowPath) -> cst.CSTNode:
        n: cst.CSTNode = self.module
        for i in path:
            n = _body(n)[i]
        return n

    def is_nest(self, path: RowPath) -> bool:
        return not path or block_name(self.node(path)) is not None

    def rows(self, parent: RowPath = ()) -> list[Row]:
        """Cached on `(parent, self.version)`: libcst's `code_for_node` (`_row_src`) is !cheap,
        and callers (`anchor_widget`, `refresh_rows`, `walk`) re-read the same parent every tick
        with nothing changed. `_touch()` invalidates on any doc mutation."""
        cached = self._rows_cache.get(parent)
        if cached is not None and cached[0] == self.version:
            return cached[1]
        if not self.is_nest(parent):
            raise ValueError(f"{parent} is not a block")
        out = []
        for i, n in enumerate(_body(self.node(parent))):
            p = (*parent, i)
            name = block_name(n)
            is_block = name is not None
            out.append(Row(p, _row_src(n), name, len(_body(n)) if name else 0, self.drafts.get(p), self.errors.get(
                p), self.run_errors.get(p), self.effective_timestretch(p) if is_block else None,
                self.effective_length(p) if is_block else None,
                self.effective_loop(p) if is_block else None))
        self._rows_cache[parent] = (self.version, out)
        return out

    def source(self, path: RowPath) -> str:
        """Runnable code for a row (nest = whole subtree)."""
        return _EMPTY.code_for_node(self.node(path)) if path else self.code

    def breadcrumb(self, path: RowPath) -> list[str]:
        """Names of the blocks enclosing/at `path` (a leaf row adds nothing)."""
        names = (block_name(self.node(path[: k + 1]))
                 for k in range(len(path)))
        return [n for n in names if n]

    def label(self, path: RowPath) -> str:
        """Eval label (canonical block path `a/b`) for the nest at/enclosing `path` (root's
        direct leaves = "main")."""
        crumb = self.breadcrumb(path)
        return "/".join(crumb) if crumb else "main"

    # ------------------------------------------------------------ write
    def _splice(self, parent: RowPath, fn: Callable[[list[cst.BaseStatement]], list[cst.BaseStatement]]) -> None:
        def go(node: cst.CSTNode, rest: RowPath) -> cst.CSTNode:
            body = list(_body(node))
            if not rest:
                return _with_body(node, fn(body))

            # Narrow the element being replaced to BaseStatement
            target = body[rest[0]]
            if not isinstance(target, cst.BaseStatement):
                # This should theoretically not happen in this block tree
                return node

            body[rest[0]] = go(target, rest[1:])  # type: ignore
            return _with_body(node, body)

        if not self.is_nest(parent):
            raise ValueError(f"{parent} is not a block")
        if self.file_error:
            raise RuntimeError(
                f"file has an unparsed external edit: {self.file_error}")
        new = go(self.module, parent)
        if not self._in_step:  # 1 undo step per event-loop tick: `2dd`/fold/put = 1 step
            if is_module(self.module):
                self.undo_stack.append(self.module)
            del self.undo_stack[:-500]
            self.redo_stack.clear()
            try:
                asyncio.get_running_loop().call_soon(setattr, self, "_in_step", False)
                self._in_step = True
            # no loop (sync callers): every splice = own step
            except RuntimeError:
                pass
        self.module = new  # type: ignore[assignment]
        self._touch()
        self._write()

    def _swap(self, src: list[cst.Module], dst: list[cst.Module]) -> bool:
        if not src or self.file_error:
            return False
        if is_module(self.module):
            dst.append(self.module)
        self.module = src.pop()
        self.drafts.clear()
        self.bases.clear()
        self.errors.clear()
        self._touch()
        self._write()
        return True

    def undo(self) -> bool:
        """Every tree write (edit/insert/delete/flag/rename/...) goes through `_splice` -> 1 step."""
        return self._swap(self.undo_stack, self.redo_stack)

    def redo(self) -> bool:
        return self._swap(self.redo_stack, self.undo_stack)

    def _write(self) -> None:
        code = self.code
        if not self.autosave:
            self.dirty = code != self._disk
            return  # buffer-only: `path` untouched until `flush()`/`:w`
        self._disk = code
        if self.path:
            self.path.write_text(code)
        if self.on_write:
            self.on_write(code)

    def flush(self) -> bool:
        """Explicit save (`:w`) when `autosave=False`. -> True if it wrote (dirty & has a path)."""
        if not self.dirty or not self.path:
            return False
        code = self.code
        self._disk = code
        self.path.write_text(code)
        if self.on_write:
            self.on_write(code)
        self.dirty = False
        return True

    def stage(self, path: RowPath, text: str) -> str | None:
        """Edit a row. Parses -> committed & written, returns None. Else kept as draft, returns error."""
        try:
            new = _parse(text, self.node(path))  # type: ignore[arg-type]
            if self.file_error:
                raise RuntimeError("file edit pending")
        except (cst.ParserSyntaxError, RuntimeError) as e:
            self.bases.setdefault(path, _row_src(self.node(path)))
            self.drafts[path], self.errors[path] = text, str(e).split("\n", 1)[
                0]
            self._touch()
            return self.errors[path]
        self.discard(path)
        self._splice(path[:-1], lambda b: b[: path[-1]] +
                     [new] + b[path[-1] + 1:])
        return None

    def discard(self, path: RowPath) -> None:
        self.drafts.pop(path, None)
        self.errors.pop(path, None)
        self.bases.pop(path, None)
        if path in self.misplaced:
            self.misplaced.remove(path)
        self._touch()

    def timestretch_scopes(self) -> dict[str, float]:
        """Every block's timestretch the code declares: label -> ts (0.0=frozen, 1.0=normal).
        Only explicitly declared values are included (None = inherit, not written)."""
        out = {}
        for p, _ in self.walk():
            n = self.node(p)
            if self.is_nest(p):
                ts = row_timestretch(n)
                if ts is not None:
                    out[self.label(p)] = ts
        return out

    def effective_timestretch(self, path: RowPath) -> float:
        """Nearest declared scope value, defaulting to frozen before a block is started."""
        ts = 0.0
        for depth in range(1, len(path) + 1):
            declared = row_timestretch(self.node(path[:depth]))
            if declared is not None:
                ts = declared
        return ts

    def effective_length(self, path: RowPath) -> float | None:
        """Nearest declared `length` (seconds); None = infinite (the default)."""
        out = None
        for depth in range(1, len(path) + 1):
            declared = row_length(self.node(path[:depth]))
            if declared is not None:
                out = declared
        return out

    def effective_loop(self, path: RowPath) -> str | None:
        """Nearest declared `loop` envelope name; None = the default (`loop`)."""
        out = None
        for depth in range(1, len(path) + 1):
            declared = row_loop(self.node(path[:depth]))
            if declared is not None:
                out = declared
        return out

    def block_scopes(self) -> dict[str, tuple[float | None, float | None, str | None]]:
        """Every block's own declared timing: label -> (timestretch, length, loop); None = inherit."""
        out: dict[str, tuple[float | None, float | None, str | None]] = {}
        for p, _ in self.walk():
            if self.is_nest(p):
                n = self.node(p)
                out[self.label(p)] = (row_timestretch(n), row_length(n), row_loop(n))
        return out

    def set_length(self, path: RowPath, length: float | None) -> None:
        """Write `length=<seconds>`; None = drop it (infinite)."""
        self._set_kwarg(path, "length", length,
                        lambda v: cst.SimpleString(f'"{v:g}"'))

    def set_loop(self, path: RowPath, name: str | None) -> None:
        """Write `loop="<name>"`; None = drop it (default)."""
        self._set_kwarg(path, "loop", name, lambda v: cst.SimpleString(f'"{v}"'))

    def _set_kwarg(self, path: RowPath, keyword: str, value, render) -> None:
        """Splice `keyword=render(value)` onto the row's call (None = drop the kwarg)."""
        node, call = self.node(path), row_call(self.node(path))
        if call is None:
            raise ValueError(f"{path}: no call to flag")
        args = [a for a in call.args if not (
            a.keyword and a.keyword.value == keyword)]
        if value is None:
            if args:
                args[-1] = args[-1].with_changes(
                    comma=cst.MaybeSentinel.DEFAULT)
        else:
            if args:
                args[-1] = args[-1].with_changes(comma=cst.Comma(
                    whitespace_after=cst.SimpleWhitespace(" ")))
            args.append(cst.Arg(keyword=cst.Name(keyword),
                                value=render(value),
                                equal=cst.AssignEqual(cst.SimpleWhitespace(""), cst.SimpleWhitespace(""))))
        self._replace_call(path, node, call.with_changes(args=args))

    def set_timestretch(self, path: RowPath, ts: float | None) -> None:
        """Write `timestretch=<float>`; None = drop it (inherit)."""
        node, call = self.node(path), row_call(self.node(path))
        if call is None:
            raise ValueError(f"{path}: no call to flag")
        args = [a for a in call.args if not (
            a.keyword and a.keyword.value in ("timestretch", "playing", "paused", "autorun"))]
        if ts is None:
            if args:
                args[-1] = args[-1].with_changes(
                    comma=cst.MaybeSentinel.DEFAULT)
        else:
            if args:
                args[-1] = args[-1].with_changes(comma=cst.Comma(
                    whitespace_after=cst.SimpleWhitespace(" ")))
            args.append(cst.Arg(keyword=cst.Name("timestretch"),
                                value=cst.SimpleString(f'"{ts}"'),
                                equal=cst.AssignEqual(cst.SimpleWhitespace(""), cst.SimpleWhitespace(""))))
        self._replace_call(path, node, call.with_changes(args=args))

    def _replace_call(self, path: RowPath, node: cst.CSTNode, new_call: cst.Call) -> None:
        if is_with_block(node):
            new = node.with_changes(
                items=[node.items[0].with_changes(item=new_call)])
        else:
            # For leaf rows, we expect a statement with a value
            body = _body(node)
            if not body:
                return
            stmt = body[0]
            if hasattr(stmt, "with_changes") and hasattr(stmt, "value"):
                new = stmt.with_changes(value=new_call)  # type: ignore
                # We must wrap it back into the node's body
                node = node.with_changes(body=[new])  # type: ignore
            else:
                return
        self._splice(path[:-1], lambda b: b[: path[-1]] +
                     [new] + b[path[-1] + 1:])

    def set_flag(self, path: RowPath, key: str, on: bool) -> None:
        """Write (`key=True`) / drop kwarg `key` on the row's call, keeping the rest of the row."""
        node, call = self.node(path), row_call(self.node(path))
        if call is None:
            raise ValueError(f"{path}: no call to flag")
        args = [a for a in call.args if not (
            a.keyword and a.keyword.value == key)]
        if on:
            if args:
                args[-1] = args[-1].with_changes(comma=cst.Comma(
                    whitespace_after=cst.SimpleWhitespace(" ")))
            args.append(cst.Arg(keyword=cst.Name(key), value=cst.Name(
                "True"), equal=cst.AssignEqual(cst.SimpleWhitespace(""), cst.SimpleWhitespace(""))))
        elif args:
            args[-1] = args[-1].with_changes(comma=cst.MaybeSentinel.DEFAULT)
        new_call = call.with_changes(args=args)
        if is_with_block(node):
            new = node.with_changes(
                items=[node.items[0].with_changes(item=new_call)])
        else:
            body = _body(node)
            if not body:
                return
            stmt = body[0]
            if hasattr(stmt, "with_changes") and hasattr(stmt, "value"):
                new = stmt.with_changes(value=new_call)  # type: ignore
                node = node.with_changes(body=[new])  # type: ignore
            else:
                return
        self._splice(path[:-1], lambda b: b[: path[-1]] +
                     [new] + b[path[-1] + 1:])

    def insert(self, parent: RowPath, index: int, text: str) -> RowPath:
        """New row; raises ParserSyntaxError (caller keeps its own draft) if it doesn't parse."""
        new = _parse(text, None)
        self._shift(parent, index, +1)
        self._splice(parent, lambda b: b[:index] + [new] + b[index:])
        return (*parent, index)

    def delete(self, path: RowPath) -> None:
        self.discard(path)
        self._splice(path[:-1], lambda b: b[: path[-1]] + b[path[-1] + 1:])
        self._shift(path[:-1], path[-1] + 1, -1)

    def _shift(self, parent: RowPath, start: int, d: int) -> None:
        """Re-key drafts of siblings (and their subtrees) at index >= start."""
        n = len(parent)

        def mv(p: RowPath) -> RowPath:
            return (*parent, p[n] + d, *p[n + 1:]) if len(p) > n and p[:n] == parent and p[n] >= start else p

        self.drafts = {mv(p): v for p, v in self.drafts.items()}
        self.errors = {mv(p): v for p, v in self.errors.items()}
        self.bases = {mv(p): v for p, v in self.bases.items()}


def from_labels(text: str) -> str:
    """Legacy `# @label` sections -> `with block("label"):` nests (body indented 4sp).
    Code before the first label stays top-level (= "main"). Pure; no file I/O."""
    lines = text.split("\n")
    heads = [(i, m.group(1))
             for i, l in enumerate(lines) if (m := LABEL_RE.match(l))]
    if not heads:
        return text
    parts = []
    if (head0 := "\n".join(lines[: heads[0][0]]).rstrip()).strip():
        parts.append(head0)
    for n, (start, label) in enumerate(heads):
        end = heads[n + 1][0] if n + 1 < len(heads) else len(lines)
        # drop the `# @label` marker; `with block("label"):` carries it now
        body_lines = lines[start + 1: end]
        while body_lines and not body_lines[-1].strip():
            body_lines.pop()
        body = "\n".join(("    " + l if l.strip() else l) for l in body_lines)
        parts.append(f'with block("{label}"):\n{body}')
    return "\n\n".join(parts) + "\n"
