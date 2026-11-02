# Asemic

Creative-coding workspace. Active development happens in [`asemic-cli`](asemic-cli/); everything else is archived under [`legacy/`](legacy/) for reference.

> **Recommendation for future work:** keep building [`asemic-cli`](asemic-cli/). It is the current runtime, the richest project, and the one wired into live performance tools (Syphon, SuperCollider, Affinity, MIDI, JACK, Hue, etc.).

## Active projects

### [`asemic-cli/`](asemic-cli/) — livecode REPL and runtime

Rust + Python livecoding environment for generative audiovisual systems. Write block-based Python-like scripts in a terminal UI; the Rust brain executes them, routes parameters, runs GPU compute/draw nodes, and drives external apps over Zenoh.

See [`asemic-cli/README.md`](asemic-cli/README.md) for full details.

Highlights:
- **Rust workspace** (`crates/`): `brain` (engine, verbs, adapters host, clock), `draw` (wgpu GPU host, optional Syphon/JACK/camera), `font` (variable-font builder), `schema` (shared IDs/wire format), `adapter-affinity` (Affinity Publisher/Designer SSE adapter), `ids-py` (Rust ID resolver as Python extension).
- **Python package** (`asemic_py/`): terminal REPL/UI (Textual, Vim keybindings, embedded Neovim row editor), canvas/points codec, namespace helpers.
- **Adapters** (`adapters/`): Affinity, Hue, infinite-researcher, MIDI, Orca, SuperCollider.
- **Examples** (`examples/`): run with `asemic <name>` — `startup`, `plant`, `gpgpu-particles`, `supercollider`, `hue-inferno`, etc.
- **Tests**: `uv run pytest` (spawns Zenoh router + brain automatically).

Quick start:
```bash
cd asemic-cli
uv sync
uv pip install -e .        # builds the Rust ID extension via maturin
cargo build --release      # builds asemic-brain and the workspace
asemic                     # starts the REPL (auto-spawns zenohd + asemic-brain)
asemic plant               # run an example
```

Useful commands:
```bash
# print runtime verb table / schema
cargo run --bin asemic-brain -- --verbs
cargo run --bin asemic-brain -- --schema

# tests
uv run pytest
uv run pytest -m surfaces  # opt-in surface screenshots

# regenerate API stubs / types
python scripts/gen_api.py
bash scripts/gen_types.sh
```

### [`ReadyFire/`](ReadyFire/)

A ready/fire cueing scaffold for asemic-cli. Contains:
- `readyfire.py` — blank asemic-cli block script / starting template
- `run_birds_only.py` — focused runner
- `affinity/` — Affinity-side score parsing and draw operations consumed by [`adapters/affinity`](asemic-cli/adapters/affinity/)
- `ReadyFire.md` — project notes

This is a content project built *on top of* `asemic-cli`, not a separate runtime.

## Deprecated / archived projects

These projects are **not actively maintained** and are kept in [`legacy/`](legacy/) only for reference. Do not start new work here unless you are explicitly reviving one.

| path | what it was | why it is deprecated |
|------|-------------|----------------------|
| [`legacy/asemic-site/`](legacy/asemic-site/) | Leptos + Axum starter template for web apps | Superseded by the Rust/Python runtime in `asemic-cli`; no active web-app goal |
| [`legacy/ipad-drawing/`](legacy/ipad-drawing/) | Tauri + React + TypeScript iPad drawing app with Hydra-style effects | Replaced by the GPU drawing pipeline in `asemic-cli` |
| [`legacy/rust-controls/`](legacy/rust-controls/) | Dioxus 0.7 control-system experiment | Functionality folded into `asemic-cli`'s parameter routing and TUI panels |
| [`legacy/Wave Collapse/`](legacy/Wave%20Collapse/) | Wave-function-collapse standalone | Interesting prototype; not wired to the current runtime |

## History / project evolution

- **Before 2026-09-27** — `asemic-site` and `ipad-drawing` existed as submodules under `Code/`.
- **2026-09-27** — both were moved under `Projects/Asemic/` to form a shared umbrella.
- **2026-10-09** — `asemic-cli` was created as the new unified runtime: multiarray data model, L-systems, variable fonts, GPU shader linker, ASCII textures, Python TUI, and brain lifecycle.
- **2026-10-10** — the `asemic` launcher, block/column editor, startup session, textual snapshots, and Orca embed landed.
- **2026-10-13** — example directory config, SuperCollider example, and XY-pad controls.
- **2026-10-19** — `infinite-researcher` adapter and search skill work.
- **2026-10-24** — [`ReadyFire`](ReadyFire/) created alongside the Affinity adapter (pitch/duration parsers, score ops, Affinity render script).
- **2026-10-25** — major refactor week: slash IDs (`a/b/c.field`), `embed()` previews replacing `view()`, `py` proc kind evaluated in the REPL, Affinity MCP server integration, row persistence, on-demand rendering, and the "twelve" chromatic-staff mode.
- **2026-10-26** — `Wave Collapse` moved into `legacy/`, redundant `rust-controls` submodule removed, SuperCollider `sc()` Ndef row added, snapshot tests stabilized, and several Zenoh backpressure/deadlock bugs fixed.

## Repository conventions

- Use the per-project READMEs for build/test instructions; the top-level file is only the map.
- `asemic-cli` uses `uv` for Python and `cargo` for Rust. Do **not** mix `pip` into its venv.
- `workspace.json` at the repo root is intentionally empty / unused; ignore it.

## License

No top-level license file exists yet. Each active project is expected to get its own license; see per-directory notes. `legacy/asemic-site/LICENSE` applies only to that legacy template.
