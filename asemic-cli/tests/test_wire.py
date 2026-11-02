"""`asemic_py/_wire.py` is generated from asemic-schema (step 7 follow-up, 2026-10-10); see its
header for the regen command. This just checks points.py's structs agree with it at runtime."""

from __future__ import annotations

from asemic_py._wire import F_HEAD as GEN_F_HEAD
from asemic_py._wire import P_HEAD as GEN_P_HEAD
from asemic_py.points import F_HEAD, P_HEAD


def test_struct_sizes_match_generated_wire_module():
    assert P_HEAD is GEN_P_HEAD
    assert F_HEAD is GEN_F_HEAD
    assert P_HEAD.size == 16
    assert F_HEAD.size == 12
