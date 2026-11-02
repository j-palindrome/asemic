"""Live adapter smoke tests (plan §9.2-9.4, §13.7): real sclang / Orca-c / CoreMIDI through the brain.
Each test skips when its external tool is missing; adapters are stopped and must leave no processes."""

import json
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from asemic_py import rig
from asemic_py.client import Client

ROOT = Path(__file__).resolve().parents[1]
SCLANG = Path("/Applications/SuperCollider.app/Contents/MacOS/sclang")
ORCA = ROOT / "adapters/orca/orca-c/build/orca"


@pytest.fixture(scope="module")
def client():
    rig.ensure()
    c = Client()
    yield c
    c.close()


def verb(c: Client, adapter: str, v: str, timeout: float = 30.0) -> dict:
    return c.get(f"asemic/adapter/{adapter}/{v}", timeout=timeout)[0][1]


def wait(cond, timeout: float):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.1)
    return False


def gone(*names: str) -> bool:
    return all(subprocess.run(["pgrep", "-x", n], capture_output=True).returncode == 1 for n in names)


def collect(c: Client, key: str) -> list:
    got: list = []
    c.subscribe_raw(key, lambda k, b: got.append((k, json.loads(b))))
    return got


@pytest.mark.skipif(not SCLANG.exists(), reason="SuperCollider.app not installed")
def test_supercollider_boots_and_reports(client):
    got = collect(client, "asemic/io/supercollider/**")
    try:
        assert verb(client, "supercollider", "start")["running"]
        assert wait(lambda: ("asemic/io/supercollider/ready", 1) in got, 60), got
        client.session.put("asemic/out/supercollider/set/freq", "330")
    finally:
        assert not verb(client, "supercollider", "stop")["running"]
    assert wait(lambda: gone("sclang", "scsynth"), 10)


@pytest.mark.skipif(not SCLANG.exists(), reason="SuperCollider.app not installed")
def test_supercollider_sc_follows_block_timestretch(client):
    """An `sc()` row inside a frozen block does not play; unfreezing starts it, re-freezing stops it."""
    from asemic_py.namespace import Repl
    from conftest import clear_test_state, fresh_prefix

    got = collect(client, "asemic/io/supercollider/**")
    prefix = fresh_prefix()
    label = f"{prefix}sc"
    repl = None
    try:
        assert verb(client, "supercollider", "start")["running"]
        assert wait(lambda: ("asemic/io/supercollider/ready", 1) in got, 60), got

        repl = Repl(Client())
        code = f'with block("{label}", timestretch="0.0"):\n    sc("call", "{{ |freq = 200| SinOsc.ar(freq) * 0.1 }}", p={{"freq": 300}})\n'
        out = repl.run_block(label, code)
        assert out == "", out

        # frozen at eval time -> no /playing message
        time.sleep(0.3)
        assert not any(k == "asemic/io/supercollider/playing" for k, _ in got), got

        # unfreeze -> Ndef starts
        client.put(f"asemic/state/block/{label}.timestretch", 1.0)
        assert wait(lambda: any(k == "asemic/io/supercollider/playing" and v == f"{label}_call" for k, v in got), 5), got

        # freeze -> Ndef ends; re-unfreeze produces a second /playing confirmation
        client.put(f"asemic/state/block/{label}.timestretch", 0.0)
        time.sleep(0.3)
        playing_count = sum(1 for k, v in got if k == "asemic/io/supercollider/playing" and v == f"{label}_call")
        client.put(f"asemic/state/block/{label}.timestretch", 1.0)
        assert wait(lambda: sum(1 for k, v in got if k == "asemic/io/supercollider/playing" and v == f"{label}_call") == playing_count + 1, 5), got
    finally:
        if repl is not None:
            repl.drop(label)
        clear_test_state(client, prefix)
        assert not verb(client, "supercollider", "stop")["running"]


@pytest.mark.skipif(not SCLANG.exists(), reason="SuperCollider.app not installed")
def test_supercollider_sc_buffer_and_wiring(client):
    """Test passing multiarrays as buffers and wiring Ndefs via sc(..., p={...})."""
    from asemic_py.namespace import Repl
    from conftest import clear_test_state, fresh_prefix

    got = collect(client, "asemic/io/supercollider/**")
    prefix = fresh_prefix()
    label = f"{prefix}sc_wire"
    repl = None
    try:
        assert verb(client, "supercollider", "start")["running"]
        assert wait(lambda: ("asemic/io/supercollider/ready", 1) in got, 60), got

        repl = Repl(Client())
        code = f'''with block("{label}", timestretch="0.0"):
    sc("src", "{{ SinOsc.ar(440) * 0.1 }}")
    sc("dst", "{{ |in = 0, buf = 0| var sig = In.ar(in, 1); sig }}", p={{"in": "~src", "buf": [[1.0, 2.0], [3.0, 4.0]]}})
'''
        out = repl.run_block(label, code)
        assert out == "", out

        # unfreeze block to trigger on_play
        client.put(f"asemic/state/block/{label}.timestretch", 1.0)

        assert wait(lambda: any(k == "asemic/io/supercollider/playing" and v == f"{label}_src" for k, v in got), 5), got
        assert wait(lambda: any(k == "asemic/io/supercollider/playing" and v == f"{label}_dst" for k, v in got), 5), got
        assert wait(lambda: any(k == "asemic/io/supercollider/buf_ready" and v[0] == f"{label}_dst" for k, v in got), 5), got
    finally:
        if repl is not None:
            repl.drop(label)
        clear_test_state(client, prefix)
        assert not verb(client, "supercollider", "stop")["running"]


@pytest.mark.skipif(not ORCA.exists() or not shutil.which("tmux"), reason="Orca-c not built (adapter build) / no tmux")
def test_orca_osc_reaches_zenoh(client):
    got = collect(client, "asemic/io/orca/**")
    try:
        assert verb(client, "orca", "start")["running"]
        assert wait(lambda: any(k == "asemic/io/orca/a" for k, _ in got), 15), got
    finally:
        verb(client, "orca", "stop")
    assert wait(lambda: subprocess.run(["tmux", "has-session", "-t", "asemic-orca"], capture_output=True).returncode, 10)
    assert wait(lambda: gone("orca"), 10)


@pytest.mark.skipif(not ORCA.exists() or not shutil.which("tmux"), reason="Orca-c not built (adapter build) / no tmux")
def test_orca_midi_reaches_zenoh_and_routes(client):
    """Orca's own virtual MIDI port ("asemic-orca", built w/ portmidi — scripts/build_orca.sh /
    adapter.toml build): a note sent into it (simulating the `:` operator) lands at
    asemic/io/orca/midi/** and, once routed, reaches the generic midi adapter's own port."""
    mido = pytest.importorskip("mido")
    got = collect(client, "asemic/io/orca/midi/**")
    try:
        assert verb(client, "orca", "start")["running"]
        assert wait(lambda: "asemic-orca" in mido.get_output_names(), 15)
        with mido.open_output("asemic-orca") as o:
            o.send(mido.Message("note_on", channel=0, note=60, velocity=127))
        assert wait(lambda: any(k == "asemic/io/orca/midi/note/1/60" for k, _ in got), 5), got
        assert verb(client, "midi", "start")["running"]
        try:
            client.call("route", ("asemic/io/orca/midi/note/1/60", "asemic/out/midi/note/1/60"))
            assert wait(lambda: "asemic-midi" in mido.get_input_names(), 5)
            with mido.open_input("asemic-midi") as i, mido.open_output("asemic-orca") as o:
                o.send(mido.Message("note_on", channel=0, note=60, velocity=127))
                msgs: list = []
                assert wait(lambda: msgs.extend(i.iter_pending()) or len(msgs) >= 1, 3), msgs
            assert (msgs[0].type, msgs[0].channel, msgs[0].note) == ("note_on", 0, 60)
        finally:
            client.delete("asemic/state/route/asemic_io_orca_midi_note_1_60_asemic_out_midi_note_1_60")
            verb(client, "midi", "stop")
    finally:
        verb(client, "orca", "stop")
    assert wait(lambda: "asemic-orca" not in mido.get_output_names(), 5)
    assert wait(lambda: gone("orca"), 10)


def test_midi_bridge_both_ways(client):
    mido = pytest.importorskip("mido")
    got = collect(client, "asemic/io/midi/**")
    try:
        assert verb(client, "midi", "start")["running"]
        assert wait(lambda: "asemic-midi" in mido.get_output_names(), 5)
        with mido.open_output("asemic-midi") as o:
            o.send(mido.Message("control_change", channel=0, control=74, value=127))
            o.send(mido.Message("note_off", channel=2, note=60))
        assert wait(lambda: len(got) >= 2, 3), got
        # distinct keys: zenoh orders per key only
        assert sorted(got[:2]) == [("asemic/io/midi/cc/1/74", 1), ("asemic/io/midi/note/3/60", 0)]
        with mido.open_input("asemic-midi") as i:
            time.sleep(0.3)
            client.session.put("asemic/out/midi/cc/1/7", "0.5")
            client.session.put("asemic/out/midi/note/10/36", "1")
            msgs: list = []
            assert wait(lambda: msgs.extend(i.iter_pending()) or len(msgs) >= 2, 3), msgs
        assert (msgs[0].type, msgs[0].control, msgs[0].value) == ("control_change", 7, 64)
        assert (msgs[1].type, msgs[1].channel, msgs[1].note, msgs[1].velocity) == ("note_on", 9, 36, 127)
    finally:
        assert not verb(client, "midi", "stop")["running"]
    assert wait(lambda: "asemic-midi" not in mido.get_input_names(), 3)
