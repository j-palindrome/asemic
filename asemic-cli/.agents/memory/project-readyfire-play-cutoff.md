---
name: project-readyfire-play-cutoff
description: ReadyFire block plays ~1s then falls silent; verified cause is the SC Tdef, not the app
metadata:
  type: project
---

Ongoing debug (2026-11-03): pressing space on block `readyfire` plays ~1 s then audio stops, while the block stays at `timestretch=1.0`.

**Verified (✓):**
- App is not self-pausing — 6 key presses produce exactly 6 `action_toggle_play_row` → 6 `action_set_timestretch` calls; no duplicate dispatch, no `0.0` PUT afterwards.
- The `readyfire_voice` Ndef synth node stays allocated and `gate=1` throughout the silence.
- The `readyfire_seq` Tdef stops advancing: its `trig` control freezes and only moves again after a manual `/play readyfire_seq` to sclang 57120.
- Replaying the exact captured OSC burst (`/play`, `/stop`, `/def`, `/stop`, `/tdef`, `/map`) from a healthy state does **not** reproduce the stop.

**Still unknown (?):** what stops the Tdef ~1 s in — `Tdef.isPlaying`, `~asemic_node_ready[readyfire_voice]` and the Ndef key list are readable via the temporary `/debug_state <tdef-id> <target>` handler in `adapters/supercollider/boot.scd` (replies arrive on zenoh `asemic/io/supercollider/debug_reply`).

Probe recipes that work: `pythonosc` against scsynth 57110 for `/g_queryTree 0 1` (control values incl. `trig`), and zenoh subscription to `asemic/io/supercollider/**` for sclang→brain replies. Hand-rolled OSC must pad to 4 bytes *after* the null terminator or scsynth rejects the args. See [[feedback-push-every-message]].
