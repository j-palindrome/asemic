# Verb reference

This page lists every REPL verb understood by the brain. The authoritative source is `crates/brain/src/verbs.rs`; run `cargo run --bin asemic-brain -- --verbs` to get the exact table your build exports.

Jump to a section:

- [Controls](#controls)
- [Generators](#generators)
- [Routing](#routing)
- [Time & UI](#time-ui)
- [Texture nodes](#texture-nodes)
- [Outputs](#outputs)
- [Adapters](#adapters)
- [Procs, fonts & lifecycle](#procs-fonts-lifecycle)
- [Argument conventions](#notable-argument-conventions)

## Controls

| verb | args | what it does |
|------|------|--------------|
| `param` | `id, min, max, default` | Slider → `asemic/value/<id>.value`. Keywords: `step`, `curve`, `label`, `anim`, `mode`, `depth`, `channel`. |
| `multi` | `id, min, max, default, n` | Multislider (param array) → `asemic/value/<id>.<i>`, `i = 0..n` (default 8, max 64). Keywords: `step`, `curve`, `label`. |
| `xy` | `id, x, y, default` | XY pad → `asemic/value/<id>.{x,y}`. Keywords: `label`, `anim`, `mode` (default `drift`), `depth`, `channel`. |
| `set` | `comp, key_or_value, value` | `set('gain', .5)` / `set('arena', 'x', .2)` / `set('arena.x', .2)`. Paths relative to the block: `m.n`, `../m.n`, `/t/m.n`. |
| `cue` | `id, values, fade` | Snapshot of values; `go(id)` applies them at once. `fade` is stored but not yet interpolated. |
| `go` | `id` | Fire a cue. |

## Generators

| verb | args | what it does |
|------|------|--------------|
| `noise` | `id, gen, seed` | Noise generator → `asemic/value/<id>.<channel>`. Generators: `chaos`, `perlin`, `simplex`, `lfo`, `random-walk`. Other keywords become generator params. |
| `randomizer` | `id, gen, seed` | Raw iid jitter → `asemic/value/<id>.<channel>`. Generators: `white`, `gauss`. Use with `route(..., combine='add'|'multiply')`. |
| `proc` | `id, proc, input, seed, text, axiom, rules, scale_by, path, attrs` | Point processor → `asemic/value/<id>.<channel>` + `asemic/gen/<id>`. Processors: `physics`, `wave`, `spectrum`, `glyph`, `lsys`, `text`, `melody`, `py`. `input` can be a gen id, an IO stream, or `chaos:x` / `gain` shorthand. |

## Routing

| verb | args | what it does |
|------|------|--------------|
| `route` | `src, dst, id` | Map one value to another. Keywords: `frm`, `to`, `curve`, `combine` (`replace`/`add`/`multiply`). `src='chaos:vx'` names a noise channel. |

## Time & UI

| verb | args | what it does |
|------|------|--------------|
| `tempo` | `bpm, ppq, beats_per_bar` | Set the global transport clock. |
| `ui` |  | UI/perf settings → `asemic/state/ui`. Keywords: `image` (`auto`/`quad`/`halfcell`/`tgp`/`sixel`/`unicode`), `hz`, `clock`. No args returns current settings. |

## Texture nodes

| verb | args | what it does |
|------|------|--------------|
| `tex` | `id, kind, inputs, attrs, src, adapter, wesl, w, h, brush, width, alpha, brightness, position, points, count, instances, pingpong, smooth, params, text, publish, server, ramp, font, atlas, axes` | Texture / shader / compute / ascii / draw / feedback node. See [livecode.md](livecode.md#textures-outputs) for a full explanation. |
| `texparam` | `id, i, v` | Set texture-node uniform param by index or ascii atlas axis tag. |
| `untex` | `id` | Close a texture node. |
| `texs` |  | List texture nodes (+ live point dims of draw/compute nodes). |

## Outputs

| verb | args | what it does |
|------|------|--------------|
| `output` | `name, kind, w, h, src, post, brush, width, alpha, brightness, position, hz, node` | Open an output. `kind` can be `syphon` (Syphon server + preview stream) or `jack` (traces the rendered drawing as X/Y audio; `w` = channel count). Block-owned. |
| `close` | `name` | Close an output. |
| `outputs` |  | List open outputs + client counts. |

## Adapters

| verb | args | what it does |
|------|------|--------------|
| `stop` | `name` | Stop an adapter. |
| `build` | `name` | Build an adapter. |
| `status` | `name` | Adapter status. |
| `adapters` |  | Adapter manifests. |

## Procs, fonts & lifecycle

| verb | args | what it does |
|------|------|--------------|
| `procs` |  | List procs: declared attrs + live dims. |
| `vfont` | `name, masters, chars, dir, live, hz` | Build a live variable font from glyph procs. |
| `delete` | `id` | Delete a component. |
| `drop` | `label` | Remove everything a block label created. |

## Notable argument conventions

- `frm` and `to` are `(lo, hi)` tuples that rescale the source value to the destination range.
- `combine` controls how the mapped value mixes with the destination's current value.
- `src` accepts shorthand like `id` (value channel), `id:<channel>` (e.g. `chaos:vx`), or `id.<key>` and resolves relative to the calling block.
- `dst` can be a component param (`id.key`), a proc attribute (`id.attr.name`), or an adapter output (`adapter.path`).
