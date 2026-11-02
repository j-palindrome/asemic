# Architecture

asemic-cli is split into a **Python frontend** (REPL / editor) and a **Rust backend** (brain + draw host). They communicate over **Zenoh**, a pub/sub/query messaging layer. This page explains the runtime split, the Zenoh keyspaces, block scoping, component lifecycle, clock model, and draw host.

## Runtime split: Python REPL + Rust brain

`asemic` is the Python TUI entry point (`asemic_py/app.py`). It opens a Zenoh session, discovers `asemic-brain`, and presents a livecoding editor. When you evaluate a block, the Python side runs the block code as plain Python inside a namespace. Every livecode helper (`param`, `route`, `tex`, ...) forwards a `(verb, args, kwargs, label)` message to the brain over Zenoh and returns the brain's reply.

The Rust brain (`crates/brain/src/main.rs`) is the source of truth:

- validates and owns all components, routes, cues, and adapter state,
- runs the component/noise engine (`crates/brain/src/engine.rs`),
- publishes the transport clock (`crates/brain/src/clock.rs`),
- hosts adapters (`crates/brain/src/adapters.rs`: discovered by scanning `adapters/*/adapter.toml` at runtime),
- owns the GPU draw graph (`crates/draw`),
- answers verb queries on `asemic/brain/do`.

On macOS the main thread parks in the Cocoa run loop (required for Syphon); the brain logic runs on a Tokio runtime on worker threads.

## Zenoh keyspaces

| key pattern | meaning |
|-------------|---------|
| `asemic/brain/do` | REPL → brain verb requests (query/response) |
| `asemic/brain/verbs` | brain → REPL verb table (for completions) |
| `asemic/brain/status` | brain uptime + adapter list |
| `asemic/brain/ready` | liveliness token: brain is up |
| `asemic/state/component/<id>` | component definition (validated JSON) |
| `asemic/state/route/<id>` | route definition |
| `asemic/state/param/<id>.<key>` | manual parameter edits / overrides |
| `asemic/state/cue/<id>` | cue definitions |
| `asemic/state/ui` | UI/perf settings (`ui` verb) |
| `asemic/state/block/<label>.timestretch` | per-block speed (0 = frozen) |
| `asemic/state/block/<label>.length` | per-block playback length |
| `asemic/state/block/<label>.loop` | per-block loop envelope |
| `asemic/block/<label>.time` | live playhead seconds for a block |
| `asemic/block/<label>.step` | COOK: play exactly one frame |
| `asemic/value/<id>.<channel>` | live scalar output of a component |
| `asemic/gen/<id>` | binary point multiarray from a proc |
| `asemic/tex/<id>.param.<i>` | texture-node uniform parameter |
| `asemic/state/tex/<id>` | texture-node metadata (`NodeInfo`) |
| `asemic/preview/<id>` | demand-gated terminal preview frame |
| `asemic/preview/<id>.size` | terminal cell size of a preview box |
| `asemic/state/preview/<id>.kind` | producer-declared preview renderer (`dots`/`image`/`ascii`) |
| `asemic/state/pause/<scope>` | legacy pause scope (still present; `timestretch` is preferred) |
| `asemic/out/<adapter>/<path>` | brain → adapter control output |
| `asemic/io/<adapter>/<path>` | adapter → brain input stream |
| `asemic/adapter/<name>/{schema,status,build,start,stop}` | adapter host verbs |
| `asemic/py/<id>` | query from brain to REPL for a `py` proc |
| `asemic/py/<id>.out` | REPL reply to a `py` proc query |
| `asemic/meta/<id>.props` | generator/plugin parameter defaults |
| `asemic/meta/<id>.attrs` | proc live point dimensions |
| `asemic/state/session/<label>` | block ownership (survives frontend restart) |
| `asemic/state/vfont/<name>` | built variable-font path + metadata |
| `asemic/block/<label>.cook` | brain → engine/adapter after a COOK frame |
| `asemic/gen/<label>.loop` | resolved loop envelope for a block |
| `asemic/clock` | tempo ticks (RealTime, express) |
| `asemic/state/clock` | tempo state (`bpm`, `ppq`, `beats_per_bar`) |

## Block scoping & IDs

Every declared id lives at a block path. The canonical form is a `/`-joined path (`drawing/ink`). `block()` contexts nest, so:

```python
with block("drawing"):
    proc("ink", ...)
```

creates `drawing/ink`.

References resolve relative to the calling block:

| written form | resolves to (inside block `a/b`) |
|--------------|----------------------------------|
| `ink` or `./ink` | `a/b/ink` |
| `../x` | `a/x` |
| `/top/x` | `top/x` |
| `asemic/...` | passed through as an absolute Zenoh key |

Field pickers attach after the last segment: `ink.value`, `ink:vx`, `ink.attr.hue`. The resolver lives in `crates/schema/src/ids.rs` and is exposed to Python as `asemic_py._ids`.

## Components & lifecycle

A component is a JSON document stored at `asemic/state/component/<id>`. The brain validates it against `crates/schema/src/lib.rs` types. Components are owned by the block label that created them. When a block is re-evaluated successfully, the brain deletes anything the block created last time but did not recreate this time. If evaluation fails, stale state is kept so you can fix and re-run without losing everything.

Per-block state is tracked in `asemic/state/session/<label>` so sessions survive a restart of the frontend (the brain restores ownership on startup from `verbs.rs`).

## Clock, blocks & time

There are two timing layers:

1. **Global transport clock** (`tempo(bpm, ppq, beats_per_bar)`) publishes `asemic/clock` ticks for adapters and music-aware procs.
2. **Per-block playhead** (`block(..., timestretch=..., length=..., loop=...)`) advances independently. `timestretch=0.0` freezes a block; `1.0` is real-time; negative values reverse. `length` bounds playback in seconds. `loop` can be `"off"` (play once), `"loop"` (repeat), or `"pingpong"` (bounce). The live playhead is published at `asemic/block/<label>.time` and fed to shaders as `info.time`.

Press **Space** on a block row to toggle play/pause (0.0 ↔ last nonzero timestretch). The **COOK** button in the block panel advances the block by exactly one frame.

## Draw host & previews

`crates/draw` hosts a wgpu compute/render graph. Texture nodes (`tex`) and outputs (`output`) run here. Previews are demand-gated: the brain only publishes frames to `asemic/preview/<id>` while at least one Zenoh subscriber exists, so a hidden or unviewed node costs nothing. The frontend can render previews as dots, ASCII, halfcell/quarter-block characters, sixel, kitty TGP, or Unicode, depending on terminal capability and the `ui(image=...)` setting.

## Frontend state mirror

The Python UI mirrors brain state so panels can render without querying on every frame. `asemic_py/state.py` subscribes to the keyspaces listed in `crates/schema/src/lib.rs::keys::SPACES` (codegen'd to `asemic_py/_keys.py`). `asemic_py/_types.py` provides TypedDicts generated from `asemic_py/_schema.json` (the output of `asemic-brain --schema`). `asemic_py/_api.pyi` gives the embedded Neovim editor typed completions for every verb. If the UI and brain disagree, regenerate these files with `UPDATE_WIRE=1 cargo test` and `scripts/gen_api.py`/`gen_types.sh`.

## Relevant source files

- `crates/brain/src/main.rs` — brain startup and task wiring.
- `crates/brain/src/verbs.rs` — verb request handler and state ownership.
- `crates/brain/src/engine.rs` — component/noise engine and block timing.
- `crates/brain/src/clock.rs` — transport clock.
- `crates/brain/src/adapters.rs` — adapter host: scans `adapters/*/adapter.toml` at runtime; each adapter's Rust crate (when present) lives in `adapters/<n>/crate/` and joins the build via the workspace `adapters/*/crate` glob member.
- `crates/schema/src/lib.rs` — schema types.
- `crates/schema/src/ids.rs` — ID resolution.
- `crates/draw/src/host.rs` — GPU draw host.
