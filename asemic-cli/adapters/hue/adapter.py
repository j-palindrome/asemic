"""hue adapter (plan §9.1): output only. Renders lamp colour/brightness from brain values
(vortex xy, chaos noise, intensity) with the hue-inferno flame kernel; PUTs to the bridge.

Env: HUE_ARENA / HUE_CHAOS / HUE_INTENSITY component ids, HUE_PALETTE,
     HUE_BRIDGE_IP + HUE_API_KEY (fallback: philips-hue env in vault .mcp.json),
     ASEMIC_HUE_DRY=1 -> publish only, no bridge calls.
Lamp positions: asemic/state/hue/lamps = {"<id>": {"name", "x", "y"}} (written with defaults if absent).
Event-driven: each brain update renders + PUTs the latest state (coalesced while a PUT runs, !poll);
each render also published to asemic/out/hue/lamp/<id> = {"xy", "bri"}.
"""

from __future__ import annotations

import json
import math
import os
import random
import signal
import ssl
import sys
import threading
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from coloraide import Color  # noqa: E402
from asemic_py.lib.textual_xy_pad import coord_to_coloraide, toroidal_delta  # noqa: E402

from asemic_py import ids  # noqa: E402
from asemic_py.client import Client  # noqa: E402

DEFAULT_LAMPS = {
    "2": {"name": "marigold", "x": 0.70, "y": 0.30},
    "3": {"name": "flavio", "x": -0.60, "y": 0.60},
    "4": {"name": "gerald", "x": -0.70, "y": -0.50},
    "5": {"name": "monkfish", "x": 0.60, "y": -0.60},
    "7": {"name": "guillermo", "x": 0.00, "y": 0.00},
}
INFERNO = [(0.6915, 0.3083), (0.6500, 0.3400), (0.5800, 0.3900), (0.5200, 0.4400), (0.4000, 0.2000)]

ARENA = os.environ.get("HUE_ARENA", "arena")
CHAOS = os.environ.get("HUE_CHAOS", "chaos")
INTENSITY = os.environ.get("HUE_INTENSITY", "intensity")
PALETTE = os.environ.get("HUE_PALETTE", "inferno")
DRY = os.environ.get("ASEMIC_HUE_DRY") == "1"


def bridge_creds() -> tuple[str, str] | None:
    ip, key = os.environ.get("HUE_BRIDGE_IP"), os.environ.get("HUE_API_KEY")
    if ip and key:
        return ip, key
    try:
        env = json.loads((ROOT.parents[2] / ".mcp.json").read_text())["mcpServers"]["philips-hue"]["env"]
        return env["HUE_BRIDGE_IP"], env["HUE_API_KEY"]
    except Exception:
        return None


def cie_xy(c: Color) -> tuple[float, float]:
    X, Y, Z = c.convert("xyz-d65").coords()[:3]
    tot = X + Y + Z
    return (0.3127, 0.3290) if tot <= 0 else (round(X / tot, 4), round(Y / tot, 4))


def flame(dist: float, t: float, seed: float, speed: float, lx: float, ly: float, intensity: float) -> float:
    """hue-inferno rbf_flame_kernel."""
    wave = math.sin(dist * 5.0 - t * 1.8 * speed + seed)
    chaos = lx * 0.03 + ly * 0.02
    heat = math.exp(-min(20.0, dist ** 2) / 1.5) + 0.35 * wave + 0.25 * chaos
    return max(0.0, min(1.0, (heat + 0.2) * intensity))


def lamp_state(lid: str, lamp: dict, s: dict, now: float) -> tuple[list[float], int]:
    """hue-inferno calculate_lamp_state, inputs from brain instead of local sim."""
    dx, dy = toroidal_delta(lamp["x"], lamp["y"], s["vx"], s["vy"])
    dist = max(0.0, min(10.0, math.hypot(dx, dy)))
    heat = flame(dist, now, int(lid) * 1.3, s["speed"], s["lx"], s["ly"], s["intensity"])
    base = cie_xy(coord_to_coloraide(lamp["x"], lamp["y"], val=1.0, palette_name=PALETTE))
    norm = ((math.atan2(dy, dx) - s["angle"]) % math.tau) / math.tau
    f = (norm * 4.0 + heat * 1.5) % len(INFERNO)
    i0 = int(f)
    p0, p1, fr = INFERNO[i0], INFERNO[(i0 + 1) % len(INFERNO)], f - i0
    ix, iy = p0[0] * (1 - fr) + p1[0] * fr, p0[1] * (1 - fr) + p1[1] * fr
    b = max(0.0, min(0.65, heat * 0.7))
    xy = [round(base[0] * (1 - b) + ix * b, 4), round(base[1] * (1 - b) + iy * b, 4)]
    bri = int(max(120, min(254, 180 + heat * 60 + random.randint(-15, 15))))
    return xy, bri


def main() -> None:
    c = Client()
    s = {"vx": 0.0, "vy": 0.0, "lx": 0.0, "ly": 0.0, "angle": 0.0, "speed": 1.2, "intensity": 1.0}
    lamps = dict(DEFAULT_LAMPS)
    got = c.get("asemic/state/hue/lamps")
    if got and isinstance(got[0][1], dict):
        lamps = got[0][1]
    else:
        c.put("asemic/state/hue/lamps", lamps)

    dirty = threading.Event()  # brain state changed since the last render

    def on_value(key: str, put: bool, v) -> None:
        if not put:
            return
        dirty.set()
        if key == ids.value(ARENA, "x"):
            s["vx"] = float(v)
        elif key == ids.value(ARENA, "y"):
            s["vy"] = float(v)
        elif key == ids.value(INTENSITY, "value"):
            s["intensity"] = float(v)
        elif key.startswith(ids.value(CHAOS, "")) and (k := key[len(ids.value(CHAOS, "")):]) in ("lx", "ly", "angle", "speed"):
            s[k] = float(v)

    def on_lamps(key: str, put: bool, v) -> None:
        nonlocal lamps
        if put and isinstance(v, dict):
            lamps = v
            dirty.set()

    for sel in (ids.value(ARENA, "$*"), ids.value(INTENSITY, "value"), ids.value(CHAOS, "$*")):
        for k, v in c.get(sel, timeout=1.0):  # late join: brain answers latest
            on_value(k, True, v)
        c.subscribe(sel, on_value)
    c.subscribe("asemic/state/hue/lamps", on_lamps)

    creds = None if DRY else bridge_creds()
    ctx = ssl.create_default_context()
    ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    stop = False

    def halt(*_) -> None:
        nonlocal stop
        stop = True
        dirty.set()

    signal.signal(signal.SIGTERM, halt)
    signal.signal(signal.SIGINT, halt)
    print(f"hue: {'dry' if creds is None else creds[0]} arena={ARENA} chaos={CHAOS}", flush=True)

    while dirty.wait() and not stop:  # blocks until the brain publishes (no timer)
        dirty.clear()
        now = time.time()
        for lid, lamp in list(lamps.items()):
            xy, bri = lamp_state(lid, lamp, s, now)
            c.put(f"asemic/out/hue/lamp/{lid}", {"xy": xy, "bri": bri})
            if creds:
                body = json.dumps({"on": True, "bri": bri, "xy": xy, "transitiontime": 2}).encode()
                req = urllib.request.Request(f"https://{creds[0]}/api/{creds[1]}/lights/{lid}/state",
                                             data=body, method="PUT", headers={"Content-Type": "application/json"})
                try:
                    urllib.request.urlopen(req, context=ctx, timeout=0.8).close()
                except Exception as e:
                    print(f"hue {lid}: {e}", flush=True)
    c.close()


if __name__ == "__main__":
    main()
