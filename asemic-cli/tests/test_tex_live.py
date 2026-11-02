"""Texture node graph live (graph.rs): shader node -> Syphon output -> syphon input node
(loopback, as TouchDesigner would appear) -> shader composite -> second output."""

import time

import pytest

from asemic_py import rig
from asemic_py.client import Client


@pytest.fixture(scope="module")
def ns():
    rig.ensure()
    from asemic_py.namespace import Repl

    c = Client()
    yield Repl(c)
    c.close()


def test_syphon_in_feeds_shader_nodes(ns):
    red = "fn shade(uv: vec2f) -> vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }"
    comp = "import lygia::color::blend::screen::blendScreen3;\nfn shade(uv: vec2f) -> vec4f { return vec4f(blendScreen3(in0(uv).rgb, vec3f(0.0, 0.0, 1.0)), 1.0); }"
    try:
        ns.do("tex", "red", "shader", wesl=red, w=64, h=64)
        ns.do("output", "loop", w=64, h=64, node="red")
        time.sleep(1.0)  # Syphon directory announce
        assert ns.do("tex", "td", "in", adapter="syphon:asemic:loop")["live"]
        assert ns.do("tex", "old", "syphon", server="asemic:loop")["live"]  # legacy spelling
        c = ns.do("tex", "comp", "shader", inputs=["td"], wesl=comp, w=64, h=64, publish="syphon", pingpong=True, smooth=0.5, params=[0.2])
        assert c["sinks"][0][0] == "asemic:comp"
        ns.do("texparam", "comp", 0, 0.7)
        time.sleep(1.0)
        assert ns.do("tex", "back", "in", adapter="syphon:asemic:comp")["live"]  # node publish -> in
        nodes = {n["id"]: n for n in ns.do("texs")}
        assert set(nodes) >= {"red", "td", "comp", "back"}
        assert nodes["comp"]["params"][0] == pytest.approx(0.7)
        with pytest.raises(Exception, match="pingpong"):
            ns.do("tex", "self", "shader", inputs=["self"], wesl="fn shade(uv: vec2f) -> vec4f { return in0(uv); }")
        with pytest.raises(Exception, match="wesl|shader"):
            ns.do("tex", "bad", "shader", wesl="fn shade(uv: vec2f) -> vec4f { return nope; }")
    finally:
        for o in ["loop"]:
            ns.do("close", o)
        for t in ["back", "comp", "old", "td", "red"]:
            ns.do("untex", t)
    assert not ns.do("texs")
