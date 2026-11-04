---
id: "SC Startups"
aliases: []
tags: []
---
<!--
prompt: inspect previous SC logs and textual logs: I just ran it and hitting PLAY on
  block('readyfire') only plays for a second before being cut off. the first time
  nothing played. the second time it did play. third time it was cut off. this has
  been a very consistent issue that constantly reoccurs.

  follow-up: make sure this happens every time. sc needs to verify other processes
  before starting etc. no zombie processes.

summary:
- Diagnosis: sclang orphans accumulate across runs and keep UDP 57120 bound. A
  cargo-watch rebuild or a SIGKILLed brain leaves the previous sclang alive (it runs
  in its own process group, so nothing TERMs it), and its scsynth is orphaned with it.
- The next sclang cannot bind 57120 and silently binds 57121 instead, while the brain
  keeps sending OSC to 57120 -- where the zombie has no scsynth at all.
- There, `/def` sets `~asemic_node_ready[<voice>] = false` and `~playNdef`'s
  `fork { s.sync; ... }` never completes, so every Tdef parks at `nodeCond.wait`
  after roughly one second and never resumes: audible for ~1s, silent forever.
- Why it looked like an app bug: the block's `timestretch` stayed 1.0 throughout.
  Tracing proved 6 space presses produced exactly 6 `action_toggle_play_row` and 6
  `action_set_timestretch` calls, no duplicate dispatch, and no `0.0` write after a
  play -- the TUI was never pausing the block.
- Evidence: `lsof` showed a stale sclang (ppid 1) holding 57120; sclang logged
  "port collision: sclang bound to UDP 57121 instead of 57120"; `/status` to 57120
  answered `[0,0,0.0,0]` (serverRunning false); the `readyfire_voice` synth node
  stayed allocated with `gate = 1` while the `trig` control froze.
- Fix (adapters/supercollider/start.sh, now the adapter's `start` command), run on
  every cold start: reap our own stale sclang holding 57120 (matched by `boot.scd`
  in its command line), reap a scsynth orphaned to init holding 57110 (a
  SuperCollider GUI's server keeps a live parent, so it is never touched), and
  refuse to start at all if 57120 is still held by anything else.
- Fix (boot.scd): exit on a language-port collision instead of limping on the wrong
  port, so the adapter start fails loudly ("exited before ready") rather than
  producing silent blocks.
- Verified: stale-holder reap frees 57120; a foreign holder exits 1 and prints its
  command line; free ports exec sclang unchanged. No sclang, scsynth or zombie
  processes remain and both ports are free.
- Diagnostic probes kept: `/debug_state <tdef-id> <target>` in boot.scd replies on
  zenoh `asemic/io/supercollider/debug_reply` with Tdef.isPlaying, Ndef
  monitoring/running, `~asemic_node_ready` and the Ndef key list.

— Claude Code, 2026-11-03
-->
