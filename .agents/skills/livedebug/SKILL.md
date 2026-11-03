---
name: livedebug
ι: 4.3
description: Inspect and verify live running asemic audio/visual output, SuperCollider synthesis, scsynth node tree, and adapter sound.
---

# /livedebug

- 1 Scope & purpose
	- 1.1 Live runtime inspection of active asemic session without guessing
	- 1.2 Verifies whether SuperCollider (scsynth/sclang) is actively synthesizing audio, has active nodes/synths, or is silent
	- 1.3 Checks brain session state, block frozen/timestretch status, and Zenoh key exchanges
- 2 SuperCollider live audio verification
	- 2.1 Check running audio daemons:
		- 2.1.1 `pgrep -fl sclang` (sclang host running on UDP 57120)
		- 2.1.2 `pgrep -fl scsynth` (synthesis engine running on UDP 57110)
	- 2.2 Direct scsynth status check via UDP 57110:
		- 2.2.1 Send OSC `/status` to `127.0.0.1:57110`
		- 2.2.2 Reply format `/status.reply`: `[1, numUGens, numSynths, numGroups, numSynthDefs, avgCPU, peakCPU, nomSampleRate, actSampleRate]`
		- 2.2.3 Audio playing condition: `numSynths > 0` and `avgCPU > baseline` (~0.02 is idle); if `numSynths == 0`, NO sound is synthesized
	- 2.3 Direct scsynth node tree dump:
		- 2.3.1 Send OSC `/g_dumpTree` `[0, 1]` to `127.0.0.1:57110` (group 0, include controls)
		- 2.3.2 scsynth prints running node tree to stdout -> inspect via `tail -n 30 asemic-cli/state/brain.log`
		- 2.3.3 If output is only `NODE TREE Group 0 \n 1 group \n 2 group`, no synth nodes exist
	- 2.4 sclang inspection queries via UDP 57120:
		- 2.4.1 `/status` -> brain receives `/status_reply`
		- 2.4.2 `/dump_tree` -> brain receives `/tree_reply` with list of Ndefs & Tdefs
		- 2.4.3 `/inspect_bus [name]` -> returns bus rate, channels, peak audio amplitude
- 3 Session & block timing verification
	- 3.1 Check block timestretch via Zenoh:
		- 3.1.1 Query `asemic/state/block/<label>.timestretch`
		- 3.1.2 If `timestretch == 0.0` or missing: block is frozen; procs do not step, row lifecycle guards hold adapters paused/stopped
	- 3.2 Check session ownership & registration:
		- 3.2.1 Query `asemic/state/session/<block>` for current code and owned components
		- 3.2.2 Query `asemic/err/**` for uncaught runtime errors or port collisions
