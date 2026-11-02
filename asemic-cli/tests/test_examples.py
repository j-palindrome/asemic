"""Every file under examples/: each parses via the blocks loader (always), and when the brain
is up (rig.ensure()) each evals cleanly against a live rig. Per-stem expectation dicts add
custom checks (tex ids present, a noise/physics proc emits a finite value) on top of the
generic eval tier -- same pattern the examples_* files this replaces used individually.

Consolidates test_demo.py, test_examples_gpgpu.py, test_examples_physics.py and
test_examples_video.py's generic "does this example run" coverage into one parametrized
suite over examples/*.py. Example-specific regression tests that aren't generic run checks
(TD-skip, JACK capture, font-LFO sweep) live in test_startup_blocks.py instead."""

import asyncio
import pathlib

import pytest

from asemic_py import rig
from asemic_py.blocks import Doc
from asemic_py.client import Client
from asemic_py._wire import F_HEAD, T_MAGIC
from asemic_py.namespace import Repl, labels_code
from conftest import clear_test_state, namespaced_blocks, fresh_prefix, start_playing

EXDIR = pathlib.Path(__file__).parent.parent / "examples"
EXAMPLES = sorted(EXDIR.glob("*.py"))

# block -> set of (block, tex_id) pairs expected in texs() after a clean eval.
EXPECTED_TEX_IDS: dict[str, set[tuple[str, str]]] = {
    "gpgpu-particles.py": {("gpgpu", "particles"), ("gpgpu", "trails")},
    "gpgpu-reaction-diffusion.py": {("gpgpu", "field"), ("post", "edges"), ("post", "field_view")},
    "gpgpu-life.py": {("gpgpu", "life"), ("view", "life_txt")},
    "gpgpu-field-to-points.py": {("gpgpu", "flow"), ("gpgpu", "advect"), ("gpgpu", "streaks")},
    "gpgpu-physics-hybrid.py": {("balls", "balls_ink"), ("gpgpu", "sparks"), ("gpgpu", "sparks_ink")},
    "gpgpu-swarm.py": {("gpgpu", "swarm"), ("gpgpu", "trails")},
}

# fname -> proc id whose asemic/value/<id>.value channel should carry a finite `value` after eval.
EXPECTED_NOISE_PROC: dict[str, str] = {
    "physics-balls.py": "balls",
    "physics-noise-coupled.py": "balls",
    "quantum-wave.py": "psi",
    "spectrum-to-physics.py": "balls",
}

# fname -> {block: [tex nodes that should show lit preview pixels after running that block]}
EXPECTED_LIT_NODES: dict[str, dict[str, list[str]]] = {
    "plant.py": {"plant": ["plant_ink", "plant_txt", "bush_ink", "bush_txt"]},
    "gpgpu-swarm.py": {"gpgpu": ["trails"]},
    "type.py": {"type": ["type_ink", "type_ascii"]},
}


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.stem)
def test_example_parses(path):
    """labels_code walks the block tree without error and yields non-empty code for every block."""
    doc = Doc(path.read_text())
    blocks = labels_code(doc)
    assert blocks, f"{path.name}: no blocks parsed"
    assert any(code.strip() for code in blocks.values()), f"{path.name}: all blocks empty"


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


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.stem)
async def test_example_evals(repl, path):
    """Ids namespaced per test (prefix) -- examples share bare ids (e.g. "balls", "word")
    so concurrent live-test runs don't collide on the brain's global component state."""
    r, prefix = repl
    doc = Doc(path.read_text())
    blocks = namespaced_blocks(doc, prefix)
    # blocks default frozen: a dependent draw/tex block would stall querying attrs from an
    # unplaying proc, so start every label playing before running any of them.
    start_playing(r.c, *(prefix + name for name in blocks))
    try:
        for name, code in blocks.items():
            if not code.strip():
                continue
            out = r.run_block(prefix + name, code)
            if "Syphon server" in out and "not found" in out:
                pytest.skip(f"{path.name}@{name}: no TouchDesigner Syphon server")
            assert out == "", f"{path.name}@{name}: {out}"
    finally:
        for name in blocks:
            r.drop(prefix + name)


@pytest.mark.parametrize("fname,expected", EXPECTED_TEX_IDS.items())
async def test_example_tex_ids(repl, fname, expected):
    r, prefix = repl
    doc = Doc((EXDIR / fname).read_text())
    blocks = namespaced_blocks(doc, prefix)
    start_playing(r.c, *(prefix + name for name in blocks))
    try:
        for name, code in blocks.items():
            out = r.run_block(prefix + name, code)
            assert out == "", f"{fname}@{name}: {out}"
        ids = {n["id"] for n in r.ns["texs"]()}
        want = {f"{prefix}{block}/{prefix}{e}" for block, e in expected}
        missing = want - ids
        assert not missing, f"{fname}: nodes not in texs(): {missing} (have {ids})"
    finally:
        for name in blocks:
            r.drop(prefix + name)


@pytest.mark.parametrize("fname,proc_id", EXPECTED_NOISE_PROC.items())
async def test_example_proc_emits(repl, fname, proc_id):
    """Poll asemic/value/<proc_id>.value for a finite number -- confirms the proc component
    built and is stepping (proc.rs Gen::step)."""
    r, prefix = repl
    doc = Doc((EXDIR / fname).read_text())
    blocks = namespaced_blocks(doc, prefix)
    start_playing(r.c, *(prefix + name for name in blocks))
    for name, code in blocks.items():
        if not code.strip():
            continue
        out = r.run_block(prefix + name, code)
        assert out == "", f"{fname}@{name}: {out}"
    qual = f"/{prefix}{proc_id}"
    try:
        value = None
        for _ in range(50):
            rows = r.c.get("asemic/value/**/$*.value")
            hit = next((v for k, v in rows
                        if k.removeprefix("asemic/value/").removesuffix(".value").endswith(qual)
                        and isinstance(v, (int, float))), None)
            if hit is not None:
                value = hit
                break
            await asyncio.sleep(0.1)
        assert isinstance(value, (int, float)) and value == value, (
            f"{fname}: asemic/value/**{qual}.value not a finite number: {value!r}"
        )
    finally:
        for name in blocks:
            r.drop(prefix + name)


async def _lit(client, node: str, secs: float = 6.0, thresh: int = 32) -> int:
    """Max count of lit pixels across preview frames of tex node `node`."""
    from asemic_py.points import decode_frame
    frames = []
    sub = client.subscribe_raw(f"asemic/preview/{node}", lambda k, b: frames.append(b))
    best, loop = 0, asyncio.get_running_loop()
    t0 = loop.time()
    try:
        while loop.time() - t0 < secs and best < 200:
            await asyncio.sleep(0.1)
            for b in frames[-3:]:
                if b[:4] == T_MAGIC:  # ascii node: lit = non-blank glyphs
                    best = max(best, sum(not c.isspace() for c in b[F_HEAD.size:].decode("utf-8", "replace")))
                    continue
                f = decode_frame(b)
                best = max(best, sum(1 for y in range(f.h) for x in range(f.w) if max(f.pixel(x, y)[:3]) > thresh))
    finally:
        sub.undeclare()
    return best


@pytest.mark.parametrize(
    "fname,block,nodes",
    [(fname, block, nodes) for fname, by_block in EXPECTED_LIT_NODES.items()
     for block, nodes in by_block.items()],
)
async def test_example_lights_pixels(repl, fname, block, nodes):
    r, prefix = repl
    doc = Doc((EXDIR / fname).read_text())
    blocks = namespaced_blocks(doc, prefix)
    start_playing(r.c, *(prefix + name for name in blocks))
    try:
        out = r.run_block(prefix + block, blocks[block])
        assert out == "", f"{fname}@{block}: {out}"
        for n in nodes:
            px = await _lit(r.c, f"{prefix}{block}/{prefix}{n}")  # tex ids are block-qualified
            assert px >= 8, f"{fname}@{block}: {n} preview dark"
    finally:
        for name in blocks:
            r.drop(prefix + name)
