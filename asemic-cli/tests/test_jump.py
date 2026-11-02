"""asemic:// jump handler (asemic_py/jump.py): URI parsing + a Pilot test that publishing a
jump over zenoh focuses the right block in a running REPL (app.py's `_on_jump`/`_do_jump`,
columns.py's `focus_label`)."""

from __future__ import annotations

import pytest

from asemic_py import rig
from asemic_py.app import AsemicApp
from asemic_py.client import Client
from asemic_py.columns import BlockColumns
from asemic_py.jump import JUMP_KEY, parse_uri
from asemic_py.links import asemic_uri


# ------------------------------------------------------------ parse_uri
def test_parse_uri_roundtrips_asemic_uri(tmp_path):
    p = tmp_path / "doc.py"
    uri = asemic_uri(p, "a.b")
    file, label = parse_uri(uri)
    assert file == p.resolve()
    assert label == "a.b"


def test_parse_uri_decodes_percent_encoded_space(tmp_path):
    d = tmp_path / "Infinite Researcher"
    d.mkdir()
    uri = asemic_uri(d / "doc.py", "a b")
    file, label = parse_uri(uri)
    assert file.name == "doc.py"
    assert "Infinite Researcher" in str(file)
    assert label == "a b"


def test_parse_uri_handles_plus_encoded_space():
    """`urlencode` uses `+` for spaces (not `%20`) -- `asemic_uri`'s own encoder -- so a link
    built by this repo always arrives this way; `parse_qs` must still decode it."""
    uri = "asemic://open?file=%2Ftmp%2Fx.py&label=a+b"
    file, label = parse_uri(uri)
    assert str(file) == "/tmp/x.py"
    assert label == "a b"


def test_parse_uri_preserves_nested_dotted_label(tmp_path):
    p = tmp_path / "doc.py"
    uri = asemic_uri(p, "outer.inner.deep")
    _, label = parse_uri(uri)
    assert label == "outer.inner.deep"


def test_parse_uri_rejects_wrong_scheme():
    with pytest.raises(ValueError):
        parse_uri("file:///tmp/x.py")


def test_parse_uri_rejects_missing_label(tmp_path):
    with pytest.raises(ValueError):
        parse_uri(f"asemic://open?file={tmp_path / 'x.py'}")


def test_parse_uri_rejects_missing_file():
    with pytest.raises(ValueError):
        parse_uri("asemic://open?label=main")


# ------------------------------------------------------------ Pilot: publishing a jump focuses
# the right block. Needs only zenohd (not asemic-brain) -- `_on_jump` is pure REPL-side state.
@pytest.fixture(scope="module")
def router():
    rig.ensure_router()


def block_code(label: str, body: str) -> str:
    return f'with block("{label}"):\n' + "\n".join("    " + l for l in body.splitlines()) + "\n"


async def test_publishing_jump_focuses_labeled_block(router, tmp_path):
    code = block_code("a", "1") + block_code("b", "2") + block_code("c", "3")
    path = tmp_path / "doc.py"
    path.write_text(code)
    app = AsemicApp(Client(), code=code, path=path)
    pub = Client()
    try:
        async with app.run_test(size=(140, 40)) as pilot:
            await pilot.pause()
            cols = app.query_one(BlockColumns)
            assert cols.parent_path == ()  # starts at root

            pub.put(JUMP_KEY, {"file": str(path.resolve()), "label": "b"})
            for _ in range(40):
                await pilot.pause(0.05)
                if cols.parent_path == (1,):
                    break
            assert cols.parent_path == (1,)  # zoomed into "b" (2nd top-level block)

            # a jump for a DIFFERENT file is ignored (no running REPL has it open)
            pub.put(JUMP_KEY, {"file": str(tmp_path / "other.py"), "label": "c"})
            await pilot.pause(0.3)
            assert cols.parent_path == (1,)  # unchanged
    finally:
        pub.close()


async def test_jump_to_unknown_label_is_a_noop(router, tmp_path):
    code = block_code("a", "1")
    path = tmp_path / "doc2.py"
    path.write_text(code)
    app = AsemicApp(Client(), code=code, path=path)
    pub = Client()
    try:
        async with app.run_test(size=(140, 40)) as pilot:
            await pilot.pause()
            cols = app.query_one(BlockColumns)
            pub.put(JUMP_KEY, {"file": str(path.resolve()), "label": "nope"})
            await pilot.pause(0.3)
            assert cols.parent_path == ()  # no matching block -> stayed put
    finally:
        pub.close()
