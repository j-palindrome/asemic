# orca adapter

Livecoding adapter hosting Hundred Rabbits' [Orca-c](https://github.com/hundredrabbits/Orca-c) esoteric programming environment within asemic.

## Overview

- **Kind**: `process`
- **Execution**: Starts headless or terminal session in a dedicated tmux session named `asemic-orca`.
- **View integration**: Textual UI attaches inline or in split view using `tmux attach -t asemic-orca`.
- **Seed file**: Loads `asemic.orca` grid by default.
- **Config**: Configuration directory set via `XDG_CONFIG_HOME=conf` (`conf/orca.conf`).

## Lifecycle

- **Build**: Auto-clones `Orca-c` if absent and compiles binary using `./tool build [--portmidi|--no-portmidi] orca` depending on `brew` PortMidi availability.
- **Start**: Launches `orca-c/build/orca asemic.orca` inside tmux session `asemic-orca`.
- **Stop**: Terminates tmux session and kills lingering `orca` process.

## Transports & Keyspaces

- **OSC (`:`)**:
  - Orca OSC output routed to `127.0.0.1:49162`.
  - Brain exposes incoming messages under `asemic/io/orca/*`.
- **MIDI (`:`)**:
  - Connects through brain-hosted virtual MIDI port named `asemic-orca` (matching `conf/orca.conf`'s `portmidi_output_device`).
  - Prefix isolation: `prefix = "midi/"` keeps MIDI distinct from OSC addresses.
  - In: `asemic/io/orca/midi/{note,cc}/<ch>/<n>` (`0.0` .. `1.0`).
  - Out: `asemic/out/orca/midi/**` forwarded out to Orca's MIDI input.
