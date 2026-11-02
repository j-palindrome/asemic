# Livecode language

asemic-cli code looks like Python because it is Python. `block()` contexts scope identifiers, and a set of livecode helpers forwards structured calls to the Rust brain. This page covers blocks, verbs, controls, generators, routing, textures, outputs, Python procs, variable fonts, and local helpers.

## Blocks

```python
with block("demo", timestretch=0.0, length=10.0, loop="loop"):
    param("gain", 0, 1, default=0.5)
    with block("inner"):
        noise("lfo", "lfo", freq=2)
```

`block()` is a no-op context manager so the file also runs as plain Python (`python examples/x.py`). Its arguments declare timing and scope. All ids inside the block are prefixed with the block path.

Block timing:

- `timestretch` — `0.0` frozen, `1.0` real-time, `>1` faster, `<0` reverse.
- `length` — playback length in seconds; omitted/`0` = infinite.
- `loop` — `"off"` (play once and hold), `"loop"` (repeat), `"pingpong"` (bounce).

## Verbs overview

Verbs are the livecode vocabulary. The full table is printed by `cargo run --bin asemic-brain -- --verbs`. See [verbs.md](verbs.md) for a grouped reference.

## Controls

| verb | what it does |
|------|--------------|
| `param(id, min, max, default=...)` | single slider → `asemic/value/<id>.value` |
| `multi(id, min, max, default=..., n=8)` | `n` sliders → `asemic/value/<id>.<i>` |
| `xy(id, x, y, default=...)` | XY pad → `asemic/value/<id>.{x,y}` |

Animation:

```python
param("x", 0, 1, anim="chaos", mode="add", depth=1.0)
xy("arena", anim="chaos", mode="drift", depth=0.1)
```

Modes are `add`, `replace`, and `drift` (integrate with wrap). `xy` defaults to `mode="drift"`. You can animate with any component that publishes scalar channels, typically a `noise` or another `proc`.

## Generators & procs

### `noise`

`noise` kinds:

- `chaos` — Lorenz-like attractor (multi-channel).
- `perlin` / `simplex` — gradient noise.
- `lfo` — low-frequency oscillator.
- `random-walk` — integrated noise.

### `randomizer`

`randomizer(id, gen, seed=0, **params)` produces raw iid jitter per frame:

- `white` — uniform.
- `gauss` — Gaussian (Box-Muller).

Because the output is unmodified, you almost always route it with a combine mode:

```python
randomizer("jit", "white")
route("jit:value", "my_proc.attr.wobble", combine="multiply", frm=(0, 1), to=(0.8, 1.2))
```

### `proc`

`proc` kinds:

- `physics` — Rapier2D balls in a unit box.
- `wave` — 1D stationary Schrödinger solver (Numerov).
- `spectrum` — FFT bands of an input stream.
- `glyph` — asemic-repl font paths, scanned/wobbled by params.
- `text` — text shaped in a TTF/OTF font (variable axes supported), flattened to outlines.
- `lsys` — L-system derivation + turtle, optionally rooted on an input gen's points.
- `melody` — seeded pentatonic walk with `pitch` and `dur` dims.
- `py` — Python function evaluated in the REPL frontend (see below).

Procs emit binary point multiarrays on `asemic/gen/<id>` and scalar channels on `asemic/value/<id>.<ch>`.

## Routing

```python
route("arena.x", "supercollider.set.freq", frm=(-1, 1), to=(40, 2000))
route("plant_lfo:value", "plant.attr.hue", frm=(-1, 1), to=(0, 0.6), combine="add")
```

- `src` can be a block-relative id, a full key, or shorthand `id:channel` (`chaos:vx` becomes `asemic/value/chaos.vx`).
- `dst` can be a component param (`<id>.<key>`), a proc attribute (`<id>.attr.<name>`), or an adapter output (`<adapter>.<path>` → `asemic/out/<adapter>/<path>`).
- `combine` can be `replace`, `add`, or `multiply`. Use `randomizer` as `src` with `combine="multiply"` for raw jitter.
- `curve` can be `linear`, `exp`, `log`, or `quad`.

## Textures & outputs

`output` opens a sink:

- `kind="syphon"` → Syphon server `asemic:<name>` at `w x h`, drawing the listed `src` gen ids with the asemic-repl line brush. Streams a downsampled preview on `asemic/preview/<name>` only while subscribed.
- `kind="jack"` → JACK client `asemic-<name>`; `w` is the channel count. The rendered `src` drawing is traced as X/Y audio (oscilloscope-style) and fed to the JACK sink.

`output` extras:

- `post="feedback"` applies the built-in feedback shader after the brush pass.
- `node=<tex id>` publishes a texture node instead of drawing `src` gens directly.

`tex` kinds and common arguments:

| kind | what it does | key arguments |
|------|--------------|---------------|
| `draw` | draw point multiarrays | `src=[gen ids]`, `brush` (`line`/`curve`/`dot`), modifier bodies (`width`, `alpha`, `brightness`, `position`) |
| `shader` | WESL fragment shader | `wesl` source string, `inputs=[...]` |
| `compute` | WESL compute + optional point gen | `wesl`, `attrs={name: default}`, `count`, `instances` |
| `feedback` | single-input trails | `inputs=[...]`, `pingpong`, `smooth` |
| `ascii` | luma → glyph grid | `inputs=[...]`, `ramp`, `font`/`atlas`, `axes={tag: v}`, `params=[cols, colour]` |
| `in` | external source | `adapter="syphon:<server>"`, `adapter="camera:<index>"` |

Shared arguments:

- `w`, `h` — resolution (default 1280x720).
- `inputs` — upstream texture node ids sampled as `tex0(uv)`..`tex3(uv)`.
- `publish` — sink names, e.g. `publish="syphon"` or a list.
- `pingpong` — keep the previous frame as a self-input.
- `smooth` — blend factor when pingponging.
- `params` — up to 16 float uniforms addressed as `asemic/tex/<id>.param.<i>`.

Examples:

```python
# compute: particles with a custom "hue" dimension
tex("swarm", "compute", wesl="...", attrs={"hue": 0.5}, count=4096,
    brush="line", publish="syphon")

# ascii: render luma as characters from the asemic font
tex("txt", "ascii", inputs=["image"], font="asemic", ramp=" ABCD",
    params=[80, 1], publish="syphon")
```

Uniform parameters are addressed as `asemic/tex/<id>.param.<i>` (or axis tag for ascii fonts) and can be routed like any other value.

## Other lifecycle verbs

| verb | usage |
|------|-------|
| `set(comp, key_or_value, value=None)` | Write a parameter directly, e.g. `set("gain", 0.5)` or `set("arena", "x", 0.5)`. |
| `cue(id, values, fade=0)` | Store a snapshot of values. `go(id)` writes them all at once. |
| `go(id)` | Fire a cue, writing all its values at once. |
| `delete(id)` | Delete a component by id. |
| `drop(label)` | Remove everything owned by a block label. |

## Python procs

```python
with block("custom"):
    @proc("custom", "py", n=64)
    def f(params, inp=None):
        seed = params["seed"]
        n = params["n"]
        # inp, if present, is a Points object from the proc's input gen.
        return {
            "dims": ("hue",),
            "lines": [[[x, y, hue] for x, y, hue in ...]]
        }
```

Mark a proc with kind `py` and decorate its function. The brain queries `asemic/py/<id>` with params, seed, and optional input points whenever they change or on COOK. The reply is cached and published every frame, so there is no per-frame Python round-trip. Return a `Points` object or a dict with `dims` (after the implicit `x,y`) and `lines`.

## Variable fonts

`vfont` builds a variable TTF from two or more glyph procs (each a `proc(..., "glyph", ...)`). It writes UFOs + a designspace, compiles with `fontc`, and announces the result on `asemic/state/vfont/<name>`. With `live=True`, the font rebuilds when any master component or param changes (debounced). Use `proc(..., "text", path=...)` to hot-reload the generated font; its `ASMC` axis is routable.

## Local helpers

These functions live in `asemic_py/namespace.py` and are evaluated directly in the REPL, not sent to the brain:

| helper | usage |
|--------|-------|
| `block(name, timestretch=..., length=..., loop=...)` | scope/timing context manager |
| `embed(id, preview=None)` | link row to another node's preview |
| `orca(grid)` | marker for an Orca-c grid row |
| `proc(id, "py", ...)` | decorator for Python procs |
| `affinity(id, input, preview=..., **opts)` | draw gen points into the current Affinity document |
| `sc(id, code, **params)` | SuperCollider `Ndef` tied to the enclosing block's play/pause |

## Relevant source files

- `asemic_py/namespace.py` — REPL namespace and local helpers.
- `crates/brain/src/verbs.rs` — verb table and request handler.
- `crates/brain/src/engine.rs` — component/noise engine.
- `crates/schema/src/lib.rs` — component/route schema.
