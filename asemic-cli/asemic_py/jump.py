"""asemic:// scheme jump handler, Python side (Ghostty integration part B's call site).

Parses an `asemic://open?file=<abs>&label=<dotted label>` URI -- the shape
`asemic_py.links.asemic_uri()` already emits for every breadcrumb segment -- and routes it
to whichever running REPL (if any) has `file` open, focusing the block at `label` there; if
none does, it starts a fresh REPL on that file already zoomed to `label`.

Transport: zenoh, not a unix socket -- `rig.ensure_router()` already has to keep a zenohd up
for the REPL's own state traffic (`client.py`), so routing a jump through it needs no second
IPC mechanism stood up/torn down alongside it. Two keys:
  - `asemic/repl/open/<pid>`: each running `AsemicApp` puts `{"file": <abs path>}` here on
    mount and deletes it on unmount -- this CLI's own "is anyone already looking at this file"
    check (`c.get(f"{OPEN_PREFIX}/*")`).
  - `asemic/repl/jump`: this CLI `put`s `{"file": <abs path>, "label": <label>}` here; every
    running REPL subscribes and ignores it unless its own `self.path` resolves to that `file`
    (`app.py`'s `_on_jump`).
"""

from __future__ import annotations

import subprocess
import sys
import urllib.parse
from pathlib import Path

from . import rig
from .client import Client

JUMP_KEY = "asemic/repl/jump"
OPEN_PREFIX = "asemic/repl/open"


def parse_uri(uri: str) -> tuple[Path, str]:
    """`asemic://open?file=<abs>&label=<dotted>` -> (file, label), percent-decoded (spaces,
    etc.) by `urllib.parse.parse_qs` the same way `asemic_uri`'s `urlencode` produced them.
    A nested label (`a.b.c`) survives untouched: `.` isn't a `urlencode` escape target, so it
    comes back exactly as `label=` carried it. Raises `ValueError` on anything that isn't an
    `asemic://` URI or is missing either query param."""
    parsed = urllib.parse.urlparse(uri)
    if parsed.scheme != "asemic":
        raise ValueError(f"not an asemic:// uri: {uri!r}")
    q = urllib.parse.parse_qs(parsed.query)
    file = q.get("file", [None])[0]
    label = q.get("label", [None])[0]
    if not file or not label:
        raise ValueError(f"asemic:// uri missing file/label: {uri!r}")
    return Path(file), label


def _open_files(c: Client) -> list[Path]:
    """Every `file=` a running REPL has currently advertised at `asemic/repl/open/*`."""
    out = []
    for _, v in c.get(f"{OPEN_PREFIX}/*", timeout=1.0):
        if isinstance(v, dict) and v.get("file"):
            out.append(Path(v["file"]))
    return out


def jump(uri: str, client: Client | None = None) -> bool:
    """Route `uri` to a running REPL with that file open (publishes to `JUMP_KEY`, -> True),
    else spawns a fresh `asemic <file> --label <label>` (-> False, "opened" not "jumped")."""
    file, label = parse_uri(uri)
    file = file.expanduser().resolve()
    own_client = client is None
    c = client or Client()
    try:
        if any(f.resolve() == file for f in _open_files(c)):
            c.put(JUMP_KEY, {"file": str(file), "label": label})
            return True
        subprocess.Popen(["asemic", str(file), "--label", label], start_new_session=True)
        return False
    finally:
        if own_client:
            c.close()


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: python -m asemic_py.jump <asemic://open?file=...&label=...>", file=sys.stderr)
        sys.exit(2)
    rig.ensure_router()  # only the router -- jump needs no brain
    found = jump(argv[0])
    print("jumped in running REPL" if found else "opened new REPL")


if __name__ == "__main__":
    main()
