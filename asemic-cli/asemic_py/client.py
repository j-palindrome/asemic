"""Thin zenoh wrapper: JSON put/get/delete/subscribe + queryable verbs (plan §5, §6)."""

from __future__ import annotations

import json
import time
import os
from pathlib import Path
from typing import Any, Callable

import zenoh

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = Path(os.environ.get(
    "ASEMIC_ZENOH_CONFIG", ROOT / "config" / "peer.json5"))
JSON = zenoh.Encoding.APPLICATION_JSON

from . import ids
import contextlib

# key helpers = crates/schema keys (via asemic_py._ids)
param_key = ids.param


class QueryError(RuntimeError):
    pass


class Client:
    def __init__(self, config: Path | str | None = None):
        self.session = zenoh.open(
            zenoh.Config.from_file(str(config or DEFAULT_CONFIG)))
        self._subs: list[Any] = []

    # --- writes: user edits = InteractiveHigh + Block (!lose edits, §6.2)
    def put(self, key: str, value: Any) -> None:
        self.session.put(
            key, json.dumps(value), encoding=JSON,
            priority=zenoh.Priority.INTERACTIVE_HIGH,
            congestion_control=zenoh.CongestionControl.BLOCK,
        )

    def delete(self, key: str) -> None:
        self.session.delete(key)

    # --- reads
    def get(self, selector: str, timeout: float = 2.0) -> list[tuple[str, Any]]:
        """Collect replies as (key, json); error replies raise QueryError."""
        out = []
        for r in self.session.get(selector, timeout=timeout):
            if r.ok is not None:
                payload = r.ok.payload
                if payload is not None:
                    out.append(
                        (str(r.ok.key_expr), _decode(payload.to_bytes())))
                else:
                    out.append((str(r.ok.key_expr), None))
            elif r.err is not None:
                payload = r.err.payload
                if payload is not None:
                    raise QueryError(payload.to_string())
                else:
                    raise QueryError("Unknown Zenoh error")
            else:
                raise QueryError("Zenoh reply without result or error")
        return out

    def call(self, verb: str, args: tuple = (), kwargs: dict | None = None, label: str | None = None,
             timeout: float = 15.0) -> Any:
        """Run a brain verb (asemic/brain/do); errors raise QueryError with the brain's message."""
        body = json.dumps({"verb": verb, "label": label,
                          "args": list(args), "kwargs": kwargs or {}})
        replies: list[Any] = []
        for _ in range(10):  # fresh session: routes to the brain take a moment to appear
            replies = list(self.session.get("asemic/brain/do",
                           payload=body, encoding=JSON, timeout=timeout))
            if replies:
                break
            time.sleep(0.1)
        if not replies:
            raise QueryError("brain not answering (is asemic-brain running?)")
        r = replies[0]
        if r.ok is None:
            if r.err is not None:
                payload = r.err.payload
                if payload is not None:
                    raise QueryError(payload.to_string())
            raise QueryError("Zenoh reply error without payload")
        payload = r.ok.payload
        if payload is None:
            return None
        return _decode(payload.to_bytes())

    def subscribe(self, key: str, cb: Callable[[str, bool, Any], None]) -> Any:
        """cb(key, is_put, json_or_None) on zenoh's thread. Returns the subscriber so the
        caller can undeclare it."""

        def handler(s: zenoh.Sample) -> None:
            put = s.kind == zenoh.SampleKind.PUT
            cb(str(s.key_expr), put, _decode(
                s.payload.to_bytes()) if put else None)

        sub = self.session.declare_subscriber(key, handler)
        self._subs.append(sub)
        return sub

    def subscribe_raw(self, key: str, cb: Callable[[str, bytes], None]) -> Any:
        sub = self.session.declare_subscriber(
            key, lambda s: cb(str(s.key_expr), s.payload.to_bytes()))
        self._subs.append(sub)
        return sub

    def _forget_sub(self, sub: Any) -> None:
        """Remove a subscriber from the auto-cleanup list (e.g. a row guard owns it)."""
        try:
            self._subs.remove(sub)
        except ValueError:
            pass

    def close(self) -> None:
        for s in self._subs:
            with contextlib.suppress(Exception):
                s.undeclare()
        try:
            self.session.close()
        # close timeout (e.g. a hung peer was just killed): session is gone anyway
        except Exception:
            pass


def _decode(b: bytes) -> Any:
    try:
        return json.loads(b)
    except (ValueError, UnicodeDecodeError):
        return b

