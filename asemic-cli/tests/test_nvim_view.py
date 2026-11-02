"""`nvim_server.ensure_server`: one headless nvim per file, reused -- the shared server
`NvimRowEditor` (per-row nvim editing, `tests/test_nvim_row.py`) points its window at a
scratch buffer. These tests exercise the server itself, independent of whole-file vs.
per-row UI (whole-file `NvimView`-as-`#cols` mode was removed 2026-10-11 in favor of
per-row editing -- see `tests/test_nvim_row.py`). Skips cleanly if nvim/pynvim are missing."""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

pynvim = pytest.importorskip("pynvim")

from asemic_py.nvim_server import ensure_server, socket_path

pytestmark = pytest.mark.skipif(shutil.which("nvim") is None, reason="nvim not installed")


def _nvim_pids_for_socket(sock: Path) -> list[int]:
    """pgrep for headless nvim processes whose --listen arg is this socket."""
    try:
        out = subprocess.run(["pgrep", "-f", f"nvim --headless --listen {sock}"],
                              capture_output=True, text=True, timeout=5)
    except Exception:
        return []
    return [int(p) for p in out.stdout.split() if p.strip()]


@pytest.fixture
def scratch_file(tmp_path):
    f = tmp_path / "scratch.py"
    f.write_text("x = 1\n")
    sock = socket_path(f)
    yield f
    for pid in _nvim_pids_for_socket(sock):
        try:
            os.kill(pid, 9)
        except ProcessLookupError:
            pass
    sock.unlink(missing_ok=True)


def test_ensure_server_starts_once_and_reuses(scratch_file):
    sock1 = ensure_server(scratch_file)
    assert sock1.exists()
    pids_after_first = _nvim_pids_for_socket(sock1)
    assert len(pids_after_first) == 1

    sock2 = ensure_server(scratch_file)
    assert sock2 == sock1
    pids_after_second = _nvim_pids_for_socket(sock1)
    assert pids_after_second == pids_after_first  # still exactly one process


def test_typing_is_visible_to_a_second_client(scratch_file):
    sock = ensure_server(scratch_file)
    client1 = pynvim.attach("socket", path=str(sock))
    client1.input("ihello<Esc>")
    time.sleep(0.3)
    client2 = pynvim.attach("socket", path=str(sock))
    lines = client2.current.buffer[:]
    assert lines[0].startswith("hello")


def test_write_notifies_without_python_writing_file(scratch_file):
    sock = ensure_server(scratch_file)
    before_mtime = scratch_file.stat().st_mtime
    client = pynvim.attach("socket", path=str(sock))
    client.command(f"edit! {scratch_file}")
    client.input("Gohello<Esc>:w<CR>")
    time.sleep(0.5)
    assert scratch_file.stat().st_mtime != before_mtime  # nvim itself wrote it
    assert "hello" in scratch_file.read_text()


def test_zM_closes_folds(scratch_file):
    scratch_file.write_text("def f():\n    x = 1\n    y = 2\n\ndef g():\n    z = 3\n")
    sock = ensure_server(scratch_file)
    client = pynvim.attach("socket", path=str(sock))
    client.command(f"edit! {scratch_file}")
    time.sleep(0.2)
    client.input("zM")
    time.sleep(0.2)
    closed = client.eval("foldclosed(2)")  # line 2 ("    x = 1") is nested under def f(): at level 0
    assert closed != -1

