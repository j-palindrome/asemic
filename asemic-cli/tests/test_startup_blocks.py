"""Example-specific regression tests that aren't generic "does this example run" checks
(test_examples.py covers that): TD-skip-if-absent behavior (comp.py), JACK output behavior
(scope.py), font-LFO-sweep-over-time behavior (type.py). Needs zenohd + asemic-brain (rig)."""

import asyncio
from array import array
import pathlib

import pytest

from asemic_py import rig
from asemic_py.blocks import Doc
from asemic_py.client import Client
from asemic_py.namespace import Repl
from conftest import clear_test_state, namespaced_blocks, fresh_prefix, start_playing

EXDIR = pathlib.Path(__file__).parent.parent / "examples"


def _blocks(fname: str, prefix: str) -> dict[str, str]:
    return namespaced_blocks(Doc((EXDIR / fname).read_text()), prefix)


@pytest.fixture
def repl():
    prefix = fresh_prefix()
    rig.ensure()
    c = Client()
    clear_test_state(c, prefix)
    r = Repl(c)
    yield r, prefix
    clear_test_state(c, prefix)
    c.close()


async def test_comp_skips_without_td(repl):
    """@comp (comp.py) reads td (Syphon in) -> needs a live TouchDesigner server, else skipped."""
    r, prefix = repl
    blocks = _blocks("comp.py", prefix)
    try:
        out = r.run_block(prefix + "td", blocks["td"])
        if "not found" in out:
            pytest.skip("no TouchDesigner Syphon server (@td)")
        assert out == "", out
        out = r.run_block(prefix + "comp", blocks["comp"])
        assert out == "", out
    finally:
        for name in blocks:
            r.drop(prefix + name)


async def test_scope_jack_output(repl):
    """@scope (scope.py): JACK client asemic-scope exists with 2 out ports; buffer content
    needs a JACK capture client (jack_capture / python-jack) -> asserted only when python
    `jack` is importable."""
    r, prefix = repl
    blocks = _blocks("scope.py", prefix)
    try:
        for name, code in blocks.items():
            out = r.run_block(prefix + name, code)
            assert out == "", f"@{name}: {out}"
        outs = [o for o in r.ns["outputs"]() if o["name"] == "scope"]
        if not outs:
            pytest.skip("jackd not running")
        for _ in range(40):
            if outs[0].get("visible"):
                break
            await asyncio.sleep(0.05)
            outs = [o for o in r.ns["outputs"]() if o["name"] == "scope"]
        assert outs[0]["visible"], "JACK client asemic-scope not in graph"
        jack = pytest.importorskip("jack")
        cli = jack.Client("asemic-test-scope", no_start_server=True)
        inp = cli.inports.register("in")
        peak = [0.0]
        cli.set_process_callback(lambda n: peak.__setitem__(0, max(peak[0], max(map(abs, array("f", bytes(inp.get_buffer())))))))
        with cli:
            src = [p.name for p in cli.get_ports("asemic-scope:out_")]
            assert src, "no asemic-scope out ports"
            cli.connect(src[0], inp)
            for _ in range(30):
                await asyncio.sleep(0.1)
                if peak[0] > 1e-3:
                    break
        assert peak[0] > 1e-3, "scope buffer silent"
    finally:
        for name in blocks:
            r.drop(prefix + name)


async def test_type_lfo_sweeps_font_axis(repl):
    """@type (type.py): lfo -> route -> type_txt.ASMC (a proc param) -> the text outline moves."""
    r, prefix = repl
    blocks = _blocks("type.py", prefix)
    start_playing(r.c, *(prefix + n for n in blocks))
    try:
        out = r.run_block(prefix + "type", blocks["type"])
        assert out == "", out
        seen = set()
        for _ in range(30):
            await asyncio.sleep(0.1)
            seen |= {round(float(v), 2) for _, v in r.c.get(f"asemic/state/param/{prefix}type/{prefix}type_txt.ASMC")}
        assert len(seen) >= 3, f"ASMC not swept: {seen}"
    finally:
        for name in blocks:
            r.drop(prefix + name)
