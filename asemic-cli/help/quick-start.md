# Quick start

This page gets asemic-cli installed and running on your machine.

## Requirements

- Python 3.12+ (the project uses `uv` for environment management).
- Rust toolchain with Cargo (edition 2024).
- macOS is the primary target; many features (Syphon, Affinity, JACK bindings) are macOS-centric.

## Install

```bash
# 1. Install the Python package + Rust extension (uses uv + maturin)
uv sync
uv pip install -e .

# 2. Build the Rust workspace
cargo build --release
```

`uv pip install -e .` builds `crates/ids-py` as a PyO3 extension (`asemic_py._ids`) via maturin. Do **not** build `crates/ids-py` with plain `cargo build`; it is not a default workspace member for that reason.

## Start the REPL

```bash
# Auto-starts zenohd + asemic-brain, then opens the TUI
asemic
```

The first launch may take a while because maturin builds the ID resolver and cargo builds the workspace. Once the TUI is up, you will see a block-column editor.

## Run an example

```bash
# Open an example file
asemic plant

# Open and immediately evaluate all blocks
asemic gpgpu-particles --run
```

Examples live in `examples/`. Each is a Python file using `with block(...)` contexts. Run `:guide` inside the REPL to see the full index.

## Basic REPL workflow

1. **Navigate**: use `↑↓` / `kj` to move between rows, `→` / `l` to enter a block, `←` / `h` to exit.
2. **Evaluate**: press **Enter** on a row to evaluate its block. Use `:run` or **Ctrl+R** to run everything.
3. **Play/pause**: press **Space** on a block row to toggle `timestretch` between `0.0` and `1.0`.
4. **Edit**: press **i** to edit the current row in the embedded Neovim editor.
5. **Quit**: press **Ctrl+Q** or type `:q`.

## Common commands

```bash
# Print the brain's JSON schema bundle
cargo run --bin asemic-brain -- --schema

# Print the authoritative REPL verb table
cargo run --bin asemic-brain -- --verbs

# Restart brain + router
asemic --restart

# Use a custom Zenoh config
asemic --config path/to/peer.json5

# Run tests
uv run pytest

# Regenerate generated files after schema changes
python scripts/gen_api.py
bash scripts/gen_types.sh
```

## Next steps

- Read the [architecture overview](architecture.md) to understand how the pieces fit together.
- Read the [livecode language guide](livecode.md) to learn the verb vocabulary.
- Browse the [adapters](adapters.md) to connect external apps.
