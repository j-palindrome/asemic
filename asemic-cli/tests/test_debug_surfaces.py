"""Debug surfaces for the complex end-to-end examples (physics-*, gpgpu-*, quantum-wave,
spectrum-to-physics, video-chain, demo): a TUI screenshot (block tree + an expanded component
panel, like conftest's failure-dump SVG) and, when a live brain answers, a rendered-frame PNG
of the example's own `asemic/preview/<node>` preview (demand-gated raster, §11.7.8/test_demo.py
`lit()` -- same key, decoded with the same `decode_frame`).

Opt-in (not part of the default suite): `pytest -m surfaces` or `ASEMIC_SURFACES=1`
(`scripts/surfaces.sh` sets the latter). Artifacts land in `tests/artifacts/<example>/`
(tui.svg always when the example loads; frame.png only when a frame arrives), gitignored.
"""

from __future__ import annotations

import asyncio
import os
import pathlib

import pytest

from asemic_py import rig
from asemic_py.app import AsemicApp, ComponentPanel, TexPanel
from asemic_py.blocks import Doc
from asemic_py.client import Client
from asemic_py.columns import BlockColumns
from asemic_py.namespace import labels_code
from asemic_py.points import decode_frame
from conftest import clear_test_state, namespaced_blocks, fresh_prefix

EXDIR = pathlib.Path(__file__).parent.parent / "examples"
ARTIFACTS = pathlib.Path(__file__).parent / "artifacts"
SIZE = (140, 40)

# example -> the `tex(..., publish="syphon")` node whose `asemic/preview/<node>` preview
# best represents it without needing an external app (TouchDesigner etc) to be live.
FRAME_NODE = {
    "gpgpu-field-to-points.py": "streaks",
    "gpgpu-life.py": "life_txt",
    "gpgpu-particles.py": "trails",
    "gpgpu-physics-hybrid.py": "sparks_ink",
    "gpgpu-reaction-diffusion.py": "field_view",
    "gpgpu-swarm.py": "trails",
    "physics-balls.py": "balls_txt",
    "physics-noise-coupled.py": "balls_txt",
    "plant.py": "plant_ink",
    "quantum-wave.py": "psi_txt",
    "spectrum-to-physics.py": "comp_txt",
    "type.py": "type_ink",
    "video-chain.py": "fx",  # needs a live Syphon/camera source @src; else skipped
}

# examples with >1 top-level block: only the self-contained block(s) needed to light FRAME_NODE.
BLOCK_SUBSET: dict[str, list[str]] = {}

EXAMPLES = sorted(FRAME_NODE)


def _surfaces_selected(config: pytest.Config) -> bool:
    if os.environ.get("ASEMIC_SURFACES") == "1":
        return True
    return "surfaces" in (config.getoption("markexpr") or "")


@pytest.fixture(autouse=True)
def _require_opt_in(request: pytest.FixtureRequest) -> None:
    if not _surfaces_selected(request.config):
        pytest.skip("opt-in: ASEMIC_SURFACES=1 or `pytest -m surfaces` (scripts/surfaces.sh)")


pytestmark = pytest.mark.surfaces


async def _save_tui_screenshot(name: str, src: str) -> pathlib.Path:
    """Load `src` into the Textual app, zoom into its first top-level block (so any mounted
    `ComponentPanel`/`TexPanel` renders inline under its row -- app.py's single-panel layout,
    MEMORY §1.1.3), run all blocks (Ctrl+R equivalent), and save an SVG of the result."""
    out_dir = ARTIFACTS / name
    out_dir.mkdir(parents=True, exist_ok=True)
    app = AsemicApp(client=Client(), code=src, run=True)

    async with app.run_test(size=SIZE) as pilot:
        cols = app.query_one("#cols", BlockColumns)
        cols.line.cursor_blink = False
        await pilot.pause(0.3)  # let _load() build rows + eval_all's panels mount
        if cols.path is not None and cols.doc.is_nest(cols.path):
            cols.enter_level()  # zoom into the first top-level block -> its panels visible
        await pilot.pause(0.5)
        panels = [*app.query(ComponentPanel), *app.query(TexPanel)]
        t0 = asyncio.get_event_loop().time()
        while not panels and asyncio.get_event_loop().time() - t0 < 3:
            await pilot.pause(0.1)
            panels = [*app.query(ComponentPanel), *app.query(TexPanel)]
        svg_path = out_dir / "tui.svg"
        app.save_screenshot(str(svg_path.name), path=str(out_dir))
    return svg_path


async def _grab_frame_png(client: Client, node: str, out_dir: pathlib.Path, secs: float = 6.0) -> tuple[pathlib.Path | None, str]:
    """Subscribe `asemic/preview/<node>` (demand-gated GPU readback, test_demo.py `lit()`
    pattern) and write the newest frame as a PNG. Returns (path or None, reason-if-none)."""
    frames: list[bytes] = []
    errs: list[str] = []
    sub = client.subscribe_raw(f"asemic/preview/{node}", lambda k, b: frames.append(b))
    try:
        t0 = asyncio.get_event_loop().time()
        while asyncio.get_event_loop().time() - t0 < secs and not frames:
            await asyncio.sleep(0.1)
    finally:
        sub.undeclare()
    if not frames:
        return None, "no frame arrived (no GPU/brain reachable, or node failed to build)"
    from PIL import Image

    f = decode_frame(frames[-1])
    out_dir.mkdir(parents=True, exist_ok=True)
    png_path = out_dir / "frame.png"
    Image.frombytes("RGBA", (f.w, f.h), f.rgba).save(png_path)
    return png_path, ""


@pytest.mark.parametrize("fname", EXAMPLES)
async def test_tui_screenshot(fname: str) -> None:
    src = (EXDIR / fname).read_text()
    name = fname[: -len(".py")]
    svg_path = await _save_tui_screenshot(name, src)
    assert svg_path.exists(), f"{fname}: tui.svg not written"
    print(f"{fname}: tui screenshot -> {svg_path}")


@pytest.mark.parametrize("fname", EXAMPLES)
async def test_frame_screenshot(fname: str) -> None:
    """Ids namespaced per test (prefix) -- debug_surfaces examples overlap test_demo.py's and
    each other's bare ids (e.g. "balls_txt"), so concurrent live-test runs don't collide on
    the brain's global component state."""
    prefix = fresh_prefix()
    rig.ensure()
    c = Client()
    clear_test_state(c, prefix)
    from asemic_py.namespace import Repl

    r = Repl(c)
    doc = Doc((EXDIR / fname).read_text())
    blocks = namespaced_blocks(doc, prefix)
    names = BLOCK_SUBSET.get(fname, list(blocks))
    node = prefix + FRAME_NODE[fname]
    out_dir = ARTIFACTS / fname[: -len(".py")]
    eval_errs = []
    try:
        for n in names:
            code = blocks.get(n, "")
            if not code.strip():
                continue
            out = r.run_block(prefix + n, code)
            if out:
                eval_errs.append(f"@{n}: {out.strip().splitlines()[-1] if out.strip() else out}")
        png_path, reason = await _grab_frame_png(c, node, out_dir)
        if png_path is None:
            tex0_hit = any("tex0" in e or "unresolved" in e.lower() or "unknown identifier" in e.lower() for e in eval_errs)
            extra = " (stale brain built from an old binary -- shader names predate `tex0`)" if tex0_hit else ""
            pytest.skip(f"{fname}: {reason}{extra}; eval errors: {eval_errs}" if eval_errs else f"{fname}: {reason}")
        print(f"{fname}: frame screenshot -> {png_path}")
    finally:
        for n in names:
            r.drop(prefix + n)
        clear_test_state(c, prefix)
        c.close()
