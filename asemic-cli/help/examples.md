# Examples

Examples live in `examples/` and demonstrate common patterns. They can be opened from the command line or browsed with `:guide` inside the REPL.

## Running examples

```bash
# Open an example in the editor
asemic plant

# Open and immediately evaluate all blocks
asemic gpgpu-particles --run
```

Run `:guide` in the REPL to see the full index with a one-line description pulled from each file's header comment.

## Example index

| name | one-line description |
|------|----------------------|
| `clock` | bare tempo-only block (`timestretch=1.0` real-time, `loop="loop"`). |
| `comp` | glyph generator stroked by a dot brush. |
| `gpgpu-field-to-points` | compute→compute→draw vector-field chain. |
| `gpgpu-life` | Conway's Game of Life as a WESL compute field. |
| `gpgpu-particles` | N orbiting/attracted particles with velocity in extra dims. |
| `gpgpu-physics-hybrid` | CPU physics balls feed a GPU compute node. |
| `gpgpu-reaction-diffusion` | Gray-Scott reaction-diffusion field. |
| `gpgpu-swarm` | 256 orbiting GPU compute points with smooth line brush. |
| `hue-inferno` | Philips Hue inferno/vortex lighting. |
| `physics-balls` | rapier2d balls driven by an xy gravity vector. |
| `physics-noise-coupled` | physics forces modulated by a noisegen through `anim`. |
| `plant` | hierarchical L-system branching, relative routing, Syphon output. |
| `quantum-wave` | stationary 1D Schrödinger via Numerov shooting. |
| `random` | raw iid jitter plugged onto a param with `combine`. |
| `scope` | x/y oscilloscope over JACK. |
| `spectrum-to-physics` | rustfft spectrum bands kicking physics bodies. |
| `startup` | default demo; nested block scoping and basic controls. |
| `supercollider` | xy pad driving a compiled SynthDef voice over OSC. |
| `td` | Syphon input from an external app (TouchDesigner). |
| `type` | hierarchical control and live variable font from glyph masters. |
| `video-chain` | Syphon-in → edge-filter shader → Syphon-out. |

## Highlighted examples

### `examples/startup.py`

Default file loaded by `asemic`. Demonstrates nested block scoping and basic controls:

```python
with block("demo", timestretch=0.0, loop="loop"):
    param("demo_gain", 0, 1, default=0.5)
    with block("inner"):
        param("inner_amt", 0, 1, default=0.122)
```

### `examples/plant.py`

Hierarchical parameter control, relative routing, L-systems, and Syphon output:

```python
with block("plant", loop="loop"):
    proc("plant", "lsys", axiom="F", rules="0.6: F -> F[+F]F; 0.4: F -> F[-F]",
         n=4, angle=25, step=0.02, attrs={"hue": 0.3})
    param("angle", 10, 60, default=25)
    param("growth", 0, 1, default=1.0)
    noise("plant_lfo", "lfo")
    route("plant_lfo:value", "plant.attr.hue", frm=(-1, 1), to=(0, 0.6))
    tex("plant_ink", "draw", src=["plant"], brush="line", publish="syphon",
        brightness="return 0.4 + attr(info, DIM_hue);")
    tex("plant_txt", "ascii", inputs=["plant_ink"], ramp=" .:-=+*#%@",
        params=[100, 0], publish="syphon")
```

### `examples/supercollider.py`

Cross-block routing to OSC adapter outputs to drive a live SynthDef voice:

```python
route("../controls/voice.x", "supercollider.set.freq", frm=(-1, 1), to=(40, 2000))
```

### `examples/gpgpu-*.py`

Compute-shader textures and GPU-driven particle systems. Good starting points for custom `tex(..., kind="compute")` nodes.

### `examples/hue-inferno.py`

Philips Hue lamp control using the `hue` adapter.

## Writing your own

Every example is a plain Python file. Start with `with block("name", timestretch=0.0):`, add controls, procs, routes, textures, and outputs. Place the file in `examples/` and run `asemic <stem>`.
