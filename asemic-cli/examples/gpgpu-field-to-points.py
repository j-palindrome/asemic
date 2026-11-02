# gpgpu-field-to-points — compute->compute->draw chain: a vector-field texture node (`flow`)
# written by `fn compute(p)`, sampled inside a second compute node's `fn point(i)` (`in0(uv)`
# is available to point() the same way it is to compute(), per Inputs::preamble covering both)
# to advect points through the field, drawn with a line brush for streak trails.
# Explore: params on `flow` (noise scale/speed), params[0] on `advect` (step size).

with block("gpgpu"):
    # vector field encoded as colour: rg = flow direction (-1..1 remapped to 0..1)
    tex("flow", "compute", params=[3.0, 0.15], wesl="""
    fn compute(p: vec2u) -> vec4f {
        let uv = (vec2f(p) + 0.5) / info.size;
        let scale = param(0u);
        let t = info.time * param(1u);
        let a = sin(uv.x * scale + t) * cos(uv.y * scale - t) * 3.14159;
        let dir = vec2f(cos(a), sin(a));
        return vec4f(dir * 0.5 + 0.5, 0.0, 1.0);
    }
    """)
    # points advected by sampling `flow` (in0) each frame; pingpong so prev(i) carries position
    tex("advect", "compute", inputs=["flow"], count=300, pingpong=True, params=[0.004], wesl="""
    fn point(i: u32) -> Point {
        var p = prev(i);
        var pos = vec2f(p.x, p.y);
        if (pos.x == 0.0 && pos.y == 0.0 && info.time > 0.05) {
            // re-seed a point that drifted to the zeroed corner / first frame
            let a = f32(i) / 300.0;
            pos = vec2f(fract(a * 7.0), fract(a * 13.0));
        }
        let dir = in0(pos).rg * 2.0 - 1.0;
        pos = fract(pos + dir * param(0u));
        return Point(pos.x, pos.y);
    }
    """)
    tex("streaks", "draw", points="advect", brush="line", pingpong=True, smooth=0.9, publish="syphon")

# Gap?: `point(i)` sampling `in0` at a *per-point* uv (not the fullscreen `p: vec2u` grid
# compute() gets) worked above because Inputs are shared @group(0) across both pipelines
# (graph.rs Inputs::preamble, shared by cs_tex/cs_pts) — confirmed by reading the WESL
# codegen, not by a passing test. If `in0` sampling turns out to be nearest/point-filtered
# only (no bilinear), advection will look blocky at low `flow` resolution; raising `flow`'s
# w/h is the fix.
