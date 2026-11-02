"""Live mirror of brain state: one store per keyspace in `_keys.SPACES` (codegen'd from
`asemic_schema::keys::SPACES`), primed by a `get` and kept in sync by one subscription each.

The one place frontends read brain facts from (component defs, routes, values, noise, ...):
panels, backlinks, tree nav and id lookups all query this instead of wiring their own
subscriptions. Listeners get `(space, id, value | None)` on zenoh's thread (None = deleted);
they must only buffer + wake the UI, never block (same rule as `app.py`'s `_kick`).
"""

from __future__ import annotations

import re
import threading
from typing import Any, Callable

from . import ids

from ._keys import SPACES
from ._types import Component, Route, UiSettings

Listener = Callable[[str, str, Any], None]


def _ident(key: str, prefix: str, suffix: str) -> str:
    return key[len(prefix):len(key) - len(suffix)] if prefix else ""


class State:
    def __init__(self) -> None:
        self.spaces: dict[str, dict[str, Any]] = {name: {} for name, *_ in SPACES}
        self._listeners: list[Listener] = []
        self._lock = threading.Lock()

    def attach(self, client: Any, prime_timeout: float = 1.0) -> None:
        """Prime every space from the brain's current state, then subscribe for changes."""
        for name, pattern, prefix, suffix in SPACES:
            try:
                for key, v in client.get(pattern, timeout=prime_timeout):
                    self.apply(name, _ident(key, prefix, suffix), v)
            except Exception:  # noqa: BLE001 - not queryable / brain down: subscription fills it
                pass
            client.subscribe(pattern, lambda k, put, v, n=name, p=prefix, s=suffix:
                             self.apply(n, _ident(k, p, s), v if put else None))

    def listen(self, cb: Listener) -> None:
        self._listeners.append(cb)

    def apply(self, space: str, ident: str, v: Any) -> None:
        with self._lock:
            store = self.spaces[space]
            if v is None:
                store.pop(ident, None)
            else:
                store[ident] = v
        for cb in self._listeners:
            cb(space, ident, v)

    # ------------------------------------------------------------ typed views (`_types.py`,
    # codegen'd from the Rust schema; untyped spaces -- tex/noise/attrs/clock -- have no Rust
    # JsonSchema yet, read them via `get`/`spaces`)
    @property
    def components(self) -> dict[str, Component]:
        return self.spaces["component"]

    @property
    def routes(self) -> dict[str, Route]:
        return self.spaces["route"]

    @property
    def ui(self) -> UiSettings | None:
        return self.spaces["ui"].get("")

    def params(self, cid: str) -> dict[str, float]:
        """`cid`'s live stored params (`asemic/state/param/<cid>.<k>`): what a remounted panel
        must show, not the value it had when the app started."""
        pre = f"{cid}."
        return {k[len(pre):]: float(v) for k, v in self.spaces["param"].items()
                if k.startswith(pre) and isinstance(v, (int, float))}

    # ------------------------------------------------------------ queries
    def get(self, space: str, ident: str = "", default: Any = None) -> Any:
        return self.spaces[space].get(ident, default)

    def exists(self, ref: str) -> bool:
        """`ref` (canonical id, maybe `.field`/`:chan` tail) names a live component: same check
        as the brain's `is_comp_ref` (verbs.rs), answered from the mirror instead of a query."""
        return ids.split_field(ref)[0] in self.spaces["component"]

    def backlinks(self, cid: str) -> list[str]:
        """Who points at `cid`: components animated by it, texs reading it (`inputs`/`src`/`points`,
        brain-qualified canonical ids), and `route:<id>` for routes reading/writing it."""
        out = [i for i, c in self.spaces["component"].items()
               if isinstance(c, dict) and (c.get("anim") or {}).get("source", "").split(":")[0] == cid]
        out += [i for i, t in self.spaces["tex"].items() if isinstance(t, dict) and cid in tex_refs(t)]
        for rid, r in self.spaces["route"].items():
            if isinstance(r, dict) and any(_mentions(r.get(k, ""), cid) for k in ("src", "dst")):
                out.append(f"route:{rid}")
        return sorted(out)


def tex_refs(t: dict) -> list[str]:
    """A tex node's upstream ids (`NodeInfo` `inputs` + `src` + `points`)."""
    return [*(t.get("inputs") or []), *(t.get("src") or []), *([t["points"]] if t.get("points") else [])]


def _mentions(key: str, cid: str) -> bool:
    # key tail = `<slash id>[.field|:chan]`: cid must end at a field/chan boundary (!a descendant)
    return re.search(rf"(^|/){re.escape(cid)}([.:]|$)", key) is not None
