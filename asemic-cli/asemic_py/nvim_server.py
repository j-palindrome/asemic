"""Headless-nvim server management: one `nvim --headless --listen <sock>` per script file.

Spec (embedded-nvim spike): socket path keys off `sha1(abspath)[:10]` so repeat runs against
the same file reuse the same server instead of spawning a second one; the server is never
killed on REPL exit (it's detached -- a later `asemic same_file` reattaches to it).
"""

from __future__ import annotations

import hashlib
import shutil
import socket
import subprocess
import time
from pathlib import Path

INIT_LUA = Path(__file__).resolve().parent / "nvim" / "init.lua"


def socket_path(file: Path) -> Path:
    """`/tmp/asemic-nvim-<sha1(abspath)[:10]>.sock` -- stable per script file."""
    digest = hashlib.sha1(str(file.resolve()).encode()).hexdigest()[:10]
    return Path(f"/tmp/asemic-nvim-{digest}.sock")


def is_listening(sock: Path) -> bool:
    """True if something is accepting connections on `sock` (an existing, reusable server)."""
    if not sock.exists():
        return False
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        s.settimeout(0.5)
        s.connect(str(sock))
        return True
    except OSError:
        return False
    finally:
        s.close()


def ensure_server(file: Path, nvim_bin: str | None = None) -> Path:
    """Ensure exactly one headless nvim is listening on `file`'s socket; return that socket path.
    Reuses an already-listening server; otherwise starts a new detached one (never kills an
    existing one -- that's the caller's/REPL-exit's job to NOT do, per spec)."""
    sock = socket_path(file)
    if is_listening(sock):
        return sock
    if sock.exists():
        sock.unlink()  # stale socket file from a dead server
    nvim_bin = nvim_bin or shutil.which("nvim") or "nvim"
    cmd = [nvim_bin, "--headless", "--listen", str(sock), "-u", str(INIT_LUA), str(file)]
    subprocess.Popen(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,  # detach: survives the REPL exiting
    )
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if is_listening(sock):
            return sock
        time.sleep(0.05)
    raise RuntimeError(f"nvim server on {sock} did not come up in time")
