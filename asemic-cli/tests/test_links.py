"""Ghostty integration part A: OSC 8 link helpers (asemic_py/links.py) + a Pilot smoke
test that a row with a path renders a `Text`/`Content` with a `link` style set."""

import urllib.parse
from pathlib import Path

import pytest
from textual.app import App, ComposeResult
from textual.widgets import Static

from asemic_py.blocks import Doc
from asemic_py.columns import BlockColumns
from asemic_py.links import (
    asemic_uri,
    file_link_content,
    file_link_text,
    file_uri,
    link_content,
    link_text,
    links_enabled,
)


# ------------------------------------------------------------ links_enabled
def test_links_enabled_override_off(monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "0")
    monkeypatch.setenv("TERM_PROGRAM", "ghostty")
    assert links_enabled() is False


def test_links_enabled_override_on(monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    monkeypatch.delenv("TERM_PROGRAM", raising=False)
    assert links_enabled() is True


def test_links_enabled_auto_known_terminal(monkeypatch):
    monkeypatch.delenv("ASEMIC_LINKS", raising=False)
    monkeypatch.setenv("TERM_PROGRAM", "ghostty")
    assert links_enabled() is True


def test_links_enabled_auto_unknown_terminal(monkeypatch):
    monkeypatch.delenv("ASEMIC_LINKS", raising=False)
    monkeypatch.setenv("TERM_PROGRAM", "Apple_Terminal")
    assert links_enabled() is False


def test_links_enabled_auto_no_term_program(monkeypatch):
    monkeypatch.delenv("ASEMIC_LINKS", raising=False)
    monkeypatch.delenv("TERM_PROGRAM", raising=False)
    assert links_enabled() is False


# ------------------------------------------------------------ file_uri / asemic_uri
def test_file_uri_absolute_scheme(tmp_path):
    p = tmp_path / "x.py"
    uri = file_uri(p)
    assert uri == f"file://{p}"


def test_file_uri_percent_encodes_spaces():
    uri = file_uri("/tmp/Infinite Researcher/cli.py")
    assert " " not in uri
    assert "Infinite%20Researcher" in uri


def test_file_uri_resolves_relative(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "x.py").touch()
    uri = file_uri("x.py")
    assert uri == f"file://{tmp_path / 'x.py'}"


def test_asemic_uri_shape(tmp_path):
    p = tmp_path / "doc.py"
    uri = asemic_uri(p, "main/inner")
    assert uri.startswith("asemic://open?")
    assert f"file={urllib.parse.quote(str(p), safe='')}" in uri
    assert f"label={urllib.parse.quote("main/inner", safe="")}" in uri


def test_asemic_uri_percent_encodes_label_and_path(tmp_path):
    d = tmp_path / "Infinite Researcher"
    d.mkdir()
    uri = asemic_uri(d / "doc.py", "a b")
    assert "Infinite+Researcher" in uri or "Infinite%20Researcher" in uri
    assert "a+b" in uri or "a%20b" in uri


# ------------------------------------------------------------ link_text / link_content
def test_link_text_enabled_sets_link_style(monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    t = link_text("hello", "file:///tmp/hello.py")
    assert "file:///tmp/hello.py" in str(t.style)


def test_link_text_disabled_is_plain(monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "0")
    t = link_text("hello", "file:///tmp/hello.py")
    assert str(t) == "hello"
    assert not t.style


def test_link_content_enabled_sets_link_style(monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    c = link_content("hello", "file:///tmp/hello.py")
    assert any("link" in str(s.style) for s in c.spans)


def test_link_content_disabled_is_plain(monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "0")
    c = link_content("hello", "file:///tmp/hello.py")
    assert not c.spans


def test_link_content_preserves_base_highlight_spans(monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    from textual.content import Content

    base = Content("hello").stylize("bold", 0, 2)
    c = link_content("hello", "file:///tmp/hello.py", base=base)
    styles = [str(s.style) for s in c.spans]
    assert any("bold" in s for s in styles)
    assert any("link" in s for s in styles)


# ------------------------------------------------------------ file_link_text / file_link_content
def test_file_link_text_default_label_is_path(tmp_path, monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    p = tmp_path / "x.py"
    t = file_link_text(p)
    assert str(t) == str(p)
    assert str(p) in str(t.style) and "link" in str(t.style)


def test_file_link_text_custom_label(tmp_path, monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    p = tmp_path / "x.py"
    t = file_link_text(p, label="x.py")
    assert str(t) == "x.py"
    assert str(p) in str(t.style)


def test_file_link_content_custom_label(tmp_path, monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    p = tmp_path / "x.py"
    c = file_link_content(p, label="x.py")
    assert str(c) == "x.py"
    assert any(str(p) in str(s.style) for s in c.spans)


# ------------------------------------------------------------ Pilot: crumb row renders a link
class _Harness(App):
    def __init__(self, doc: Doc):
        super().__init__()
        self.doc = doc

    def compose(self) -> ComposeResult:
        yield BlockColumns(self.doc, id="cols")


@pytest.mark.asyncio
async def test_crumb_renders_osc8_link_when_doc_has_path(tmp_path, monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    path = tmp_path / "doc.py"
    path.write_text("x = 1\n")
    doc = Doc.load(path)
    app = _Harness(doc)
    async with app.run_test() as pilot:
        await pilot.pause()
        crumb = app.query_one("#crumb", Static)
        rendered = crumb.visual
        spans = getattr(rendered, "spans", [])
        assert any("link" in str(s.style) and "asemic://open" in str(s.style) for s in spans)


@pytest.mark.asyncio
async def test_crumb_no_link_when_doc_unsaved(tmp_path, monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    doc = Doc("x = 1\n", path=None)
    app = _Harness(doc)
    async with app.run_test() as pilot:
        await pilot.pause()
        crumb = app.query_one("#crumb", Static)
        rendered = crumb.visual
        spans = getattr(rendered, "spans", [])
        assert not any("link" in str(s.style) for s in spans)
