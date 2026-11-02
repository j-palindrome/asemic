---
name: debug
ι: 4.3
description: Inspect running asemic terminal session, headless nvim row editors, brain diagnostics, and Textual widgets/events.
---

# /debug [row]

- 1 Spec & source refs
	- 1.1 Repo agent map: [AGENTS.md](file:///Users/jpalindrome/jVault/Projects/Asemic/AGENTS.md) §7 (diagnose & debug routines)
	- 1.2 Common failures: [troubleshooting.md](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/help/troubleshooting.md)
	- 1.3 Harness script: [debug.sh](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/scripts/debug.sh) (tmux + textual console log)
	- 1.4 Embedded nvim architecture: [nvim_server.py](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/asemic_py/nvim_server.py) + [nvim_view.py](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/asemic_py/nvim_view.py)
	- 1.5 Daemon log: [brain.log](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/state/brain.log)
	- 1.6 Wire/stub types: [_types.py](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/asemic_py/_types.py) + [_api.pyi](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/asemic_py/_api.pyi)
- 2 Embedded nvim inspection
	- 2.1 Headless nvim = 1 detached server/script file; socket = `/tmp/asemic-nvim-<sha1(abspath)[:10]>.sock`
	- 2.2 Sockets survive REPL exit; find via `ls /tmp/asemic-nvim-*.sock`
	- 2.3 Inspect via `pynvim` (attach existing socket, !! spawn new server):
		- 2.3.1 `n = pynvim.attach('socket', path=sock)`
		- 2.3.2 Buffer lines: `n.current.buffer[:]`
		- 2.3.3 State vars: `n.vars.get('asemic_chans')`
	- 2.4 Target row inspection:
		- 2.4.1 Row 0 = hidden `ROW_PRELUDE` import stub (`asemic_py._api import *`)
		- 2.4.2 Row index N in UI corresponds to buffer line N
		- 2.4.3 Read row via `n.current.buffer[row_idx]` or remote expr `getline(row_idx + 1)`
	- 2.5 Remote commands via cli: `nvim --server <sock> --remote-expr 'getline(1,"$")'` / `nvim --server <sock> --remote-send '<Esc>'`
- 3 Textual UI & live session
	- 3.1 Debug harness: run `cd asemic-cli && ./scripts/debug.sh -d`
	- 3.2 Spawns tmux session `asemic-debug` (windows: `app` + `console`)
	- 3.3 Devtools log stream: `asemic-cli/.debug/textual-console.log`
	- 3.4 Capture live panes: `tmux capture-pane -pt asemic-debug:app` / `tmux capture-pane -pt asemic-debug:console`
	- 3.5 Send input keys: `tmux send-keys -t asemic-debug:app '<keys>' C-m`
	- 3.6 Teardown: `tmux kill-session -t asemic-debug`
	- 3.7 Documentation search: search local textual package (`python3 -c "import textual; help(textual.<widget>)"`) / query docs via Firecrawl search on `textual.textualize.io`
- 4 Brain log diagnostics
	- 4.1 State log path: `asemic-cli/state/brain.log`
	- 4.2 Inspect failures: `tail -n 100 asemic-cli/state/brain.log | grep -E "ERROR|WARN|cook|adapter"`
	- 4.3 Dump verb & schema state: `cargo run --bin asemic-brain -- --verbs` / `cargo run --bin asemic-brain -- --schema`
	- 4.4 Standalone debug run: `RUST_LOG=debug cargo run --bin asemic-brain -- --config config/peer.json5`
- 5 Intended types & codegen
	- 5.1 Signature stub: [_api.pyi](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/asemic_py/_api.pyi) (injected via `ROW_PRELUDE`)
	- 5.2 Wire types: [_types.py](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/asemic_py/_types.py)
	- 5.3 Schema bundle: [_schema.json](file:///Users/jpalindrome/jVault/Projects/Asemic/asemic-cli/asemic_py/_schema.json)
	- 5.4 UI ↔ brain mismatch -> regenerate via:
		- 5.4.1 `UPDATE_WIRE=1 cargo test -p asemic-schema`
		- 5.4.2 `bash scripts/gen_types.sh`
		- 5.4.3 `python scripts/gen_api.py`
