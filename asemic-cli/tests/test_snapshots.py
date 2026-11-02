"""SVG snapshots of REPL states (pytest-textual-snapshot). Update: `uv run pytest tests/test_snapshots.py --snapshot-update`.
Stable: fixed size; status bar (clock) hidden, editor cursor blink off, non-test panels hidden."""

import re
import time

import pytest

from asemic_py import rig
from asemic_py.app import AsemicApp, BufferView, ComponentPanel, TexPanel
from asemic_py.client import Client
from asemic_py.columns import BlockColumns
from asemic_py.namespace import Repl
from asemic_py.points import encode_frame
from conftest import clear_test_state

SIZE = (140, 40)
SHADE = "fn shade(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }"


@pytest.fixture(scope="module")
def client():
    rig.ensure()
    c = Client()
    clear_test_state(c)
    yield c
    clear_test_state(c)
    c.close()


def snap(client, snap_compare, label: str, code: str, ready, after=None):
    """Eval block `label`, wait for `ready(app)`, mask time-varying/foreign content, compare."""
    body = "\n".join("    " + l for l in code.splitlines())
    app = AsemicApp(client=Client(), code=f'with block("{label}", timestretch="1.0"):\n{body}\n')

    async def run_before(pilot):
        app.query_one("#cols", BlockColumns).line.cursor_blink = False
        app.action_eval_all()  # `:run` (NORMAL enter = no-op)
        app.query_one("#cols", BlockColumns).enter_level()  # panels mount under their rows -> zoom in
        t0 = time.monotonic()
        while not ready(app) and time.monotonic() - t0 < 5:
            await pilot.pause(0.05)
        if after:
            await after(app, pilot)
        # panels render inline under their own row now (plan, 2026-10-10); hide any left over
        # from other tests' brain state the same way the old #controls filter did.
        for w in [*app.query(ComponentPanel), *app.query(TexPanel), *app.query(BufferView)]:
            w.display = "t_" in (w.id or "")
        # let the draw host render a few preview frames so a live tex/proc panel is not sampled
        # mid-blank (nodes render at PREVIEW_FPS; a 0.2s pause raced the first frame)
        await pilot.pause(0.6)

    try:
        return snap_compare(app, terminal_size=SIZE, run_before=run_before)
    finally:
        Repl(client).drop(label)  # app closed its own client on unmount


def test_snap_param_panel(client, snap_compare):
    assert snap(client, snap_compare, "t_sp", "param('t_sgain', 0, 2, default=1)", lambda a: bool(a.query("#comp-t_sp-t_sgain")))


def test_snap_tex_panel(client, snap_compare):
    assert snap(client, snap_compare, "t_st", f"tex('t_sn', kind='shader', w=64, h=64, publish='syphon', wesl='{SHADE}')",
                lambda a: bool(a.query("#tex-t_st-t_sn")))


def test_snap_eval_error(client, snap_compare):
    assert snap(client, snap_compare, "t_se", "1/0", lambda a: bool(a.query_one("#log").lines))


def test_snap_frame_view(client, snap_compare):
    w, h = 16, 8  # fixed gradient frame, put once the view subscribes
    rgba = bytes(v for y in range(h) for x in range(w) for v in (x * 16, y * 32, 128, 255))

    async def feed(app, pilot):
        await pilot.pause(0.3)
        client.session.put("asemic/preview/t_sf/t_sframe", encode_frame(w, h, rgba))
        view = app.query_one(BufferView)
        t0 = time.monotonic()
        while "▀" not in str(view.render()) and time.monotonic() - t0 < 3:
            await pilot.pause(0.05)

    assert snap(client, snap_compare, "t_sf", "embed('t_sframe')", lambda a: bool(a.query(BufferView)), feed)


def test_snap_ascii_view(client, snap_compare):
    w, h = 32, 16  # horizontal luma ramp -> ascii chars dark -> light
    rgba = bytes(v for y in range(h) for x in range(w) for v in (x * 8, x * 8, x * 8, 255))

    async def feed(app, pilot):
        await pilot.pause(0.3)
        client.session.put("asemic/preview/t_sa/t_sascii", encode_frame(w, h, rgba))
        view = app.query_one(BufferView)
        t0 = time.monotonic()
        while "@" not in str(view.render()) and "#" not in str(view.render()) and time.monotonic() - t0 < 3:
            await pilot.pause(0.05)

    assert snap(client, snap_compare, "t_sa", "embed('t_sascii', preview='ascii')", lambda a: bool(a.query(BufferView)), feed)


def test_snap_proc_attrs(client, snap_compare):
    """Proc panel: `attrs:` line = live point dims (x y + declared custom attrs)."""
    # wait for the live point line too (else snapshot races: with/without `value=... count=...`)
    ready = lambda a: any("hue" in str(w.render()) for w in a.query("#comp-t_sx-t_sattr .readout")) and any(
        "count=" in str(w.render()) for w in a.query("#comp-t_sx-t_sattr .readout-preview"))

    async def freeze(app, pilot):
        # live point samples (value=/x=/y=) drift frame to frame: mask numbers, stop updates
        for w in app.query("#comp-t_sx-t_sattr .readout-preview"):
            w.update(re.sub(r"[+-]?\d+\.\d+", "#", str(w.render())))
            w.update = lambda *a, **k: None

    assert snap(client, snap_compare, "t_sx", "proc('t_sattr', 'glyph', text='A', attrs={'width': 1.0, 'hue': 0.5})", ready, freeze)

