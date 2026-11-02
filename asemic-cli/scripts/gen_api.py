#!/usr/bin/env python3
"""Generate `asemic_py/_api.pyi` (typed signatures for every livecode verb + the Python-side
helpers) and `asemic_py/_verbs.json` (structured metadata for documentation and autocomplete)
from the brain's verb table and Rust schema types in `_types.py`.

Usage: asemic-brain --verbs | gen_api.py > asemic_py/_api.pyi
"""

from __future__ import annotations

import json
import re
import sys
import typing
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Python-side helpers built in `asemic_py/namespace.py` (`_build_ns`), not in the brain table.
PY_HELPERS: list[tuple[str, list[str], str]] = [
    ("block", ["name", "timestretch", "loop", "length"],
     "No-op nest marker; `with block(\"name\", timestretch=1.0):` scopes everything inside.\n"
     "timestretch: 1.0 real-time, 0.0 frozen (default), >1 faster, <0 reverse.\n"
     "loop: loop (default), off, pingpong."),
    ("embed", ["id", "preview"],
     "Link row to node `id` (click = jump to its row) + that node's own built-in preview.\n"
     "preview: dots|image|ascii."),
    ("affinity", ["id", "input", "preview", "x", "y", "settings", "notes", "names"],
     "Renderer row: draws gen on input in Affinity Designer document.\n"
     "preview: image|dots|ascii.\n"
     "notes: tuple of layers ('heads', 'stems', 'lines', 'accidentals', 'names'), or preset 'notes'.\n"
     "names: 'pitchclass'|'midi'|'hz'|'notename'|'note'.\n"
     "settings: layout knobs {'spacing': 1.0, 'quarter_in': 0.25}."),
    ("sc", ["id", "code"],
     "SuperCollider synth row: evaluated as Ndef(<id>).\n"
     "params passed as keyword arguments."),
    ("orca", ["grid", "bpm"],
     "No-op marker: an Orca grid literal; the orca adapter process owns the grid."),
    ("physics", ["id", "n", "gravity", "restitution", "radius", "kick", "damping", "angular_damping", "seed"],
     "Rapier2d balls in a unit box (processor -> asemic/value/<id>.<channel> + asemic/gen/<id>).\n"
     "n: ball count (default 8.0). gravity: (default 1.0). restitution: (default 0.9). radius: (default 0.04).\n"
     "kick: (default 0.0). damping: (default 0.0). angular_damping: (default 0.0)."),
    ("wave", ["id", "energy", "k", "mass", "span"],
     "1D stationary Schrödinger (schrodinger_equation, Numerov) solver.\n"
     "energy: (default 0.5). k: (default 1.0). mass: (default 1.0). span: (default 5.0)."),
    ("spectrum", ["id", "input", "gain"],
     "FFT bands of input stream (processor -> asemic/value/<id>.<channel> + asemic/gen/<id>).\n"
     "input: key (io stream e.g. 'asemic/io/mic/in' / 'chaos:x'). gain: (default 1.0)."),
    ("glyph", ["id", "text", "size", "rotate", "spacing", "wobble", "speed", "scan", "x", "y", "attrs", "seed"],
     "Text as asemic font paths, scanned/wobbled by params.\n"
     "text: glyph text string. size: (default 0.08). rotate: (default 0.0). spacing: (default 0.15).\n"
     "wobble: (default 0.0). speed: (default 1.0). scan: (default 0.0). x: (default 0.5). y: (default 0.5)."),
    ("lsys", ["id", "axiom", "rules", "n", "angle", "step", "growth", "width", "x", "y", "turn", "input", "stride", "scale", "scale_by", "seed"],
     "L-system (symbios derivation + turtle), optionally rooted on input gen points.\n"
     "axiom: starting string (default 'F'). rules: string e.g. '0.5: F -> F[+F]F; ...'.\n"
     "n: iterations (default 4.0). angle: turning angle (default 25.0). step: (default 0.02).\n"
     "growth: (default 1.0). width: (default 1.0). stride: (default 1.0). scale: (default 1.0)."),
    ("text", ["id", "path", "text", "size", "tol", "x", "y"],
     "Text shaped (harfbuzz) in font path, outlines (skrifa) at axis params, flattened (lyon).\n"
     "path: font file path (hot reload). text: string. size: (default 0.2). tol: (default 0.001).\n"
     "x: (default 0.1). y: (default 0.6)."),
    ("melody", ["id", "voices", "base", "beats", "step", "slow", "seed"],
     "Seeded pentatonic walk: 1 line per voice, 1 point per note, dims pitch (MIDI) + dur (beats).\n"
     "voices: (default 2.0). base: MIDI note (default 72.0). beats: length (default 32.0).\n"
     "step: max degree steps per move (default 2.0). slow: octave step multiplier (default 2.0)."),
    ("py", ["id", "fn", "p", "input"],
     "Python proc evaluated in REPL: `py(id, fn=\"./fn\", p={...}, input=<gen>)` where block-scoped stringpath `fn` returns points.\n"
     "Brain queries params + input gen on change, caches reply."),
]

# Map argument names to schema types from `_types.py`
ARG_TYPE_MAP: dict[str, str] = {
    "mode": "AnimMode",
    "combine": "Combine",
    "curve": "Curve",
    "image": "ImageKind",
    "proc": "ProcKind",
    "gen": "NoiseKind | RandomizerKind",
    "kind": "TexKind | OutputKind",
    "brush": "BrushKind",
    "post": "PostKind",
    "loop": "LoopMode",
    "preview": "PreviewKind",
    "notes": "ScoreLayer | tuple[ScoreLayer, ...]",
    "names": "ScoreNames",
    "settings": "ScoreSettings",
    "input": "str",
    "id": "str",
    "fn": "str",
    "name": "str",
    "src": "str",
    "dst": "str",
    "bpm": "float",
    "timestretch": "float",
    "hz": "float",
    "w": "int",
    "h": "int",
}


def _extract_literals() -> dict[str, list[str]]:
    try:
        from asemic_py import _types
    except Exception:
        return {}
    out: dict[str, list[str]] = {}
    for name in dir(_types):
        obj = getattr(_types, name)
        val = getattr(obj, "__value__", obj)
        origin = typing.get_origin(val)
        args = typing.get_args(val)
        if origin is typing.Literal:
            out[name] = [str(a) for a in args]
        elif origin is typing.Union:
            sub = []
            for a in args:
                if typing.get_origin(a) is typing.Literal:
                    sub.extend([str(x) for x in typing.get_args(a)])
            if sub:
                out[name] = sub
    return out


def _sig(name: str, args: list[str]) -> str:
    if not args:
        return "**kwargs: Any"
    parts = []
    for a in args:
        t = ARG_TYPE_MAP.get(a, "Any")
        parts.append(f"{a}: {t} = ...")
    return ", ".join(parts) + ", **kwargs: Any"


def render(table: list) -> str:
    lines = [
        "# generated by scripts/gen_api.py from `asemic-brain --verbs`; do not edit.",
        "# Typed signatures for the livecode namespace. Injected (hidden) into the embedded",
        "# nvim row editor so an LSP completes every verb; see asemic_py/nvim_view.py.",
        "from __future__ import annotations",
        "",
        "from typing import Any",
        "from asemic_py._types import (",
        "    AdapterKind, AnimMode, BrushKind, Combine, Curve, ImageKind, IoDir, IoType,",
        "    LoopMode, NoiseKind, OutputKind, PostKind, PreviewKind, ProcKind,",
        "    RandomizerKind, ScoreLayer, ScoreSettings, TexKind,",
        ")",
        "",
    ]
    names: list[str] = []
    for name, args, doc in [*table, *PY_HELPERS]:
        names.append(name)
        lines.append(f"def {name}({_sig(name, list(args))}) -> Any:")
        lines.append("    " + json.dumps(str(doc or "")))
        lines.append("    ...")
        lines.append("")
    exported = ", ".join(f'"{n}"' for n in names)
    lines.append(f"__all__ = [{exported}]")
    lines.append("")
    return "\n".join(lines)


def build_metadata(table: list) -> dict[str, Any]:
    literals = _extract_literals()
    verbs: dict[str, Any] = {}
    for name, args, doc in [*table, *PY_HELPERS]:
        doc_str = str(doc or "")
        first_line = doc_str.split("\n")[0].strip()

        # Extract docstring kw: mentions
        kw_match = re.search(r"kw:\s*([^.\n]+)", doc_str)
        kw_doc = [re.sub(r"[^a-zA-Z0-9_]", "", w) for w in (kw_match.group(1).split() if kw_match else [])]
        kw_doc = [w for w in kw_doc if w]
        all_kwargs = list(dict.fromkeys(list(args) + kw_doc))

        # Build kwarg details with types & enum choices
        kwarg_meta: dict[str, dict[str, Any]] = {}
        for kw in all_kwargs:
            t = ARG_TYPE_MAP.get(kw)
            choices: list[str] = []
            if kw == "kind":
                if name == "tex":
                    t = "TexKind"
                    choices = literals.get("TexKind", [])
                elif name == "output":
                    t = "OutputKind"
                    choices = literals.get("OutputKind", [])
            elif t and t in literals:
                choices = literals[t]
            elif kw == "notes":
                choices = [c for c in literals.get("ScoreLayer", ["heads", "stems", "lines", "accidentals", "names"]) if c != "notes"]
            elif kw == "names":
                choices = literals.get("ScoreNames", ["pitchclass", "midi", "hz", "notename", "note"])
            elif kw == "settings":
                choices = ["{'spacing': 1.0, 'quarter_in': 0.25}", "{'spacing': 2.0}", "{'spacing': 0.5}"]
            elif kw == "gen":
                choices = (literals.get("NoiseKind", []) + literals.get("RandomizerKind", []))
            elif kw == "loop":
                choices = ["loop", "off", "pingpong"]
            elif kw == "preview":
                choices = ["dots", "image", "ascii"]

            kwarg_meta[kw] = {
                "type": t or "Any",
                "choices": sorted(set(choices)),
            }

        verbs[name] = {
            "name": name,
            "args": list(args),
            "kwargs": all_kwargs,
            "kwarg_meta": kwarg_meta,
            "synopsis": first_line,
            "doc": doc_str,
        }
    return {"literals": literals, "verbs": verbs}


def main(argv: list[str]) -> int:
    src = Path(argv[1]) if len(argv) > 1 else None
    table = json.loads(src.read_text() if src else sys.stdin.read())
    out_api = ROOT / "asemic_py" / "_api.pyi"
    out_api.write_text(render(table))

    out_meta = ROOT / "asemic_py" / "_verbs.json"
    meta = build_metadata(table)
    out_meta.write_text(json.dumps(meta, indent=2))
    print(f"ok: {out_api} + {out_meta} ({len(table)} verbs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
