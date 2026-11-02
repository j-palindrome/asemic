# asemic-cli documentation

Welcome to the asemic-cli wiki. asemic-cli is a livecode REPL and runtime for generative audiovisual systems. You write Python-like scripts in a block-column terminal editor; each block produces point/texture data, controls parameters, routes values, and drives external adapters (Syphon, SuperCollider, Affinity, MIDI, Hue, etc.) over a Zenoh network. JACK audio output is available via `output(name, kind="jack")`.

Use the table of contents below to jump to a topic, or run `:guide` inside the REPL for the in-app guide.

---

## Contents

- [Quick start](quick-start.md)
- [Architecture](architecture.md)
- [REPL / TUI](repl-tui.md)
- [Livecode language](livecode.md)
- [Verb reference](verbs.md)
- [Adapters](adapters.md)
- [Examples](examples.md)
- [Configuration](configuration.md)
- [Development & tests](development.md)
- [Troubleshooting](troubleshooting.md)

---

## What asemic-cli is

- **Language**: Python blocks with a live REPL vocabulary (`param`, `proc`, `tex`, `route`, `output`, `affinity`, `sc`, ...). Every call is validated and executed by the Rust brain rather than interpreted directly in Python, so scripts cannot drift out of sync with the runtime schema.
- **Editor**: Terminal-based block-column UI (Textual) with Vim keybindings, inline parameter panels, image/ASCII previews, and an embedded Neovim row editor.
- **Runtime**: Rust workspace (`crates/`) plus a Python package (`asemic_py/`). The brain owns the clock, components, adapters, noisegens, and a GPU draw host. Zenoh moves data between the REPL, brain, adapters, and external apps.

## Repository layout

| path | purpose |
|------|---------|
| `asemic_py/` | Python REPL, client, UI, canvas/points codec |
| `crates/brain` | `asemic-brain` binary: verbs, engine, adapters host, clock |
| `crates/draw` | GPU draw host (wgpu, optional Syphon/JACK/camera) |
| `crates/font` | Variable-font builder + outline utilities |
| `crates/schema` | Shared schema, IDs, wire format |
| `crates/ids-py` | Rust ID resolver as Python extension (`_ids`) |
| `adapters/affinity/` | Affinity Publisher/Designer adapter (MCP) |
| `adapters/` | One folder per adapter: `adapter.toml` manifest + helper processes; adapter Rust crates live in a `crate/` subfolder (e.g. `adapters/affinity/crate/`), auto workspace members via the `adapters/*/crate` glob |
| `examples/` | REPL examples (run with `asemic <name>`) |
| `tests/` | pytest + snapshot tests |
| `config/` | Zenoh peer/router JSON5 configs |
| `scripts/` | `gen_api.py`, debug helpers |

## Common commands

```bash
# Rust only
cargo run --bin asemic-brain -- --schema   # print JSON schema bundle
cargo run --bin asemic-brain -- --verbs    # print verb table

# Python tests (need zenohd + asemic-brain; fixture brings them up)
uv run pytest

# regenerate API stubs / types
python scripts/gen_api.py
bash scripts/gen_types.sh
```
