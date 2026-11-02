"""OSC 8 hyperlink helpers (Ghostty integration, part A).

Rich's `Style(link=...)` / the `link=` style key is what actually emits the OSC 8
escape sequence (`\\x1b]8;id=...;<url>\\x1b\\\\<text>\\x1b]8;;\\x1b\\\\`) -- confirmed by
rendering a `rich.text.Text(..., style="link <url>")` through a forced-terminal
`rich.Console` and inspecting the raw bytes (no scheme allowlist in Rich itself).
Textual's own content markup documents the same `link=` key for clickable links
(https://textual.textualize.io/guide/content/, "Styles may contain links..."), and
Textual's `Content.stylize(style, start, end)` takes a `"link <url>"` style string
the same way, landing as a `Span` Rich then turns into the same OSC 8 sequence.
`rich.text.Text` is used for the single plain-string widgets (the `#crumb` Static);
`textual.content.Content` is used wherever `_highlight()` already returns `Content`
(the slash-dropdown's `/open` results), so existing fuzzy-match highlighting isn't
disturbed -- a link span and a highlight span both just add to `Content.spans`.

OSC 8 itself carries no scheme allowlist (any terminal that supports OSC 8 opens
whatever URI it's given on click) -- Ghostty supports OSC 8 links without one, but
macOS itself prompts to confirm handling a *custom* (non-http/file) URL scheme the
first time an app registers for it (ghostty-org/ghostty#13634). That's the scheme
handler part of this task (asemic://) and is NOT implemented here -- only the
placeholder URI shape, built by `asemic_link()` below, so that later handler has
one call site to hang off instead of several ad hoc f-strings.

`links_enabled()` gates all of it: explicit `ASEMIC_LINKS=0` always wins; otherwise
links are on only when `TERM_PROGRAM` names a terminal known to implement OSC 8
hyperlinks (ghostty, iTerm.app, WezTerm, kitty via its own scheme, vscode's
integrated terminal). Unknown/unset `TERM_PROGRAM` defaults OFF: an OSC 8 sequence
a non-supporting terminal doesn't understand is harmless noise in this repo's own
testing (printed inert, no visible artifact per the OSC 8 spec), but plain tmux/ssh
or CI logs are not worth decorating by default, and a false "clickable but isn't"
is worse than no link -- so this list is an allow-list, not a block-list.
"""

from __future__ import annotations

import os
import urllib.parse
from pathlib import Path

from rich.text import Text
from textual.content import Content

# Terminals confirmed (vendor docs / changelogs) to render OSC 8 hyperlinks as
# clickable -- extend as more are verified, don't guess new entries in.
_OSC8_TERM_PROGRAMS = {"ghostty", "iterm.app", "wezterm", "kitty", "vscode"}


def links_enabled() -> bool:
    """Whether to emit OSC 8 links at all: `ASEMIC_LINKS=0` forces off; otherwise
    on only for a `TERM_PROGRAM` known to support OSC 8 (see module docstring)."""
    override = os.environ.get("ASEMIC_LINKS")
    if override is not None:
        return override not in ("0", "false", "False", "")
    term_program = os.environ.get("TERM_PROGRAM", "").strip().lower()
    return term_program in _OSC8_TERM_PROGRAMS


def file_uri(path: str | Path) -> str:
    """`path` (relative or absolute) -> an absolute `file://` URI, percent-encoded
    (spaces, etc. -- e.g. a path through "Infinite Researcher") the way browsers and
    terminals expect (bare paths with no scheme are known to fail to open on macOS,
    anthropics/claude-code#78481, hence always a scheme)."""
    abs_path = Path(path).expanduser().resolve()
    return "file://" + urllib.parse.quote(str(abs_path))


def asemic_uri(file: str | Path, label: str) -> str:
    """Placeholder `asemic://open?file=<abs>&label=<block path>` URI -- the ONE
    helper the later macOS `asemic://` scheme handler will need to match against,
    so breadcrumb-level links slot straight into it once that handler exists. Not
    wired to any OS handler yet (that's a later task) -- today it's just a URI
    string an OSC 8 span points at; Ghostty will prompt once to confirm opening an
    unregistered custom scheme (ghostty-org/ghostty#13634) if actually clicked
    before a handler is installed."""
    abs_path = Path(file).expanduser().resolve()
    query = urllib.parse.urlencode({"file": str(abs_path), "label": label})
    return f"asemic://open?{query}"


def link_text(text: str, url: str) -> Text:
    """Plain `text` wrapped in an OSC 8 link to `url`, as a `rich.text.Text` (for
    `Static`/`Text`-based widgets like `#crumb`) -- a no-op (plain `Text(text)`)
    when `links_enabled()` is false."""
    if not links_enabled():
        return Text(text)
    return Text(text, style=f"link {url}")


def link_content(text: str, url: str, base: Content | None = None) -> Content:
    """Same as `link_text` but for `textual.content.Content` (the `/open` dropdown,
    which already renders via `Content` for fuzzy-match highlighting). `base`, if
    given, is an already-built `Content` (e.g. `_highlight()`'s fuzzy-highlighted
    result) whose highlight spans are preserved -- the link span is just added on
    top, since both live in the same `Content.spans` list."""
    content = base if base is not None else Content(text)
    if not links_enabled():
        return content
    return content.stylize(f"link {url}", 0, len(text))


def file_link_text(path: str | Path, label: str | None = None) -> Text:
    """A row/panel file reference (vfont path, `path=` arg, adapter manifest, `/open`
    result shown outside the dropdown) as clickable `Text` pointing at `file://`."""
    p = Path(path)
    return link_text(label if label is not None else str(p), file_uri(p))


def file_link_content(path: str | Path, label: str | None = None, base: Content | None = None) -> Content:
    """`file_link_text` for `Content`-rendered rows (e.g. `/open` dropdown options)."""
    p = Path(path)
    text = label if label is not None else str(p)
    return link_content(text, file_uri(p), base=base)
