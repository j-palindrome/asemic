# REPL / TUI

The asemic user interface is a terminal application built with [Textual](https://textual.textualize.io/). It provides a block-column editor, inline controls, live previews, and an embedded Neovim row editor.

## Starting

```bash
asemic                # open the default startup file
asemic <name>         # open examples/<name>.py
asemic --restart      # kill and restart asemic-brain + zenohd
asemic --config path/to/peer.json5
```

The first start builds the `asemic_py._ids` extension via maturin if needed, brings up a Zenoh router, and waits for `asemic/brain/ready`.

## Editor basics

The file is a tree of blocks. Each block has rows. Rows can be plain Python code or nested `with block(...)` contexts. The editor shows one level at a time (peek/zoom) so a large file stays navigable.

- **Enter** on a row: commit and evaluate that row's block only.
- **:run** or **Ctrl+R**: evaluate the whole file.
- **:w**, **:q**, **:wq**: save / quit / save-and-quit.
- **Ctrl+L**: toggle the global eval log.
- **Ctrl+Q**: quit.
- **:help**: show key bindings and slash commands.
- **:guide**: show the in-app guide + example index.
- **:functions** or **/**: fuzzy-browse every livecode verb.

## Key bindings

The TUI uses Vim-style tree navigation by default. Arrows move between rows, right enters a block, left exits. Press **Esc** to toggle WASD navigation. When a control panel is focused, **Tab / Shift+Tab** cycles its controls and **Esc / h / ←** blurs back to the row.

| key | action |
|-----|--------|
| `↑↓` or `kj` | move between rows |
| `→` or `l` | enter/zoom into a block |
| `←` or `h` | exit a block / blur controls |
| `Shift+→` / `Tab` | focus the current row's controls |
| `Shift+←` / `Shift+Tab` | back to the row line |
| `Space` | play/pause the current block |
| `Enter` | commit + eval current block |
| `Ctrl+R` | `:run` all blocks |
| `Ctrl+L` | toggle eval log |
| `Ctrl+Q` | quit |
| `:` | command line (`:run`, `:w`, `:q`, etc.) |
| `/` | fuzzy function browser |

## Slash commands

Commands are handled by `asemic_py/columns.py`. Available commands include:

| command | action |
|---------|--------|
| `:run` | evaluate all blocks |
| `:w` | save the file |
| `:q` | quit |
| `:wq` | save and quit |
| `:help` | key / command reference |
| `:guide` | pipeline guide + example index |
| `:functions` | fuzzy verb browser |
| `:adapters` | open the adapters panel |
| `:build <name>` | build an adapter |
| `:stop <name>` | stop an adapter |
| `:status <name>` | adapter status |

## Inline panels & previews

When a row creates a component, texture node, or block, the TUI mounts a panel directly under that row. Panels are live:

- **param / xy / multi** panels show sliders/XY pads/multisliders and route links.
- **noise / proc** panels show the live output channels and a preview of the point stream.
- **block** panels show timestretch, length, loop, a scrubbable time readout, and a COOK button.
- **tex** panels show the node graph, sinks, and an inline frame preview.

Use `embed(id, preview="dots"|"image"|"ascii")` in code to create a link + preview for another node.

## Relevant source files

- `asemic_py/app.py` — TUI app and panel widgets.
- `asemic_py/columns.py` — block-column editor and slash commands.
- `asemic_py/namespace.py` — REPL namespace and local helpers.
- `asemic_py/state.py` — mirrored brain state used by the UI.
