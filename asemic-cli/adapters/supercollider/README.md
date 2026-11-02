# supercollider adapter

Audio synthesis adapter controlling SuperCollider (`sclang` and `scsynth`) from asemic.

## Overview

- **Kind**: `process`
- **Binary**: Boots sclang via `/Applications/SuperCollider.app/Contents/MacOS/sclang boot.scd`.
- **Lifecycle**: Brain spawns sclang in its own process group, terminating `sclang` and child `scsynth` on adapter stop.
- **Audio engine**: Sets up `\asemicVoice` SynthDef (filtered resonant saw voice) and dynamic `Ndef` node graph management.

## Transports & Protocols

- **OSC Listen**: Port `57130` (`sclang` -> brain: `/ready`, `/playing`, `/buf_ready`, `/error`, `asemic/io/supercollider/*`).
- **OSC Send**: `127.0.0.1:57120` (brain -> `sclang`).

## OSC Command Interface

- `/set/<param> <val>`: Updates voice parameters on active `\asemicVoice` (e.g. `freq`, `amp`, `cutoff`, `res`).
- `/def <id> <code>`: Evaluates SuperCollider function string and runs named `Ndef(<id>)`.
- `/bdef <id> <key> <data>`: Allocates / sends multiarray buffer data into `~asemic_buffers`, automatically bound to `Ndef(<id>)` control `<key>`.
- `/map <dst_id> <param> <src_id>`: Maps node proxy parameter to another Ndef output (`Ndef(dst).map(param, Ndef(src))`).
- `/nset <id> <param> <val>`: Sets parameter `<param>` on `Ndef(<id>)`.
- `/free <id>`: Stops and frees `Ndef(<id>)` with a crossfade.

## Zenoh Routing

- `asemic/out/supercollider/set/<param>`: Automatically forwarded by brain to `/set/<param>` OSC.
- `asemic/io/supercollider/*`: Incoming OSC messages mapped into Zenoh space.
