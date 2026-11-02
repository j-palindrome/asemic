# Development & tests

This page explains how to build, test, and regenerate the generated files in asemic-cli.

## Build

```bash
# Python side + PyO3 extension
uv sync
uv pip install -e .

# Rust workspace
cargo build --release
```

Note: `crates/ids-py` is a PyO3 extension and is **not** a default workspace member. It is built by maturin during `uv pip install -e .`; do not build it with plain `cargo build`.

Adapter Rust crates are workspace members without any registration: they live in a `crate/` subfolder of the adapter folder (`adapters/<name>/crate/`, beside that adapter's `adapter.toml`), and the workspace includes them automatically via the glob members `members = ["crates/*", "adapters/*/crate"]` — cargo requires every glob-matched path to hold a manifest, so manifest-less adapters (manifest-only / Python / external binaries) simply don't match. Adding a Rust adapter = create `adapters/<name>/crate/` with a `Cargo.toml`; no workspace edit.

## Tests

```bash
# unit + live tests (fixtures bring up zenohd + asemic-brain automatically)
uv run pytest

# opt-in surface debug screenshots
uv run pytest -m surfaces
# or
ASEMIC_SURFACES=1 uv run pytest
```

There are also Rust unit tests in each crate:

```bash
cargo test -p asemic-schema
cargo test -p asemic-brain
cargo test -p asemic-draw
```

## Regenerate generated files

These files are derived from the Rust schema and should not be hand-edited:

```bash
# asemic_py/_schema.json and asemic_py/_keys.py
UPDATE_WIRE=1 cargo test -p asemic-schema

# asemic_py/_schema.json golden (brain side)
UPDATE_WIRE=1 cargo test -p asemic-brain schema_golden

# asemic_py/_api.pyi (typed verb signatures)
python scripts/gen_api.py

# asemic_py/_types.py (TypedDicts) + _verbs.json (metadata for quickhelp & autocomplete)
bash scripts/gen_types.sh
```

`asemic_py/_keys.py` is produced by `crates/schema/tests/gen_python_wire.rs` as part of the above `UPDATE_WIRE=1 cargo test -p asemic-schema` run.

| generated file | produced by | purpose |
|----------------|-------------|---------|
| `asemic_py/_schema.json` | `--schema` / `UPDATE_WIRE=1 cargo test` | JSON schema bundle |
| `asemic_py/_types.py` | `scripts/gen_types.sh` | TypedDicts for Python |
| `asemic_py/_verbs.json` | `scripts/gen_types.sh` (`gen_api.py`) | Single source of truth for Quickhelp & autocomplete metadata |
| `asemic_py/_api.pyi` | `scripts/gen_api.py` | typed verb signatures for editor completion |
| `asemic_py/_keys.py` | `crates/schema/tests/gen_python_wire.rs` | Zenoh keyspace helpers |

## Useful brain diagnostics

```bash
# Print the schema bundle
cargo run --bin asemic-brain -- --schema

# Print the verb table
cargo run --bin asemic-brain -- --verbs

# Run the brain with debug logging
RUST_LOG=debug cargo run --bin asemic-brain -- --config config/peer.json5
```

## Project layout for developers

| path | purpose |
|------|---------|
| `asemic_py/` | Python REPL, client, UI, canvas/points codec |
| `crates/brain` | `asemic-brain` binary: verbs, engine, adapters host, clock |
| `crates/draw` | GPU draw host (wgpu, optional Syphon/JACK/camera) |
| `crates/font` | Variable-font builder + outline utilities |
| `crates/schema` | Shared schema, IDs, wire format |
| `crates/ids-py` | Rust ID resolver as Python extension |
| `adapters/affinity/` | Affinity adapter (manifest + Rust crate in one folder) |
| `adapters/` | One folder per adapter: `adapter.toml` manifest + helper processes; adapter Rust crates live in a `crate/` subfolder, auto workspace members via the `adapters/*/crate` glob |
| `examples/` | REPL examples |
| `tests/` | pytest + snapshot tests |
| `config/` | Zenoh configs |
| `scripts/` | Codegen and debug helpers |
