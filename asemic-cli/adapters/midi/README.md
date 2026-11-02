# midi adapter

Virtual MIDI bridge adapter connecting asemic to external DAW, hardware, or software synthesizers.

## Overview

- **Kind**: `bridge` (no separate child process; transport owned directly by `asemic-brain`).
- **Port**: Creates a virtual MIDI input/output port pair named `asemic-midi` via CoreMIDI / ALSA.

## Zenoh Keyspace & Mapping

Values are normalized to floating-point range `0.0` .. `1.0` (mapped to/from standard MIDI 7-bit `0` .. `127`).

- **Input (MIDI Hardware/DAW -> Zenoh)**:
  - `asemic/io/midi/note/<ch>/<note>`: Note on/off velocity (velocity `0` = Note Off).
  - `asemic/io/midi/cc/<ch>/<cc>`: Continuous controller values.
- **Output (Zenoh -> MIDI Hardware/DAW)**:
  - `asemic/out/midi/note/<ch>/<note>`: Emits MIDI Note On events with scaled velocity.
  - `asemic/out/midi/cc/<ch>/<cc>`: Emits MIDI Control Change messages.
