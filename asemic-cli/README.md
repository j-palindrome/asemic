# asemic-cli

Livecode REPL and runtime for generative audiovisual systems.

> Write Python-like scripts in a block-column editor. Each block produces point/texture data, controls parameters, routes values, and drives adapters (Syphon, SuperCollider, Affinity, MIDI, Hue, etc.) over a Zenoh network. JACK audio output is also available via `output(name, kind="jack")`.

- **Language**: Python blocks with a live REPL vocabulary (`param`, `proc`, `tex`, `route`, `output`, `affinity`, `sc`, ...). Calls are forwarded to and validated by the Rust brain, so scripts cannot drift out of sync with the runtime schema.
- **Editor**: Terminal-based block-column UI (Textual) with Vim keybindings, inline parameter panels, image/ASCII previews, and an embedded Neovim row editor.
- **Runtime**: Rust workspace (`crates/`) plus a Python package (`asemic_py/`). The brain owns the clock, components, adapters, noisegens, and a GPU draw host. Zenoh moves data between the REPL, brain, adapters, and external apps.

**[→ Read the full documentation](help/index.md)**

---

## Quick start

```bash
# install Python package + Rust extension (uses uv + maturin)
uv sync
uv pip install -e .

# build the Rust workspace
cargo build --release

# start the REPL (auto-starts zenohd + asemic-brain)
asemic

# run an example
asemic plant
asemic gpgpu-particles --run
```

See [help/quick-start.md](help/quick-start.md) for detailed install and first-run instructions.

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

## Documentation index

- [Quick start](help/quick-start.md) — install, build, first run, common commands.
- [Architecture](help/architecture.md) — how the Python REPL, Rust brain, Zenoh, draw host, and clock fit together.
- [REPL / TUI](help/repl-tui.md) — starting the editor, navigation, key bindings, commands, panels.
- [Livecode language](help/livecode.md) — blocks, verbs, controls, generators, routing, textures, outputs, Python procs, variable fonts.
- [Verb reference](help/verbs.md) — alphabetical/grouped table of every REPL verb.
- [Adapters](help/adapters.md) — how adapters work and the bundled set.
- [Examples](help/examples.md) — example index and how to run them.
- [Configuration](help/configuration.md) — Zenoh configs, UI settings, environment variables.
- [Development & tests](help/development.md) — building, testing, regenerating generated files.
- [Troubleshooting](help/troubleshooting.md) — common problems and fixes.

## Autocomplete & Quickhelp Single Source of Truth

Quickhelp (man pages in the REPL) and row autocomplete (embedded Neovim omnifunc `AsemicOmni` and pylsp) share a single source of truth:
- **`asemic_py/_verbs.json`**: Generated automatically alongside `_types.py` and `_api.pyi` via `bash scripts/gen_types.sh`.
- It captures all verbs, signatures, docstrings, kwargs, types, and allowed enum choices (`ScoreNames`, `ScoreLayer`, `TexKind`, etc.).
- Both the Quickhelp panel (`asemic_py/columns.py`) and embedded Neovim autocomplete (`asemic_py/nvim/init.lua` via `asemic_py/nvim_view.py`) consume this file directly, guaranteeing instant parity between docs and autocompletion.

## License

See the top-level project `LICENSE`.
