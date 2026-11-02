## asemic guide

Enter on a block's row to eval it, Ctrl+R for everything. Startup evaluates blocks with
timestretch 0; use ▶ to start a block.

Rows that need block-level cleanup (e.g. `sc()`, `affinity()`) register `on_play`/`on_stop`
hooks: they start when the enclosing block unfreezes and stop/cleanup when it freezes.

Ids are scoped by block path (`crates/schema/src/ids.rs`): `../x` = sibling block, `/x/y` =
absolute.

Pipeline: Drawing -> Brushes -> Syphon (drawing point arrays through line/curve/dot/mesh
brushes directly out to Syphon zero-copy surfaces, rather than ASCII or static previews).

`examples/startup.py` loads by default (`asemic` / `j asemic`) and is a minimal nested-block
demo. Every other topic below lives as its own standalone file under `examples/` — open one
with `:open <name>` (or `:o`) to load and explore it.
