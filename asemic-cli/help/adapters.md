# Adapters

Adapters bridge asemic to external apps and hardware. Each adapter = one folder under `adapters/`: an `adapters/<name>/adapter.toml` manifest (`crates/schema/src/lib.rs::AdapterManifest`) plus whatever the backend needs (scripts, adapter assets, and for Rust backends a crate — `Cargo.toml` + `src/` — in the `crate/` subfolder). The workspace glob member `adapters/*/crate` includes every adapter crate in the build automatically (cargo requires a manifest at each glob match, so adapters without a `crate/` simply don't match). The brain discovers adapters by scanning `adapters/*/adapter.toml` on startup and exposes them through `build` / `stop` / `status` / `adapters` verbs.

## How adapters work

A manifest declares:

- `adapter` — name, kind, description, readiness behavior.
- `lifecycle` — `build`, `start`, `stop`, `run`, and environment variables.
- `param` — parameter specs surfaced by the brain.
- `io` — named input/output plugs.
- `zenoh` — additional keys the adapter subscribes/publishes.
- `osc` / `midi` — brain-owned transport bridges.
- `view` — how the TUI attaches a viewer to a running process (e.g. the `orca` adapter declares its tmux session/attach command here so the inline row view can connect without hard-coding adapter details).

Adapter kinds:

| kind | behavior |
|------|----------|
| `process` | Long-running child process owned by the brain. |
| `python` | Python script run in the repo venv (`ASEMIC_PYTHON` or `.venv/bin/python`). |
| `bridge` | No process: brain owns OSC/MIDI transport only. |
| `app` | External GUI app launched/quit by the brain. |
| `cli` | One-shot command invoked per request. The manifest's `lifecycle.run` is an argv template (e.g. `uv run --directory "${HOME}/..." python -m infinite_researcher.cli research {query}`). A `put` on an "in" plug executes it; stdout streams to the first "out" plug, and a final `.../done` key carries the exit code. |

Open the adapters panel with `:adapters` to start/stop adapters visually, or call the verbs `build(name)`, `stop(name)`, and `status(name)` from code. Adapters started inside a block can be tied to the block lifecycle (`adapters::follow_blocks`).

## Bundled adapters

| adapter | what it does | kind |
|---------|--------------|------|
| `supercollider` | Boots `scsynth` via `sclang boot.scd`; brain sends OSC to `/set/<name>` (value as arg) and receives on `asemic/io/supercollider/*`. | process |
| `hue` | Python adapter that drives Philips Hue lamps from `arena` (xy), `chaos` (noise), and `intensity` components. | python |
| `midi` | Creates a virtual MIDI port pair `asemic-midi`; maps CC/note to `asemic/{io,out}/midi/...`. | bridge |
| `orca` | Runs Orca-c in a tmux session; OSC → `asemic/io/orca/*`, MIDI → `asemic/io/orca/midi/*`. | process |
| `affinity` | Draws gen multiarrays into the current Affinity document via its MCP server. | process |
| `infinite-researcher` | `cli` adapter that runs a web search + Ollama synthesis per query. | cli |

## Adapter outputs in routes

Destination names like `supercollider.set.freq` resolve to `asemic/out/supercollider/set/freq`. The brain forwards the value over the adapter's transport. For example:

```python
route("arena.x", "supercollider.set.freq", frm=(-1, 1), to=(40, 2000))
```

writes to `asemic/out/supercollider/set/freq`, which the SuperCollider adapter forwards via OSC.

## Brain OSC Transport & Message Sizing

Brain-owned OSC bridges (`crates/brain/src/bridges.rs`) translate Zenoh keys `asemic/out/<adapter>/**` to UDP OSC packets sent to `<adapter>.send`.

- **Maximum Safe Datagram**: `MAX_OSC_DATAGRAM_BYTES = 1400` bytes (guarantees packets fit within standard Ethernet MTU without fragmentation or host drops).
- **Enforcement**:
  - The brain measures every encoded OSC packet against `MAX_OSC_DATAGRAM_BYTES`. Packets exceeding the limit are dropped before transmission and logged to `asemic/err/<adapter>/osc` rather than crashing the destination audio host (such as `sclang` throwing `std::runtime_error: Bad OSC message size`).
  - Producers transmitting multiarrays or sequences (e.g. `sc()` in `asemic_py/namespace.py`) dynamically chunk points into payload blocks under `MAX_OSC_CHUNK_BYTES = 900` bytes. Each chunk contains a measured subset of points based on dimension count, and the destination adapter reassembles them before committing to server buffers or sequence playback.

## Inline viewer (`view` field)

The optional `[view]` section tells the TUI how to attach an inline viewer to a running process without hard-coding adapter details. It has three fields:

| field | meaning |
|-------|---------|
| `attach` | shell command to open the viewer, e.g. `tmux attach -t asemic-orca` |
| `session` | tmux session name the process runs in |
| `seed` | seed file relative to the adapter directory |

The `orca` adapter uses this to let the TUI open the Orca grid in a side pane. Viewers never start or stop the adapter themselves; they only attach to the process the brain already launched.

## Relevant source files

- `crates/brain/src/adapters.rs` — adapter host.
- `crates/schema/src/lib.rs` — `AdapterManifest` schema.
- `adapters/*/adapter.toml` — bundled manifests.
