"""Livecode namespace: every helper forwards (verb, args, kwargs) to the brain
(`asemic/brain/do`, crates/brain/src/verbs.rs), which builds, validates and owns state.

Blocks are `with block("name"):` nests over a `blocks.Doc` tree; a nest's label = dotted
names from root (`Doc.label`), root's direct leaves = "main". `block()` is a no-op context
manager so the file also runs as plain Python. Re-running a label deletes what it created
last time but not this time.

Legacy files use flat `# @label` comments; `blocks.from_labels` converts them to the nested
form above (in memory, on load — see `app.py`), so there's exactly one `# @label` parser.
"""

from __future__ import annotations

import contextlib
import inspect
import io
import json
from hashlib import sha256
from pathlib import Path
import traceback
from typing import Any, Callable

from .blocks import Doc, RowPath, row_timestretch
from .client import Client, QueryError
from . import ids
from .columns import resolve_path
from .points import Points, decode_points, encode_points
from .sc_literal import to_sc


@contextlib.contextmanager
def block(name: str, timestretch: float = 0.0, length: float | None = None, loop: str = "loop"):
    """No-op nest marker: `with block("name"):` reads as plain Python too (`python examples/x.py`).

    The block's timing parameters (J 2026-10-13), evaluated by the brain per block:

    - `timestretch` — playhead speed: 1.0 real-time, 0.0 frozen (default), >1 faster, <0 reverse.
    - `length` — playback length in seconds; omitted/None = infinite playback.
    - `loop` — loop envelope over the block's phase: `"off"` plays once and holds, `"loop"`
      repeats, `"pingpong"` bounces (extensible to any curve/envelope, incl. proc-driven ones).

    The brain advances each block's own playhead (`asemic/block/<label>.time`) from these and
    feeds it to the block's shaders as `info.time`."""
    yield


def _leaves_code(doc: Doc, path: RowPath) -> str:
    """Code of `path`'s own direct non-nest rows (child nests excluded), concatenated in order."""
    return "".join(r.src + "\n" for r in doc.rows(path) if r.name is None)


def labels_code(doc: Doc, path: RowPath = ()) -> dict[str, str]:
    """label -> its own direct-leaf code, for every nest in the tree (root = "main")."""
    out = {doc.label(path): _leaves_code(doc, path)}
    for r in doc.rows(path):
        if r.name is not None:
            out.update(labels_code(doc, r.path))
    return out


# UI/perf settings: brain-owned (`ui` verb, asemic_schema::UiSettings -> asemic/state/ui);
# this = frontend cache, filled at Repl init + updated by the app's subscription.
UI: dict[str, Any] = {}


_BLOCK_KEYS = {"timestretch": ids.block_timestretch, "length": ids.block_length, "loop": ids.block_loop}


class Repl:
    def __init__(self, client: Client):
        self.c = client
        self.label: str | None = None
        self.on_embed: Callable[[str], None] | None = None
        self.ns: dict[str, Any] = {}
        self.verbs: list[dict] = []
        # labels run this session
        self.ran: set[str] = set()
        # `py` procs: gen id -> fn (evaluated on brain calls)
        self.py_procs: dict[str, Callable] = {}
        self._py_sub = None
        # row-level block-lifecycle hooks: resolved row id -> guard dict
        self.row_guards: dict[str, Any] = {}
        # open file (app sets it): `affinity` rows only draw on documents saved beside it
        self.path = None
        self._build_ns()
        UI.update(self.do("ui"))  # brain verb, no kw = current settings

    def __getattr__(self, name: str) -> Any:
        """Verbs (brain VERBS table -> `self.ns`) as methods too: `repl.procs()`, `repl.texs()`."""
        ns = self.__dict__.get("ns") or {}
        if name in ns and callable(ns[name]):
            return ns[name]
        raise AttributeError(name)

    def do(self, verb: str, *args: Any, **kwargs: Any) -> Any:
        return self.c.call(verb, args, kwargs, label=self.label)

    def run_block(self, label: str, code: str) -> str:
        """Exec one block; returns captured output. Brain prunes what the label stopped creating.
        A failure leaves `self.failed = (line in code, message)`, else None."""
        buf = io.StringIO()
        self.label, self.failed = label, None
        self.do("begin")
        ok = True
        try:
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                exec(compile(code, f"<{label}>", "exec"), self.ns)
        except Exception as e:
            ok = False
            lines = [f.lineno for f in traceback.extract_tb(
                e.__traceback__) if f.filename == f"<{label}>"]
            if isinstance(e, SyntaxError) and e.filename == f"<{label}>":
                lines.append(e.lineno or 1)
            self.failed = (lines[-1] if lines else 1,
                           f"{type(e).__name__}: {e}".splitlines()[0])
            tb = traceback.format_exc().splitlines()
            buf.write("\n".join(
                l for l in tb if "namespace.py" not in l and "client.py" not in l) + "\n")
        finally:
            self.do("commit", ok=ok, code=code)
            self.label = None
        return buf.getvalue()

    def run_nest(self, doc: Doc, path: RowPath) -> str:
        """Run only `path`'s own direct leaves (its label) — a leaf row's commit re-runs this."""
        code = _leaves_code(doc, path)
        self.pause_nest(doc, path)
        self.ran.add(doc.label(path))
        out = self.run_block(doc.label(path), code) if code.strip() else ""
        errs: dict[RowPath, str] = {}
        if code.strip() and self.failed:
            line, msg = self.failed
            # leaf whose source spans `line` (leaves are concatenated in `_leaves_code`)
            n = 0
            for r in doc.rows(path):
                if r.name is None:
                    n += r.src.count("\n") + 1
                    if line <= n:
                        errs[r.path] = msg
                        break
        doc.set_run_errors(path, errs)
        return out

    def run_tree(self, doc: Doc, path: RowPath = (), startup: bool = False) -> str:
        """Run the nest at `path` (its own leaves), then recurse into each child nest.
        Nodes are created at timestretch 0 by default; a brain error is logged, not raised."""
        try:
            out = self.run_nest(doc, path)
            if path:
                doc.run_errors.pop(path, None)
        except QueryError as e:
            out = f"{doc.label(path)}: {e}\n"
            if path:
                # error view under the block's own row
                doc.run_errors[path] = str(e)
            doc._touch()
        for r in doc.rows(path):
            if r.name is not None:
                out += self.run_tree(doc, r.path, startup)
        return out

    def pause_nest(self, doc: Doc, path: RowPath) -> None:
        """Apply explicit scope value; clear absent values so they inherit the frozen default."""
        if path:
            ts = row_timestretch(doc.node(path))
            self.timestretch_scope(doc.label(path), ts)

    def timestretch_scope(self, label: str, ts: float | None) -> None:
        key = ids.block_timestretch(label)
        if ts is None:
            self.c.delete(key)
        else:
            self.c.put(key, ts)

    def sync_blocks(self, doc: Doc) -> None:
        """Brain block timing state := exactly the code's `Doc.block_scopes()`.

        `timestretch` is diffed (only changed labels written) so a running block isn't
        re-frozen; `length` (None = infinite -> delete) and `loop` (default `"loop"`, written
        for every block so the brain gives each one a playhead) are written per block."""
        want = doc.block_scopes()
        want.setdefault("main", (0.0, None, None))

        def put(label: str, kind: str, value) -> None:
            key = _BLOCK_KEYS[kind](label)
            if value is None:
                self.c.delete(key)
            else:
                self.c.put(key, value)

        have = {ids.id_of(k, ids.BLOCK_PREFIX, ids.TIMESTRETCH_SUFFIX): v
                for k, v in self.c.get(ids.BLOCK_TIMESTRETCH) if isinstance(v, (int, float))}
        for label in have:
            if label not in want:
                put(label, "timestretch", None)
        for label, (ts, length, loop) in want.items():
            if have.get(label) != ts:
                put(label, "timestretch", ts)
            put(label, "length", length)
            put(label, "loop", loop or "loop")

    # kept for callers that only care about the play/pause half of block timing
    def sync_timestretches(self, doc: Doc) -> None:
        self.sync_blocks(doc)

    def run_all(self, doc: Doc, startup: bool = False) -> str:
        self.sync_timestretches(doc)
        out = self.run_tree(doc, (), startup)
        self.sync_timestretches(doc)
        self.c.call("sync", (), {"labels": list(labels_code(doc))})
        return out

    def drop(self, label: str) -> None:
        self.ran.discard(label)
        self._cleanup_row_guards(label)
        self.c.call("drop", (label,), {})

    def _cleanup_row_guards(self, label: str) -> None:
        """Drop every row-level lifecycle guard whose block lives under `label`."""
        for key, g in list(self.row_guards.items()):
            if ids.under(label, g["block"]):
                try:
                    g["on_stop"]()
                except Exception:
                    pass
                try:
                    g["sub"].undeclare()
                except Exception:
                    pass
                finally:
                    self.row_guards.pop(key, None)

    def _guard_row(
        self,
        key: str,
        on_play: Callable[[], None],
        on_stop: Callable[[], None],
        *,
        initial: str | None = None,
    ) -> None:
        """Register a block-lifecycle hook for a row. `key` is a resolved row id.

        `on_play` runs when the block's effective timestretch becomes nonzero;
        `on_stop` runs when it becomes zero or the row/block is dropped.
        `initial` = current block label (defaults to `self.label`)."""
        block = initial or self.label
        if not block:
            return

        old = self.row_guards.pop(key, None)
        if old is not None:
            try:
                old["on_stop"]()
            except Exception:
                pass
            try:
                old["sub"].undeclare()
            except Exception:
                pass

        state = {"last": None}

        def on_ts(_key, is_put, value):
            if not is_put:
                value = 0.0
            else:
                try:
                    value = float(value)
                except (TypeError, ValueError):
                    return
            last = state["last"]
            if last is None:
                state["last"] = value
                if value != 0.0:
                    on_play()
                return
            if last == 0.0 and value != 0.0:
                on_play()
            elif last != 0.0 and value == 0.0:
                on_stop()
            state["last"] = value

        ts_key = ids.block_timestretch(block)
        sub = self.c.subscribe(ts_key, on_ts)
        self.c._forget_sub(sub)  # guard owns the subscriber, not client.close()
        self.row_guards[key] = {
            "sub": sub, "block": block, "on_play": on_play,
            "on_stop": on_stop, "state": state,
        }
        try:
            cur = self.c.get(ts_key, timeout=0.5)
            if cur:
                on_ts(ts_key, True, cur[0][1])
        except Exception:
            pass

    def procs(self) -> Any:
        return self.do("procs")

    def _build_ns(self) -> None:
        for _ in range(20):  # fresh peer: routing to the brain can take a moment
            if (r := self.c.get("asemic/brain/verbs", timeout=0.5)):
                break
        else:
            raise RuntimeError("asemic-brain not answering asemic/brain/verbs")
        self.verbs = r[0][1]
        for v in r[0][1]:
            def helper(*a, _verb=v["verb"], **kw):
                return self.do(_verb, *a, **kw)
            helper.__name__ = v["verb"]
            helper.__doc__ = f"{v['verb']}({', '.join(v['args'])}) — {v['doc']}"
            self.ns[v["verb"]] = helper

        def embed(id, preview=None):
            """Link row to node `id` (click = jump to its row) + that node's own built-in preview;
            `preview` = dots|image|ascii overrides the renderer its producer declared (`keys::PREVIEW_KIND`)."""
            nid = resolve_path(self.label, id)  # block-relative, like proc ids
            if preview:
                self.c.put(ids.preview_kind(nid), preview)
            if self.on_embed:
                self.on_embed(nid)

        def orca(grid: str, bpm: float | None = None) -> None:
            """No-op marker, like `block()`: lets an `orca(\"\"\" < grid > \"\"\")` row still exec as plain
            Python. The grid itself is owned by the orca adapter process (tmux session
            `asemic-orca`, adapters/orca/adapter.toml); `columns.py` open_orca views it."""
            return None

        brain_proc = self.ns.get("proc")

        def proc(id, *a, **kw):
            """`proc(id, kind, **params)`: processor component in the brain."""
            return brain_proc(id, *a, **kw)

        def py(id, fn: str, p=None, input=None):
            """Python proc evaluated in REPL: `py(id, fn="./block_fn", p={...}, input=<gen>)` where the
            referenced function `fn(params[, inp])` returns `{"dims": [...], "lines": [[[x, y, ...dims]]]}`
            or a `Points` object. `fn` must be a block-scoped string path (e.g. `"./melody_fn"` or `"../other/fn"`).
            Brain queries params + input gen on change, caches reply."""
            if not isinstance(fn, str):
                raise TypeError(f"py: fn must be a block-scoped string path (e.g. './melody_fn'), got {type(fn).__name__}")
            label = self.label
            target_path = resolve_path(label, fn)
            # Find the function in registered block functions or namespace
            func_name = target_path.rsplit("/", 1)[-1]
            func = self.py_procs.get(target_path) or self.ns.get(func_name)
            if func is None or not callable(func):
                raise ValueError(f"py: function {fn!r} ({target_path!r}) not found or not callable")
            self.py_procs[resolve_path(label, id)] = func
            if self._py_sub is None:
                self._py_sub = self.c.session.declare_queryable("asemic/py/**", self._py_call)
            kw = dict(p or {})
            if input is not None:
                kw["input"] = input
            return brain_proc(id, "py", **kw)

        def physics(id, **kw):
            """Rapier2d balls in a unit box (processor -> asemic/value/<id>.<channel> + asemic/gen/<id>)."""
            return brain_proc(id, "physics", **kw)

        def wave(id, **kw):
            """1D stationary Schrödinger (schrodinger_equation, Numerov) solver."""
            return brain_proc(id, "wave", **kw)

        def spectrum(id, input=None, **kw):
            """FFT bands of input stream (processor -> asemic/value/<id>.<channel> + asemic/gen/<id>)."""
            if input is not None:
                kw["input"] = input
            return brain_proc(id, "spectrum", **kw)

        def glyph(id, text=None, **kw):
            """Text as asemic font paths, scanned/wobbled by params."""
            if text is not None:
                kw["text"] = text
            return brain_proc(id, "glyph", **kw)

        def lsys(id, axiom=None, rules=None, **kw):
            """L-system (symbios derivation + turtle), optionally rooted on input gen points."""
            if axiom is not None:
                kw["axiom"] = axiom
            if rules is not None:
                kw["rules"] = rules
            return brain_proc(id, "lsys", **kw)

        def text(id, path=None, text=None, **kw):
            """Text shaped (harfbuzz) in font path, outlines (skrifa) at axis params, flattened (lyon)."""
            if path is not None:
                kw["path"] = path
            if text is not None:
                kw["text"] = text
            return brain_proc(id, "text", **kw)

        def melody(id, **kw):
            """Seeded pentatonic walk: 1 line per voice, 1 point per note, dims pitch (MIDI) + dur (beats)."""
            return brain_proc(id, "melody", **kw)

        def variations(id, input, **kw):
            """12-tone variations (transpositions, inversions, retrogrades) of input motif points/multiarray modulated by smooth noise."""
            kw["input"] = input
            return brain_proc(id, "variations", **kw)

        def affinity(id, input, file=None, preview=None, page=None, on=None, **opts):
            """Renderer row: the affinity adapter (adapters/affinity) draws each new multiarray on
            `input` in Affinity's document (saved beside the open file); overflow systems
            flow onto available document pages or marker containers. Page grab -> asemic/preview/<id> (`embed(id)` elsewhere).
            Starts the adapter (returns once it is ready), then sends.

            Args:
                id: row id (block-relative).
                input: gen to draw (block-relative).
                file: optional filename/path (file-relative) to open/create in Affinity.
                preview: dots|image|ascii -- row preview renderer (default image).
                page: optional 0-based page/artboard index to target.
                on: optional name/tag of a marker layer/shape/container to draw inside.
                x: [bar, beat] — time axis in quarter-notes: x[0] = the barline interval (a heavy
                    rule every x[0] quarters; the system holds as many WHOLE bars as fit at the
                    quarter-note width — see settings.quarter_in); 0 = unmeasured, one row over
                    the total span; x[1] = light rule every n quarters (0 = off; fractions too:
                    1/12 = the twelve-time grid) (default [16, 0]).
                y: [subdivisions/octave, accidentals/line-space] — the pitch staff (default [6,3]):
                    [6,3] = normal staff (5-line treble; accidental by the FOLLOWING note's
                    motion: down = flat, up = sharp, no naturals) | [6,1] | [6,0] = that staff
                    without accidentals | [1,1] | [1,0] = one rule per octave C | [12,1] |
                    [12,0] = chromatic (1 position per halfstep, 0 = middle C). The accidental
                    count = the microtone ladder (quarter-/third-tones; until glyphs exist,
                    other pairs render nothing).
                notes: event layers, SUPERIMPOSED — tuple = exact set: heads (noteheads +
                    ledgers) | stems | lines (headless dur bars, thickness = dynamics) |
                    accidentals (motion-spelled glyph, flat moves the head; y[1] pair still
                    gates the glyph; without the layer heads just round to the nearest
                    division, no spelling) | names (pitch label beside notehead) | `notes` inside
                    a tuple = heads+stems+accidentals; string = shorthand (that one layer,
                    `notes` = the trio; e.g. notes="heads" == ("heads",)) (default notes = the trio).
                names: note name format when `names` layer is used: 'pitchclass' (0-9, t, e),
                    'midi', 'hz', 'notename' (A5), 'note' (A; no octave) (default pitchclass).
                pitch: pitch dim name (MIDI; default pitch).
                dur: duration dim name (beats; default dur).
                vel: dynamics dim name (0..1 or MIDI velocity; default vel).
                lo: lowest MIDI when no pitch dim (default 55).
                hi: highest MIDI when no pitch dim (default 84).
                beats: dur-absent x gap -> beats scale (default 16).
                settings: layout knobs (dict) — spacing = a kerning multiplier over the
                    quarter-note width (1 = default, 0.5 = half-spacing = twice the quarters
                    per system); quarter_in = the width of a quarter note in INCHES (default
                    0.25 ~ 1/4 inch): the system length = the page width / that width,
                    ROUNDED TO THE NEAREST WHOLE BAR (x[0]), so notes never overlap; every
                    system holds the same quarter count; x[0] stays the barline interval.
                    Unmeasured (x[0]=0) ignores both.
            """
            key = resolve_path(self.label, id)
            src = resolve_path(self.label, input)  # resolved here: on_play fires after `self.label` reset (run_block finally)
            self.c.get("asemic/adapter/affinity/start", timeout=30)
            file_path = None
            if file is not None:
                p = Path(file)
                if not p.is_absolute() and self.path:
                    file_path = str((self.path.resolve().parent / p).resolve())
                else:
                    file_path = str(p.resolve())
            # Rendering: entering draws immediately (frozen block = its last frame, once), then
            # pausing stops new render commands (paused row), resuming continues them.
            def send_row(paused: bool):
                self.c.put(f"asemic/in/affinity/row/{key}", {
                    "input": src, "file": file_path, "opts": opts,
                    "root": str(self.path.resolve().parent) if self.path else None, "preview": preview,
                    "paused": paused, "page": page, "on": on})

            self._guard_row(key, lambda: send_row(False), lambda: send_row(True))
            send_row(False)  # first enter renders now, !only on the next unfreeze

        def sc(id, code=None, type="ndef", p=None, input=None, target=None, map=None, onset=None, offset=None):
            """SuperCollider row: `code` = a multiline sclang ugen function string
            (`{ |freq = 2000| ... }`), played as `Ndef(<id>)` (when `type="ndef"`) or evaluated
            as a task routine in `Tdef(<id>)` (when `type="tdef"`); re-running the row hot-swaps it.
            When `code` is omitted for `type="tdef"`:
              - `target`: destination Ndef to set parameters on.
              - `map`: dictionary mapping multiarray point attributes to target Ndef controls
                       e.g. `{"pitch": "notePitch", "dur": "noteDur", "vel": "amp"}`.
              - `onset`: optional SC snippet string evaluated on note onset.
              - `offset`: optional SC snippet string evaluated on note offset.
            `p` sets parameters, wires inputs, or supplies multiarrays as SuperCollider server buffers.
            `input` specifies a source gen/proc whose multiarray is bound to the buffer/points.
            Starts the adapter."""
            key = resolve_path(self.label, id)
            name = key.replace("/", "_")  # Ndef/Tdef names: no slashes
            self.c.get("asemic/adapter/supercollider/start", timeout=30)

            # Build zero-code / hook-driven Tdef dictionary when code is omitted
            if code is None and str(type).lower() == "tdef":
                tgt = resolve_path(self.label, target or "voice").replace("/", "_")
                # Default property mapping if not explicitly provided
                prop_map = map or {"pitch": "notePitch", "dur": "noteDur"}
                set_args = ", ".join(f"'{sc_ctrl}', note['{attr}'.asSymbol]" for attr, sc_ctrl in prop_map.items())
                default_onset = f"{{ |note| ~step = (~step ? 0) + 1; Ndef('{tgt}').set({set_args}, 'trig', ~step) }}"
                onset_str = onset if onset else default_onset
                offset_str = f"{{ |note| {offset} }}" if offset else "nil"
                code = f"(target: '{tgt}', onset: {onset_str}, offset: {offset_str})"

            params = dict(p or {})
            if input is not None and "buf" not in params:
                params["buf"] = f"~{input}"

            is_defined = False
            last_points_hash = None

            def send_def():
                nonlocal is_defined
                cmd = "tdef" if str(type).lower() == "tdef" else "def"
                self.c.put(f"asemic/out/supercollider/{cmd}", [name, code or ""])
                is_defined = True
                if params:
                    for k, v in params.items():
                        # Multiarray / list / array-like -> Server buffer via /bdef or points via /pdef
                        if isinstance(v, (list, tuple)) or hasattr(v, "tolist"):
                            self.c.put("asemic/out/supercollider/bdef", [name, k, to_sc(v)])
                            if str(type).lower() == "tdef":
                                self.c.put("asemic/out/supercollider/pdef", [name, k, to_sc(v)])
                        # Ndef / string input wiring -> /map
                        elif isinstance(v, str) and (v.startswith("~") or "/" in v or v.startswith("Ndef(")):
                            src_name = resolve_path(self.label, v.lstrip("~")).replace("/", "_")
                            self.c.put("asemic/out/supercollider/map", [name, k, src_name])
                        else:
                            self.c.put("asemic/out/supercollider/nset", [name, k, v])

            # If input is provided, define frame handler for forwarding multiarray updates
            gen_sub = None
            ack_sub = None
            src_key = resolve_path(self.label, input) if input is not None else None
            gen_key = f"asemic/gen/{src_key}" if src_key is not None else None

            def on_ack(_k: str, _b: bytes):
                # Brain reports value is unchanged downstream; drop active subscription until next cook
                nonlocal gen_sub
                if gen_sub is not None:
                    try:
                        gen_sub.undeclare()
                    except Exception:
                        pass
                    gen_sub = None

            def on_gen_frame(k: str, b: bytes):
                nonlocal last_points_hash
                try:
                    h = sha256(b).digest()
                    if h == last_points_hash:
                        return
                    last_points_hash = h
                    pts = decode_points(b)
                    lines = pts.lines()
                    if lines:
                        flat_pts = lines[0]
                        sc_pts = to_sc(flat_pts)
                        if str(type).lower() == "tdef":
                            self.c.put("asemic/out/supercollider/pdef", [name, "buf", sc_pts])
                        else:
                            self.c.put("asemic/out/supercollider/bdef", [name, "buf", sc_pts])
                except Exception:
                    pass

            def stop_row():
                nonlocal gen_sub, ack_sub
                if gen_sub is not None:
                    try:
                        gen_sub.undeclare()
                    except Exception:
                        pass
                    gen_sub = None
                if ack_sub is not None:
                    try:
                        ack_sub.undeclare()
                    except Exception:
                        pass
                    ack_sub = None
                self.c.put("asemic/out/supercollider/stop", [name])

            def start_row():
                nonlocal gen_sub, ack_sub, last_points_hash
                if not is_defined:
                    send_def()
                else:
                    self.c.put("asemic/out/supercollider/play", [name])

                if ack_sub is None:
                    ack_key = f"asemic/ack/supercollider/**"
                    ack_sub = self.c.subscribe_raw(ack_key, on_ack)

                if gen_key is not None and gen_sub is None:
                    last_points_hash = None
                    gen_sub = self.c.subscribe_raw(gen_key, on_gen_frame)
                    # Pull and deliver the current frame immediately so playback doesn't wait for next cook
                    try:
                        cur = self.c.get(gen_key, timeout=0.5)
                        if cur and cur[0][1]:
                            on_gen_frame(gen_key, cur[0][1])
                    except Exception:
                        pass

            self._guard_row(key, start_row, stop_row)
            if not self.label:
                send_def()

        self.ns.update(
            embed=embed, block=block, client=self.c, orca=orca, proc=proc, affinity=affinity, sc=sc,
            physics=physics, wave=wave, spectrum=spectrum, glyph=glyph, lsys=lsys, text=text,
            melody=melody, variations=variations, py=py,
        )

    def _py_call(self, query) -> None:
        """Answer a `py` proc call (query `asemic/py/<id>`) from the brain with ASP1."""
        gen = str(query.key_expr).removeprefix(ids.py_call(""))
        f = self.py_procs.get(gen)
        if f is None or query.payload is None:
            return
        try:
            req = json.loads(query.payload.to_bytes())
            # brain params are f64 (`2` arrives as 2.0): integral values -> int, so procs can
            # `range(p["n"])` / index with them
            p = {k: int(v) if isinstance(v, float) and v.is_integer() else v
                 for k, v in req["params"].items()} | {"seed": req["seed"]}
            args = [p]
            if len(inspect.signature(f).parameters) > 1:
                inp = req.get("input")
                args.append(inp and decode_points(encode_points(
                    [[tuple(pt) for pt in ln] for ln in inp["lines"]], attrs=tuple(inp["attrs"]))))
            out = f(*args)
            if isinstance(out, Points):  # a multiarray passes through as-is
                out = {"dims": out.attrs[2:], "lines": out.lines()}
            query.reply(query.key_expr, encode_points(
                [[tuple(pt) for pt in ln] for ln in out["lines"]], attrs=("x", "y", *(out.get("dims") or ()))))
            err = ""
        except Exception as e:
            traceback.print_exc()
            err = f"{type(e).__name__}: {e}".splitlines()[0]
        self.c.session.put(f"asemic/err/proc/{gen}", err)  # error view under the @proc row ("" clears)
