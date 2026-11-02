---
name: add-adapter
ι: 4.3
description: Use when J says "/add-adapter <name>" or asks to add an asemic adapter / renderer row / external-app backend (Affinity, Hue, Orca, MIDI, ...). Scaffolds the row verb + adapter pair in asemic-cli with the proper structure and avoids the known gotchas.
---

# /add-adapter <name>

- 1 Spec refs
	- 1.1 Canonical: [adapters.md](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/help/adapters.md) (manifest layout, kinds, lifecycle)
	- 1.2 Zenoh keyspace: [architecture.md](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/help/architecture.md)
	- 1.3 Workspace/build: [development.md](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/help/development.md)
	- 1.4 Working template: `asemic-cli/adapters/affinity/` (manifest `adapter.toml` + crate `crate/Cargo.toml` + `crate/src/`) + verb [namespace.py](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/asemic_py/namespace.py)
	- 1.5 Read §1.1–1.4 before writing; ask J only backend specifics (app/protocol/lib), !! ask structure
- 2 Workflow
	- 2.1 Locate external app Rust lib (crates.io / firecrawl / ketch docs); !! hand-roll protocol client
	- 2.2 Scaffold `asemic-cli/adapters/<n>/`:
		- 2.2.1 Backend = Rust crate: `asemic-cli/adapters/<n>/crate/` (`Cargo.toml` + `src/` inside; `adapter.toml` beside)
		- 2.2.2 Workspace auto-includes via `adapters/*/crate` glob; deps = `zenoh`, `asemic-schema = { path = "../../../crates/schema" }`; !! Python backends
		- 2.2.3 Pure transform modules in crate; no zenoh in transforms
		- 2.2.4 `main.rs`: `NAME = env ASEMIC_ADAPTER`; sub `asemic/in/{NAME}/row/**` (empty payload = row gone -> undeclare); `get` same key (router fs storage `asemic_rows` persists rows); per row sub `asemic/gen/<input>`; act on byte delta; declare liveliness `asemic/adapter/{NAME}/ready` post-sub + post-stored-follow; SIGTERM -> clean exit; emit `asemic/frame/<id>` (ASF1) + `asemic/out/{NAME}/<id>/...`
		- 2.2.5 `adapter.toml`: `name`, `kind = "process"`, `ready = true`, `build = "cargo build --release -p asemic-<n>"`, `start = "../../target/release/asemic-<n>"` (cwd = adapter dir), `[zenoh]` subs/pubs; !! env carrying ids/opts
		- 2.2.6 `README.md`: row contract + key layout
	- 2.3 Row verb: add to `namespace.py` `_build_ns` beside `view`/`proc`, update `self.ns`:
		- 2.3.1 `key = resolve_path(self.label, id)`
		- 2.3.2 `self.c.get(f"asemic/adapter/{n}/start", timeout=30)` (awaits ready token)
		- 2.3.3 `self.c.put(f"asemic/in/{n}/row/{key}", {"input": resolve_path(self.label, input), "opts": opts, "root": str(self.path.resolve().parent) if self.path else None})`
	- 2.4 Project file row example: `<n>("out", input="<gen>")` + `view("out", kind="frame")`
	- 2.5 Doc update: add row to bundled adapters table in [adapters.md](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/help/adapters.md); re-gen stubs (`scripts/gen_api.py`) | verb listed
	- 2.6 Build & test: `cargo build/test -p asemic-<n>`; delegate test runs to `id` subagent only; leave uncommitted | J live-dev
- 3 Invariants & gotchas
	- 3.1 !! Python backend; adapters = Rust
	- 3.2 !! hardcode project/block/gen names in manifests, code, env defaults
	- 3.3 !! derive scope/root from block name; root = open file `self.path.resolve()`, passed by row
	- 3.4 !! renderer as `@proc` / block; renderer = ROW taking `input=`
	- 3.5 !! backend logic in row; row only starts + sends
	- 3.6 Block-relative paths: resolve `id` & `input` via `resolve_path(self.label, ...)`
	- 3.7 COOK = start then send; `start` returns only post-ready token; !! sleep/poll/stale fallback
	- 3.8 Gens republish per frame: trigger on byte change only
	- 3.9 Zenoh callbacks on worker threads: queue work; serialize single-session calls
	- 3.10 Protocol revs: set `ClientInfo.protocol_version` | pinned (mismatch hangs `rmcp`)
	- 3.11 Stray process: `pgrep -fl asemic-<n>`; only ppid = brain should run
	- 3.12 Failure visibility: publish errors to `asemic/err/<n>/<id>` ("" clears), log via `RUST_LOG` -> `state/brain.log`
