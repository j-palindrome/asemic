"""Rust -> Python codegen drift checks (`scripts/gen_types.sh`; Rust side: crates/schema/tests/gen_python_wire.rs)."""

import hashlib
from pathlib import Path

import pytest

from asemic_py._keys import RESOLVE_CASES, SPACES
from asemic_py.app import _component_link, _key_label
from asemic_py.columns import resolve_path
from asemic_py.ids import display_path
from asemic_py.state import State

PY = Path(__file__).resolve().parent.parent / "asemic_py"


@pytest.mark.parametrize("label,ref,want", RESOLVE_CASES)
def test_resolve_path_matches_rust(label, ref, want):
    assert resolve_path(label, ref) == want


def test_display_paths_use_slashes_without_rewriting_link_targets():
    assert display_path("drawing/controls/gain") == "drawing/controls/gain"
    assert _key_label("asemic/value/drawing/controls/gain.value") == "drawing/controls/gain"

    link = _component_link("route:drawing/controls/gain~asemic/out/hue/intensity")
    assert "drawing/controls/gain~asemic/out/hue/intensity" in link
    assert "route:drawing/controls/gain~asemic/out/hue/intensity" in link


def test_types_generated_from_current_schema():
    sha = hashlib.sha256((PY / "_schema.json").read_bytes()).hexdigest()
    head = (PY / "_types.py").read_text().splitlines()[0]
    assert f"sha256={sha}" in head, "asemic_py/_types.py is stale: run scripts/gen_types.sh"


def test_api_stub_declares_every_verb():
    """`asemic_py/_api.pyi` (the embedded row editor's completion stub, injected as a hidden
    prelude) parses and exports the core livecode verbs + the Python-side helpers."""
    import ast

    tree = ast.parse((PY / "_api.pyi").read_text())
    defs = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
    for verb in ("param", "multi", "xy", "proc", "route", "tex", "output",
                 "block", "embed", "orca"):
        assert verb in defs, f"_api.pyi missing {verb!r}: run scripts/gen_types.sh"


def test_api_stub_matches_verb_table():
    """Regenerate the stub from the brain binary's verb table and compare (skips if unbuilt)."""
    import json
    import subprocess
    import sys

    from asemic_py import rig

    if not rig.BRAIN.exists():
        pytest.skip("asemic-brain not built")
    sys.path.insert(0, str(PY.parent / "scripts"))
    import gen_api  # noqa: E402

    out = subprocess.run([str(rig.BRAIN), "--verbs"], capture_output=True, text=True, check=True)
    want = gen_api.render(json.loads(out.stdout))
    assert (PY / "_api.pyi").read_text() == want, "asemic_py/_api.pyi is stale: run scripts/gen_types.sh"


def test_state_spaces_and_backlinks():
    s = State()
    assert set(s.spaces) == {n for n, *_ in SPACES}
    s.apply("component", "controls/noise/chaos_lfo", {"id": "controls/noise/chaos_lfo", "type": "noise", "gen": "chaos"})
    s.apply("component", "controls/arena", {"id": "controls/arena", "type": "xy", "anim": {"source": "controls/noise/chaos_lfo"}})
    s.apply("route", "r1", {"id": "r1", "src": "asemic/value/controls/noise/chaos_lfo.value", "dst": "asemic/out/hue/i"})
    assert s.backlinks("controls/noise/chaos_lfo") == ["controls/arena", "route:r1"]
    assert s.exists("controls/arena.x") and not s.exists("nope")
    s.apply("component", "controls/arena", None)
    assert s.backlinks("controls/noise/chaos_lfo") == ["route:r1"]
