"""REPL tests (plan §13.3). Need zenohd + asemic-brain; fixture brings them up via rig.ensure()."""

import asyncio
import time

import pytest

from asemic_py import canvas, rig
from conftest import clear_test_state, start_playing
from asemic_py.app import AsemicApp, BufferView, ComponentPanel, TexPanel
from asemic_py.client import Client
from asemic_py.columns import BlockColumns
from asemic_py.namespace import Repl
from asemic_py.points import decode_frame, decode_points, encode_frame, encode_points


def block_code(label: str, body: str) -> str:
    """`with block("label", timestretch="1.0"):` nest w/ `body` (1+ lines) indented 4sp — the
    live test fixture shape. Blocks default to frozen (§2.4.4); the tests want them running."""
    return f'with block("{label}", timestretch="1.0"):\n' + "\n".join("    " + l for l in body.splitlines()) + "\n"


# ---------------------------------------------------------------- pure

def test_points_roundtrip_and_braille():
    lines = [[(0.0, 0.0), (1.0, 1.0)], [(0.0, 1.0), (1.0, 0.0)]]
    p = decode_points(encode_points(lines, frame=7))
    assert p.frame == 7 and p.polylines() == lines
    rows = canvas.braille(p, 10, 5)
    assert len(rows) == 5 and all(len(r) == 10 for r in rows)
    assert rows[0][0] != "⠀" and rows[0][-1] != "⠀"  # both diagonals reach corners
    # multiarray attrs (lsys width/depth) roundtrip; braille reads x, y only
    m = decode_points(encode_points([[(0.0, 0.0, 2.0), (1.0, 1.0, 3.0)]], attrs=("x", "y", "width")))
    assert m.attrs == ("x", "y", "width") and m.column("width") == [[2.0, 3.0]]
    assert m.polylines() == [[(0.0, 0.0), (1.0, 1.0)]]


def test_ascii_canvas_maps_luma_to_chars():
    w, h = 32, 8
    rgba = bytes(v for y in range(h) for x in range(w) for v in ((255,) * 3 if x >= w // 2 else (0,) * 3) + (255,))
    rows = canvas.ascii(decode_frame(encode_frame(w, h, rgba)), 20, 4)
    first = rows.splitlines()[0]
    assert first[:3].strip() == "" and first[-3:].strip() != ""


def test_frame_halfblocks():
    rgba = bytes([255, 0, 0, 255] * 2 + [0, 0, 255, 255] * 2)  # 2x2: red top, blue bottom
    f = decode_frame(encode_frame(2, 2, rgba))
    t = canvas.halfblocks(f, 2, 1)
    assert t.plain == "▀▀"
    assert "255,0,0" in str(t.spans[0].style.color.triplet.rgb) or t.spans[0].style.color.triplet == (255, 0, 0)


# ---------------------------------------------------------------- live

@pytest.fixture(scope="module")
def client():
    rig.ensure()  # respawns a stale brain (lock held, no verbs reply)
    c = Client()
    clear_test_state(c)
    yield c
    clear_test_state(c)
    c.close()


def stored(c: Client, key: str):
    return c.get(key)


async def settle(pilot, cond, timeout=3.0):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        await pilot.pause(0.05)
        if cond():
            return True
    return False


async def test_param_appears_and_drop_removes(client):
    app = AsemicApp(client=Client(), code=block_code("t_a", "param('t_gain', 0, 2, default=1)"))
    async with app.run_test(size=(140, 40)) as pilot:
        app.action_eval_all()  # `:run` (NORMAL enter = no-op)
        app.query_one(BlockColumns).enter_level()  # panel mounts under its row -> zoom in to see it
        assert await settle(pilot, lambda: bool(app.query("#comp-t_a-t_gain")))
        assert stored(client, "asemic/state/component/t_a/t_gain")
        app.repl.drop("t_a")
        assert await settle(pilot, lambda: not app.query("#comp-t_a-t_gain"))
        assert not stored(client, "asemic/state/component/t_a/t_gain")
        assert not stored(client, "asemic/state/session/t_a")


async def test_tex_node_panel_sinks_and_preview(client):
    """Brain pushes node state -> TexPanel with sinks; preview switch -> frames (matching)."""
    code = block_code("t_tx", "tex('t_n', kind='shader', w=64, h=64, publish='syphon', wesl='fn shade(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }')")
    app = AsemicApp(client=Client(), code=code)
    async with app.run_test(size=(140, 40)) as pilot:
        app.action_eval_all()  # `:run` (NORMAL enter = no-op)
        app.query_one(BlockColumns).enter_level()  # panel mounts under its row -> zoom in to see it
        assert await settle(pilot, lambda: bool(app.query("#tex-t_tx-t_n")))
        text = " ".join(str(w.render()) for w in app.query("#tex-t_tx-t_n Static"))
        assert "[shader]" in text and "asemic:t_tx/t_n (" in text, text
        # preview always on, inline in the panel (!switch)
        assert await settle(pilot, lambda: bool(app.query("#tex-t_tx-t_n BufferView")))
        view = app.query_one("#tex-t_tx-t_n BufferView")
        assert await settle(pilot, lambda: getattr(view.body, "image", None) is not None, timeout=5.0)  # frame body = textual_image (!text)
        app.repl.drop("t_tx")
        assert await settle(pilot, lambda: not app.query("#tex-t_tx-t_n") and not app.query(BufferView))
        assert not stored(client, "asemic/state/tex/t_n")


async def test_reeval_prunes_and_typing_is_safe(client):
    app = AsemicApp(client=Client(), code=block_code("t_b", "param('t_one')\nparam('t_two')"))
    async with app.run_test(size=(140, 40)) as pilot:
        col = app.query_one(BlockColumns)
        app.action_eval_all()  # `:run` (NORMAL enter = no-op)
        col.enter_level()  # panels mount under their rows -> zoom in to see them
        assert await settle(pilot, lambda: len(app.query("#comp-t_b-t_one")) > 0 and len(app.query("#comp-t_b-t_two")) > 0)
        # delete t_two's row, re-eval the nest -> brain prunes what it stopped creating
        await pilot.press("down", "home", "ctrl+k")
        assert "param('t_two')" not in app.doc.code
        await pilot.press("home", "left")
        app.action_eval_all()  # re-eval (`:run`)
        col.enter_level()  # back in t_b -> re-check panels mounted under their (remaining) rows
        assert await settle(pilot, lambda: len(app.query("#comp-t_b-t_two")) == 0)
        assert app.query("#comp-t_b-t_one")
        # letters typed in the row input land there, not on app-wide hotkeys
        await pilot.press("down")  # already in t_b (above) -> onto the new-row slot
        assert col.path is None
        await pilot.press("i", "a", "s", "d", "q")  # NORMAL: `i` -> INSERT first
        assert "asdq" in col.line.text
        assert col.line.has_focus
        app.repl.drop("t_b")


async def test_xy_moves_with_chaos_without_input(client):
    code = block_code("t_c", "noise('t_chaos', 'chaos')\nxy('t_arena', anim='t_chaos')")
    app = AsemicApp(client=Client(), code=code)
    async with app.run_test(size=(140, 40)) as pilot:
        app.action_eval_all()  # `:run` (NORMAL enter = no-op)
        app.query_one(BlockColumns).enter_level()  # panels mount under their rows -> zoom in to see them
        assert await settle(pilot, lambda: bool(app.query("#pad-t_c-t_arena")))
        pad = app.query_one("#pad-t_c-t_arena")
        first = (pad.val_x, pad.val_y)
        assert await settle(pilot, lambda: (pad.val_x, pad.val_y) != first)
        def readout():
            ps = app.query("#comp-t_c-t_chaos")
            return bool(ps) and ps.first().readout is not None and "vx=" in str(ps.first().readout.render())
        assert await settle(pilot, readout)
        app.repl.drop("t_c")


async def test_route_through_brain(client):
    repl = Repl(Client())
    out = repl.run_block("t_d", "param('t_int', 0.1, 2.5, default=1)\nroute('t_int', 't_hue.bri', frm=(0.1, 2.5), to=(0, 254))\nset('t_int', 2.5)\n")
    assert out == ""
    got = None
    for _ in range(40):  # late joiner: brain answers get on asemic/out/**
        r = client.get("asemic/out/t_hue/bri", timeout=0.5)
        got = r[0][1] if r else None
        if got == 254.0:
            break
        await asyncio.sleep(0.05)
    assert got == 254.0
    repl.drop("t_d")


async def test_terminal_view_renders_points(client):
    app = AsemicApp(client=Client(), code=block_code("t_e", "embed('t_stream')"))
    async with app.run_test(size=(140, 40)) as pilot:
        app.action_eval_all()  # `:run` (NORMAL enter = no-op)
        app.query_one(BlockColumns).enter_level()
        assert await settle(pilot, lambda: bool(app.query(BufferView)))
        await pilot.pause(0.2)
        # embed ids resolve block-relative (§1.3.5); a non-proc node's preview = raster frame
        view = app.query_one(BufferView)
        assert (view.stream, view.kind) == ("t_e/t_stream", "frame")
        assert app.query("EmbedView .title")  # jump link row


async def test_view_row_reeval_reuses_widget_no_duplicate_id(client):
    """Re-evaluating an `embed(...)` row (e.g. editing another row in the same nest, Ctrl+R)
    used to remount a same-id `BufferView` while the old one's removal was still pending,
    raising `DuplicateIds` (J, 2026-10-10 screenshot)."""
    app = AsemicApp(client=Client(), code=block_code("t_g", "embed('t_g_stream')"))
    async with app.run_test(size=(140, 40)) as pilot:
        app.action_eval_all()  # `:run` (NORMAL enter = no-op)
        app.query_one(BlockColumns).enter_level()
        assert await settle(pilot, lambda: bool(app.query(BufferView)))
        app.action_eval_all()  # re-eval same nest -> _request_view called again, same id
        await pilot.pause(0.2)
        app.action_eval_all()
        await pilot.pause(0.2)
        assert len(app.query(BufferView)) == 1


async def test_tex_panel_rapid_update_no_duplicate_id(client):
    """Two `asemic/state/tex/<id>` puts landing in the same `_tick` batch (e.g. a node's
    `sinks` changing right after its def) used to remove+remount `#tex-<id>` synchronously,
    raising `DuplicateIds` when the second update's mount raced the first's still-pending
    removal (same hazard as `test_view_row_reeval_reuses_widget_no_duplicate_id`, found while
    investigating J's 2026-10-10 'preview doesn't render' report)."""
    app = AsemicApp(client=Client(), code=block_code("t_h", "tex('t_h', kind='shader', w=64, h=64, wesl='fn shade(uv: vec2f) -> vec4f { return vec4f(uv, 0.0, 1.0); }')"))
    async with app.run_test(size=(140, 40)) as pilot:
        app.action_eval_all()  # `:run` (NORMAL enter = no-op)
        app.query_one(BlockColumns).enter_level()
        assert await settle(pilot, lambda: bool(app.query("#tex-t_h-t_h")))
        base = dict(stored(client, "asemic/state/tex/t_h/t_h")[0][1])
        # two differing versions of the same node def, queued before `_tick` next drains
        app._on_state("tex", "t_h/t_h", {**base, "live": True})
        app._on_state("tex", "t_h/t_h", {**base, "live": False})
        await pilot.pause(0.3)  # would have raised DuplicateIds pre-fix
        assert len(app.query(TexPanel)) == 1
        app.repl.drop("t_h")


async def test_eval_error_is_reported_not_raised(client):
    app = AsemicApp(client=Client(), code=block_code("t_f", "1/0"))
    async with app.run_test(size=(140, 40)) as pilot:
        app.action_eval_all()  # `:run` (NORMAL enter = no-op)
        await pilot.pause(0.1)
        log = "\n".join(str(l) for l in app.query_one("#log").lines)
        assert "ZeroDivisionError" in log


def test_brain_validates_helpers(client):
    """Helpers are built in Rust (verbs.rs): typos/bad values come back as errors, nothing stored."""
    repl = Repl(Client())
    out = repl.run_block("t_g", "param('t_bad', mx=2)\n")
    assert "unexpected argument" in out and "mx" in out
    assert not stored(client, "asemic/state/component/t_g/t_bad")
    out = repl.run_block("t_g", "noise('t_n', 'nope')\n")
    assert "nope" in out
    repl.drop("t_g")


async def test_processors_publish_channels_and_points(client):
    """Physics/wave/spectrum run in the brain; spectrum reads an asemic/io stream."""
    import math, struct
    repl = Repl(Client())
    out = repl.run_block("t_h", "proc('t_phys', 'physics', n=4)\nproc('t_wave', 'wave')\nproc('t_spec', 'spectrum', 'asemic/io/t_mic/in')\n")
    assert out == "", out
    start_playing(client, "t_h")  # blocks default frozen (§2.4.4); the procs must step
    got = {}
    client.subscribe_raw("asemic/gen/t_h/*", lambda k, b: got.__setitem__(k, b))
    tone = struct.pack("<256f", *(math.sin(2 * math.pi * 64 * i / 256) for i in range(256)))
    spec = None
    for _ in range(60):
        client.session.put("asemic/io/t_mic/in", tone)
        await asyncio.sleep(0.05)
        r = client.get("asemic/value/t_h/t_spec.$*", timeout=0.5)
        spec = {k.rsplit(".", 1)[1]: v for k, v in r} if r else None
        if spec and spec["high"] > spec["low"] and len(got) == 3:
            break
    assert spec and spec["high"] > spec["low"], spec
    assert set(got) == {"asemic/gen/t_h/t_phys", "asemic/gen/t_h/t_wave", "asemic/gen/t_h/t_spec"}
    assert len(decode_points(got["asemic/gen/t_h/t_phys"]).polylines()) == 4
    assert client.get("asemic/value/t_h/t_wave.x")[0][1] != 0
    repl.drop("t_h")


async def test_lsys_sprouts_from_glyph(client):
    """glyph -> lsys(input=<gen id>): every stride-th glyph point roots a tree; multiarray attrs on the wire."""
    repl = Repl(Client())
    out = repl.run_block("t_l", "proc('t_lg', 'glyph', text='I', size=.2, attrs={'hue': 0.25})\n"
                                "proc('t_ls', 'lsys', input='t_lg', axiom='F', rules='0.5: F -> F[+F]F; 0.5: F -> F[-F]F', n=2, stride=2)\n")
    assert out == "", out
    start_playing(client, "t_l")  # frozen glyph/lsys publish nothing
    frames = []
    client.subscribe_raw("asemic/gen/t_l/t_ls", lambda k, b: frames.append(b))
    for _ in range(40):
        await asyncio.sleep(0.05)
        if frames and decode_points(frames[-1]).lines():
            break
    p = decode_points(frames[-1])
    # lsys inherits the root point's dims (custom `hue` declared on the glyph) and appends its own
    assert p.attrs == ("x", "y", "hue", "width", "depth", "root"), p.attrs
    assert {h for line in p.column("hue") for h in line} == {0.25}
    procs = repl.procs()
    assert procs["t_l/t_lg"]["attrs"] == {"hue": 0.25} and procs["t_l/t_ls"]["dims"] == list(p.attrs), procs
    assert len({r for line in p.column("root") for r in line}) >= 2, "several rooted trees"
    assert client.get("asemic/value/t_l/t_ls.depth"), "channels derived from the arrays"
    repl.drop("t_l")


async def test_glyph_node_wired_from_physics(client):
    """Node flow: physics energy channel -> route -> glyph wobble; glyph = asemic-repl font paths."""
    repl = Repl(Client())
    out = repl.run_block("t_g", "proc('t_ball', 'physics', n=6, kick=8)\n"
                                "proc('t_gl', 'glyph', text='AB', size=.1)\n"
                                "route('t_ball:energy', 't_gl.wobble', frm=(-1, 1), to=(.5, 2))\n")
    assert out == "", out
    start_playing(client, "t_g")  # frozen glyph publishes no points
    frames = []
    client.subscribe_raw("asemic/gen/t_g/t_gl", lambda k, b: frames.append(b))
    for _ in range(40):
        await asyncio.sleep(0.05)
        if len({bytes(f) for f in frames}) >= 3:
            break
    assert frames, "glyph published no points"
    lines = decode_points(frames[-1]).polylines()
    assert len(lines) >= 4, len(lines)
    assert len({bytes(f) for f in frames}) >= 3, "routed wobble should move the glyph"
    # draw prep: output draws the glyph gen through the asemic-repl line brush
    out = repl.run_block("t_g2", "print(output('t_gout', w=64, h=64, src='t_gl', post='feedback')['post'])\n")
    assert "feedback" in out, out
    out = repl.run_block("t_g2", "print(output('t_gout', src='t_gl', brush='dot', width='return 3.0;')['look'])\n")
    assert "'dot'" in out and "return 3.0;" in out, out
    out = repl.run_block("t_g2", "output('t_gout', src='t_gl', width='return nope;')\n")
    assert "shader modifier" in out, out
    assert any(o["name"] == "t_gout" for o in repl.ns["outputs"]()), "failed reopen must keep old output"
    out = repl.run_block("t_g2", "print(output('t_gaud', 'jack', src='t_gl', hz=80)['look']['hz'])\n")
    assert "80" in out, out
    repl.drop("t_g2")
    repl.drop("t_g")


def _wait_visible(repl, name: str, want: bool = True) -> list:
    """Visibility = brain's own view (Syphon directory / JACK graph) via outputs(); announces lag."""
    outs = []
    for _ in range(30):
        outs = repl.ns["outputs"]()
        if any(o["name"] == name and o["visible"] for o in outs) == want:
            break
        time.sleep(0.1)
    return outs


async def test_output_request_response_and_block_ownership(client):
    """output() = request/response to brain; Syphon server appears; dropping the block closes it."""
    repl = Repl(Client())
    out = repl.run_block("t_i", "info = output('t_out', w=64, h=64)\nprint(info['server'])\n")
    assert "asemic:t_out" in out, out
    assert any(o["name"] == "t_out" and o["visible"] for o in _wait_visible(repl, "t_out")), "Syphon server not discoverable"
    out = repl.run_block("t_i", "output('t_bad', 'nope')\n")
    assert "unknown output kind" in out
    repl.drop("t_i")
    assert not any(o["name"] == "t_out" for o in repl.ns["outputs"]())


async def test_jack_output_request_response(client):
    """kind=jack = JACK client asemic-<name> with w channels; visible in JACK graph; drop closes."""
    repl = Repl(Client())
    out = repl.run_block("t_a", "info = output('t_snd', 'jack', w=2)\nprint(info['server'])\n")
    assert "asemic-t_snd" in out, out
    assert any(o["name"] == "t_snd" and o["visible"] for o in _wait_visible(repl, "t_snd"))
    repl.drop("t_a")
    assert not any(o["name"] == "t_snd" for o in repl.ns["outputs"]())


async def test_terminal_view_frames_on_demand(client):
    """asemic/preview/<out>: brain streams downsampled RGBA only while subscribed (Zenoh matching)."""
    repl = Repl(Client())
    out = repl.run_block("t_tv", "proc('t_tvg', 'glyph', text='A', size=.3)\n"
                                 "output('t_tvo', w=320, h=180, src='t_tvg')\n")
    assert out == "", out
    start_playing(client, "t_tv")  # frozen glyph -> empty points -> black preview
    frames = []
    sub = client.subscribe_raw("asemic/preview/t_tvo", lambda k, b: frames.append(b))
    for _ in range(40):
        await asyncio.sleep(0.05)
        if len(frames) >= 2:
            break
    assert frames, "no preview frames while subscribed"
    f = decode_frame(frames[-1])
    assert (f.w, f.h) == (160, 90), (f.w, f.h)
    assert sum(1 for y in range(f.h) for x in range(f.w) if max(f.pixel(x, y)) > 32) > 10, "glyph not visible in preview"
    sub.undeclare()
    await asyncio.sleep(0.3)
    n = len(frames)
    await asyncio.sleep(0.5)
    assert len(frames) == n, "frames must stop when nobody subscribes"
    repl.drop("t_tv")


async def _gen(client, stream: str, pred, secs: float = 3.0):
    """Latest decoded asemic/gen/<stream> frame satisfying pred (None on timeout)."""
    frames = []
    client.subscribe_raw(f"asemic/gen/{stream}", lambda k, b: frames.append(b))
    t0 = time.monotonic()
    while time.monotonic() - t0 < secs:
        await asyncio.sleep(0.03)
        if frames and pred(p := decode_points(frames[-1])):
            return p
    return None


async def test_vfont_over_zenoh_live(client, tmp_path):
    """glyph masters -> vfont() (announced at asemic/state/vfont/<name>) -> text(path=) gets
    points; live=True: a master param change rebuilds and the outline follows within 1 s."""
    repl = Repl(Client())
    code = (f"proc('t_vm1', 'glyph', text='A', stroke=30, seed=1)\n"
            f"proc('t_vm2', 'glyph', text='A', stroke=90, seed=1)\n"
            f"vfont('t_vf', ['t_vm1', 't_vm2'], chars='AB', dir={str(tmp_path)!r}, live=True, hz=20)\n"
            f"proc('t_vt', 'text', text='AB', path={str(tmp_path / 't_vf.ttf')!r})\n")
    assert repl.run_block("t_v", code) == ""
    start_playing(client, "t_v")  # frozen glyph masters -> the vfont never builds
    ann = dict(client.get("asemic/state/vfont/t_vf"))["asemic/state/vfont/t_vf"]
    assert ann["axis"] == "ASMC" and ann["masters"] == ["t_v/t_vm1", "t_v/t_vm2"] and ann["path"].endswith("t_vf.ttf")
    before = await _gen(client, "t_v/t_vt", lambda p: bool(p.lines()))
    assert before is not None, "text proc draws the vfont"
    t0 = time.monotonic()
    repl.ns["set"]("t_v/t_vm1", "stroke", 200)
    after = await _gen(client, "t_v/t_vt", lambda p: p.polylines() != before.polylines(), secs=1.0)
    assert after is not None, "live rebuild -> hot reload within 1 s"
    print(f"live vfont round trip {time.monotonic() - t0:.2f}s")
    repl.drop("t_v")


def test_block_scoped_param_qualification(client):
    """Within block `plant`, param ids scope to the block: `angle` -> `plant/angle`, `plant/height` -> `plant/plant/height`."""
    repl = Repl(Client())
    code = (
        "proc('plant', 'lsys', axiom='F', rules='F -> F[+F]F')\n"
        "param('angle', 0, 180, default=45)\n"
        "param('plant/height', 0, 100, default=50)\n"
    )
    out = repl.run_block("plant", code)
    assert out == "", out
    st = stored(client, "asemic/state/component/plant/angle")
    assert st and st[0][1]["id"] == "plant/angle" and st[0][1]["default"] == 45.0
    st = stored(client, "asemic/state/component/plant/plant/height")
    assert st and st[0][1]["id"] == "plant/plant/height"
    repl.drop("plant")


def test_block_scoped_route_relative_scoping(client):
    """Within block `plant`, bare route dst scopes to the block: `angle` -> `plant/angle` (dst_key: asemic/out/plant/angle/value, cf. brain verbs::tests)."""
    repl = Repl(Client())
    code = (
        "noise('chaos', 'chaos')\n"
        "proc('plant', 'lsys', axiom='F', rules='F -> F[+F]F')\n"
        "route('chaos:vx', 'angle')\n"
    )
    out = repl.run_block("plant", code)
    assert out == "", out
    routes = dict(client.get("asemic/state/route/**"))
    found = [r for r in routes.values() if "chaos" in r.get("src", "") and "plant" in r.get("dst", "")]
    assert len(found) >= 1
    assert found[0]["dst"] == "asemic/out/plant/angle/value"
    repl.drop("plant")


def test_block_scoped_row_anchor_matches_ui():
    """row_anchor with parent label matches the qualified ID used by anchor_widget."""
    from asemic_py.columns import anchor_id, row_anchor
    assert row_anchor("param('angle', 0, 180)", "plant") == anchor_id("param", "plant.angle")
    assert row_anchor("xy('pos', (-1, 1), (-1, 1))", "plant") == anchor_id("xy", "plant.pos")
    assert row_anchor("output('screen')", "plant") == anchor_id("output", "plant.screen")
    assert row_anchor("affinity('score', 'motif')", "plant") == anchor_id("affinity", "plant.score")
    assert row_anchor("param('plant.angle', 0, 180)", "plant") == anchor_id("param", "plant.plant.angle")  # scoped: relative
    assert row_anchor("param('plant', 0, 1)", "plant") == anchor_id("param", "plant.plant")
    assert row_anchor("param('/plant', 0, 1)", "plant") == anchor_id("param", "plant")  # absolute
    assert row_anchor("param('gain', 0, 1)", "main") == anchor_id("param", "gain")


async def test_inline_row_preview_mounts_without_embed():
    """output(...) and affinity(...) rows automatically mount an inline BufferView preview in their RowBox."""
    from asemic_py.app import AsemicApp, BufferView
    from asemic_py.client import Client
    from asemic_py.columns import BlockColumns
    code = block_code("b1", "output('main_out')\naffinity('score_out', 'gen')")
    app = AsemicApp(client=Client(), code=code)
    async with app.run_test(size=(140, 40)) as pilot:
        cols = app.query_one(BlockColumns)
        cols.enter_level()
        await pilot.pause()
        assert len(app.query(BufferView)) == 2
        out_view = app.query_one("#row-preview-b1-main_out", BufferView)
        aff_view = app.query_one("#row-preview-b1-score_out", BufferView)
        assert out_view is not None
        assert aff_view is not None

