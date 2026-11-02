"""Bring up the rig: zenohd router (storage + rest) and asemic-brain, detached; logs in state/."""

from __future__ import annotations

import contextlib
import fcntl
import os
import re
import shutil
import socket
import subprocess
import threading
import time
from typing import Any



import psutil
import zenoh

from ._keys import BRAIN_READY
from .client import ROOT, Client

ROUTER = ("127.0.0.1", 7447)
STATE_DIR = ROOT / "state"
BRAIN = ROOT / "target" / os.environ.get("ASEMIC_PROFILE", "debug") / "asemic-brain"
# repo-level hot reload (`cargo install cargo-watch`); builds the whole workspace in BRAIN's
# profile so every adapter's prebuilt binary is fresh when it starts (adapters exec the binary
# directly, !`cargo run`: a second cargo on start contends with this watch for the package-cache
# + build-dir locks -> "Blocking waiting for file lock on package cache" startup hang). Exec the
# brain via -s (!`cargo run`: its CARGO_PKG_*/CARGO_MANIFEST_* env leaked into the brain -> the
# adapters' own builds saw a changed env and rebuilt deps from scratch)
_PROFILE = ["--release"] if BRAIN.parent.name == "release" else []
WATCH = ["cargo", "watch", "-q", "-w", "crates", "-w", "adapters", "-w", "Cargo.toml", "-w", "Cargo.lock",
         "-x", " ".join(["build", *_PROFILE, "--workspace", "--exclude", "asemic-ids-py"]),
         "-s", f"{BRAIN} --root {ROOT}"]


def _port_open(addr: tuple[str, int]) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(addr) == 0


def _spawn(cmd: list[str], log: str, env: dict | None = None) -> None:
    STATE_DIR.mkdir(exist_ok=True)
    with open(STATE_DIR / log, "ab") as f:
        subprocess.Popen(cmd, cwd=ROOT, stdout=f, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         env={**os.environ, **(env or {})}, start_new_session=True)


def storage_up(timeout: float = 2.0) -> bool:
    """Router's `asemic/state/**` storage answers: put a probe, read it back. A zenohd that won
    port 7447 but lost the storage LOCK race to a concurrent spawn (2026-10-12) serves no state."""
    c = Client()
    try:
        stamp = str(time.time())
        c.session.put("asemic/state/rig/probe", stamp)
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if any(v == float(stamp) or str(v) == stamp for _, v in c.get("asemic/state/rig/probe", timeout=0.3)):
                return True
            time.sleep(0.1)
        return False
    finally:
        c.close()


@contextlib.contextmanager
def _spawn_lock():
    """Serializes concurrent router check-then-spawn (blocking flock, !polled)."""
    STATE_DIR.mkdir(exist_ok=True)
    with open(STATE_DIR / "spawn.lock", "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def ensure_router() -> None:
    with _spawn_lock():  # concurrent spawns race the storage LOCK -> a router w/o storage
        if _port_open(ROUTER):
            if storage_up():
                return
            kill_router()  # up but storage-less: !limp along
        _spawn(["zenohd", "-c", str(ROOT / "config" / "router.json5")], "zenohd.log",
               {"ZENOH_BACKEND_FS_ROOT": str(STATE_DIR)})
        for _ in range(50):
            if _port_open(ROUTER):
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("zenohd did not come up; see state/zenohd.log")
        if not storage_up(5.0):
            raise RuntimeError("zenohd up but asemic/state storage not answering; see state/zenohd.log")


def _procs(name: str | None = None, cmd: str | None = None) -> list[psutil.Process]:
    """Processes by exact name (pgrep -x) or cmdline regex (pgrep -f)."""
    return [p for p in psutil.process_iter(["name", "cmdline"])
            if p.pid != os.getpid()
            and (name is None or p.info["name"] == name)
            and (cmd is None or re.search(cmd, " ".join(p.info["cmdline"] or [])))]


def _signal(procs: list[psutil.Process], sig: str = "terminate") -> None:
    for p in procs:
        with contextlib.suppress(psutil.NoSuchProcess):
            getattr(p, sig)()


def ensure_jack() -> None:
    """Audio outputs = JACK clients; jackd (brew install jack) must run before the brain opens one."""
    if _procs(name="jackd"):
        return
    if not shutil.which("jackd"):
        raise RuntimeError("jackd not found: brew install jack")
    _spawn(["jackd", "-d", os.environ.get("ASEMIC_JACK_DRIVER", "coreaudio")], "jackd.log")


def _brain_ready(c: Client) -> threading.Event:
    """Set while the brain's liveliness token (`BRAIN_READY`) is alive; history = an
    already-running brain sets it at once. Event-driven, !polled."""
    up = threading.Event()

    def on(s: Any) -> None:
        (up.set if s.kind == zenoh.SampleKind.PUT else up.clear)()
    c._subs.append(c.session.liveliness().declare_subscriber(BRAIN_READY, on, history=True))
    return up


def _watching() -> bool:
    return bool(_procs(cmd="cargo-watch.*asemic-brain"))


def kill_brain() -> None:
    """cargo watch first (else it respawns one), then its brain; returns once the token drops."""
    c = Client()
    try:
        up = _brain_ready(c)
        gone = threading.Event()
        c._subs.append(c.session.liveliness().declare_subscriber(
            BRAIN_READY, lambda s: s.kind == zenoh.SampleKind.DELETE and gone.set()))
        _signal(_procs(cmd="cargo-watch.*asemic-brain"))
        _signal(_procs(cmd=f"target/{BRAIN.parent.name}/asemic-brain"))
        if up.is_set():
            gone.wait()
    finally:
        c.close()


def ensure_brain() -> None:
    """cargo watch owns the brain: any change under crates/, adapters/ or the workspace manifests
    rebuilds + restarts it (and its adapters). Spawned once; returns when the brain is ready."""
    c = Client()
    try:
        up = _brain_ready(c)
        if not up.is_set() and not _watching():
            # cargo's own progress bar (Compiling n/N) into the log even off a tty
            _spawn(WATCH, "brain.log", {"CARGO_TERM_PROGRESS_WHEN": "always", "CARGO_TERM_PROGRESS_WIDTH": "80"})
        if not up.wait(2.0):  # cold: cargo is building; stream its progress until the brain is up
            print("asemic: waiting for asemic-brain (build/log: state/brain.log)", flush=True)
            tail = subprocess.Popen(["tail", "-n", "0", "-F", str(STATE_DIR / "brain.log")])
            try:
                up.wait()
            finally:
                tail.terminate()
                print(flush=True)
    finally:
        c.close()


def kill_router() -> None:
    procs = _procs(name="zenohd")
    _signal(procs)
    _, alive = psutil.wait_procs(procs, timeout=5)  # event-driven exit wait, !polled port
    _signal(alive, "kill")
    psutil.wait_procs(alive)


def ensure(restart: bool = False) -> None:
    """restart = clean: kill brain + router first (storage on disk is kept)."""
    if restart:
        kill_brain()
        kill_router()
    ensure_router()
    ensure_jack()
    ensure_brain()
