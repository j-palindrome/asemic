"""Textual e2e debugging: on failure attach widget tree + SVG screenshot (tests/artifacts/,
gitignored) and the brain.log tail to the pytest report."""

from __future__ import annotations

import contextlib
import itertools
import os
import re
from pathlib import Path

import pytest
from textual.app import App

from asemic_py import ids, rig
from asemic_py.blocks import Doc
from asemic_py.namespace import labels_code

ARTIFACTS = Path(__file__).parent / "artifacts"
BRAIN_TAIL = 60
TEST_STATE = ("component", "param", "route", "session", "cue", "tex", "block")

_PREFIX_SEQ = itertools.count()


def fresh_prefix() -> str:
    """Fresh id/label namespace for one live-example test module: `t_<pid>_<n>_`. `<pid>`
    isolates concurrent pytest *processes* sharing one brain/zenoh namespace (the actual
    collision this guards against); `<n>` keeps module-level reuse within a process tidy.
    Pass the result to `namespaced_blocks` and `clear_test_state`."""
    return f"t_{os.getpid()}_{next(_PREFIX_SEQ)}_"


_STRING = re.compile(r'"""[\s\S]*?"""|"[^"\n]*"|\'[^\'\n]*\'')  # ids only inside literals, never kwargs
_DEFINER = re.compile(r'\b(?:proc|tex|comp|vfont|cue|output|param|xy|noise)\(\s*["\']([A-Za-z_]\w*)["\']')


_KIND = re.compile(r'(\b(?:proc|noise)\(\s*["\'][^"\'\n]*["\']\s*,\s*)(["\'][^"\'\n]*["\'])')


def namespaced_blocks(doc: Doc, prefix: str) -> dict[str, str]:
    """`labels_code(doc)`, with every component/tex/proc/vfont/... id (defined or referenced --
    found as a whole word inside string literals) prefixed by `prefix`. Keys (block labels) are
    left as-is -- callers prefix the label themselves when they `run_block`/`drop` it (so
    parametrize ids / lookups by bare label, e.g. `BLOCKS["plant"]`, still work).

    Examples reuse bare ids across files (e.g. "balls", "type_thin"); this isolates one test
    run's components in the brain's single global id namespace without renaming anything
    inside the example files themselves."""
    blocks = labels_code(doc)
    ids = sorted({m.group(1) for code in blocks.values() for m in _DEFINER.finditer(code)}, key=len, reverse=True)
    if not ids:
        return dict(blocks)
    id_re = re.compile(r"\b(" + "|".join(re.escape(i) for i in ids) + r")\b")
    sub = lambda m: id_re.sub(lambda i: prefix + i.group(1), m.group(0))

    def ns(code: str) -> str:
        # kind literals (`noise("chaos", "chaos")`, `proc("m", "py")`) are not ids: mask them
        kinds: list[str] = []
        code = _KIND.sub(lambda m: m.group(1) + f"\0{kinds.append(m.group(2)) or len(kinds) - 1}\0", code)
        return re.sub(r"\0(\d+)\0", lambda m: kinds[int(m.group(1))], _STRING.sub(sub, code))
    return {label: ns(code) for label, code in blocks.items()}


def clear_test_state(c, prefix: str = "t_") -> None:
    """Drop leftover `<prefix>*` keys from the router storage -- scoped to the caller's own
    namespace (see `fresh_prefix`/`namespaced_blocks`), not the whole brain. `$*` (not bare
    `*`) is zenoh's verbatim chunk-suffix wildcard -- it must follow the literal directly."""
    for k in TEST_STATE:
        c.delete(f"asemic/state/{k}/{prefix}$*")
        c.delete(f"asemic/state/{k}/{prefix}$*/**")


def start_playing(c, *labels: str) -> None:
    """Headless live tests: blocks default to frozen (`timestretch=0.0`, §2.4.4), so their
    noises/procs never step and publish nothing. Start each namespaced `<prefix><label>` block
    playing; the per-test id namespace keeps this out of the running app's own blocks."""
    for label in labels:
        c.put(ids.block_timestretch(label), 1.0)


@pytest.fixture(autouse=True)
def _dump_textual_on_failure(request, monkeypatch):
    """Wrap App.run_test: an exception inside the `async with` dumps the live app before teardown."""
    orig = App.run_test
    dumps: list[str] = []
    request.node._textual_dumps = dumps

    @contextlib.asynccontextmanager
    async def run_test(self, *a, **kw):
        async with orig(self, *a, **kw) as pilot:
            try:
                yield pilot
            except BaseException:
                ARTIFACTS.mkdir(exist_ok=True)
                stem = request.node.name.replace("/", "_")
                tree = ARTIFACTS / f"{stem}.tree.txt"
                log = "\n".join(str(l) for w in self.query("RichLog") for l in w.lines)
                tree.write_text(f"{self.tree}\n\n--- RichLog ---\n{log}\n")
                svg = self.save_screenshot(f"{stem}.svg", path=str(ARTIFACTS))
                dumps.append(f"widget tree: {tree}\nscreenshot: {svg}\n\n{self.tree}\n\n--- RichLog ---\n{log}")
                raise

    monkeypatch.setattr(App, "run_test", run_test)
    yield


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    if rep.when != "call" or not rep.failed:
        return
    for d in getattr(item, "_textual_dumps", []):
        rep.sections.append(("textual", d))
    log = rig.STATE_DIR / "brain.log"
    if log.exists():
        tail = log.read_text(errors="replace").splitlines()[-BRAIN_TAIL:]
        rep.sections.append((f"brain.log (last {BRAIN_TAIL})", "\n".join(tail)))
