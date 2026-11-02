"""Unit tests for SuperCollider literal translation and buffer flattening."""

import pytest
from asemic_py.sc_literal import to_sc, flatten_multiarray


def test_to_sc_primitives():
    assert to_sc(None) == "nil"
    assert to_sc(True) == "true"
    assert to_sc(False) == "false"
    assert to_sc(42) == "42"
    assert to_sc(3.14) == "3.14"
    assert to_sc("hello") == '"hello"'
    assert to_sc(r'quote "test"') == r'"quote \"test\""'
    assert to_sc(r"\mySymbol") == r"\mySymbol"


def test_to_sc_nested_arrays():
    arr = [[1, 2], [3, 4]]
    assert to_sc(arr) == "[ [ 1, 2 ], [ 3, 4 ] ]"

    multi = [[[1.0, 2.0]], [[3.0, 4.0]]]
    assert to_sc(multi) == "[ [ [ 1.0, 2.0 ] ], [ [ 3.0, 4.0 ] ] ]"


def test_to_sc_dict():
    d = {"freq": 440, "amp": 0.5, "notes": [60, 64, 67]}
    res = to_sc(d)
    assert r"\freq: 440" in res
    assert r"\amp: 0.5" in res
    assert r"\notes: [ 60, 64, 67 ]" in res
    assert res.startswith("(") and res.endswith(")")


def test_flatten_multiarray():
    arr = [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]
    flat, shape = flatten_multiarray(arr)
    assert flat == [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    assert shape == [2, 3]


def test_flatten_3d():
    arr = [[[1, 2]], [[3, 4]]]
    flat, shape = flatten_multiarray(arr)
    assert flat == [1.0, 2.0, 3.0, 4.0]
    assert shape == [2, 1, 2]
