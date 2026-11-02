"""Per-block timestretch must actually reach the renderer: a block's tex nodes render only
while the block's timestretch is nonzero (`graph.rs` freezes `ts == 0.0` nodes, they keep their
last frame). Guards the bug where the brain subscribed to `asemic/state/block/*` (one chunk),
which never matches the real two-chunk `asemic/state/block/<label>.timestretch` key -- so no
block ever unfroze and every GPU node's preview stayed blank. Needs zenohd + asemic-brain (rig).
"""

import asyncio

import pytest

from asemic_py import rig
from asemic_py.client import Client
from asemic_py.namespace import Repl
from asemic_py.points import decode_frame
from conftest import clear_test_state, fresh_prefix

RED = "fn shade(uv: vec2f) -> vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }"


def lit(frames: list[bytes], thresh: int = 32) -> int:
    """Max lit-pixel count across the buffered preview frames."""
    best = 0
    for b in frames:
        f = decode_frame(b)
        best = max(best, sum(1 for y in range(f.h) for x in range(f.w) if max(f.pixel(x, y)[:3]) > thresh))
    return best


async def sample(client: Client, node: str, secs: float) -> int:
    frames: list[bytes] = []
    sub = client.subscribe_raw(f"asemic/preview/{node}", lambda k, b: frames.append(b))
    loop, t0 = asyncio.get_running_loop(), asyncio.get_running_loop().time()
    try:
        while loop.time() - t0 < secs:
            await asyncio.sleep(0.1)
    finally:
        sub.undeclare()
    return lit(frames)


async def test_block_timestretch_unfreezes_nodes():
    rig.ensure()
    c = Client()
    label = fresh_prefix() + "tt"
    r = Repl(c)
    clear_test_state(c, label)
    node = f"{label}/red"
    try:
        r.label = label
        r.do("tex", "red", "shader", wesl=RED, w=32, h=32)
        r.label = None
        # frozen by default (ts 0.0): frames arrive but the node never renders -> black
        assert await sample(c, node, 2.0) == 0, "node rendered while its block was frozen"
        # unfreeze the block -> the same node renders (red)
        r.timestretch_scope(label, 1.0)
        assert await sample(c, node, 4.0) > 0, "node stayed blank after its block was playing"
    finally:
        r.drop(label)
        clear_test_state(c, label)
        c.close()
