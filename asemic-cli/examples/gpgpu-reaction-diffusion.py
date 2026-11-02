# gpgpu-reaction-diffusion — Gray-Scott field: `fn compute(p)` reads last frame through the
# builtin pingpong mix (not `prev(i)`, that's points-only) via `in0(uv)` self-feedback.
# Explore: params[0]=feed, params[1]=kill, params[2]=diffusion rate; post wesl runs lygia's
# edgePrewitt over the activator channel via the raw tex0/samp bindings (no blur .wesl port
# exists yet, per feedback-shaders-lygia memory).

with block("gpgpu"):
    # self-input (reads itself via in0) needs pingpong=True; compute's builtin mix pass
    # blends `raw` (this frame's Gray-Scott step) against last frame at smooth=0 (no blend,
    # i.e. feed the raw simulation forward untouched) so pingpong here = "keep a readable
    # history buffer", the dynamics themselves come from the explicit in0(uv) feedback below.
    tex("field", "compute", inputs=["field"], pingpong=True, smooth=0.0,
        params=[0.037, 0.06, 1.0], w=512, h=512,
        wesl="""
    fn laplace(uv: vec2f, d: vec2f, ch: u32) -> f32 {
        let c = in0(uv)[ch];
        var sum = -c * 4.0;
        sum += in0(uv + vec2f(d.x, 0.0))[ch];
        sum += in0(uv - vec2f(d.x, 0.0))[ch];
        sum += in0(uv + vec2f(0.0, d.y))[ch];
        sum += in0(uv - vec2f(0.0, d.y))[ch];
        return sum;
    }
    fn compute(p: vec2u) -> vec4f {
        let d = 1.0 / info.size;
        let uv = (vec2f(p) + 0.5) * d;
        let st = in0(uv);
        // seed on this node's first frame from fbm noise (a uniform field stays uniform under
        // Gray-Scott -> blank); helpers live in crates/draw/src/graph.rs (SEED)
        let first = info.frame == 0u;
        let a = select(st.r, 1.0, first); // activator: unity
        let b = select(st.g, select(0.0, 1.0, fbm(uv * 8.0, 4u) > 0.55), first); // inhibitor: noise specks
        let feed = param(0u);
        let kill = param(1u);
        let rate = param(2u);
        let lap_a = laplace(uv, d, 0u);
        let lap_b = laplace(uv, d, 1u);
        let reaction = a * b * b;
        let na = clamp(a + (rate * lap_a - reaction + feed * (1.0 - a)) * 0.2, 0.0, 1.0);
        let nb = clamp(b + (rate * 0.5 * lap_b + reaction - (kill + feed) * b) * 0.2, 0.0, 1.0);
        return vec4f(na, nb, 0.0, 1.0);
    }
    """)

with block("post"):
    # lygia edgePrewitt over the field's raw tex0/samp binding (graph.rs `Inputs::preamble`
    # exposes tex0..tex7 + samp alongside the in0(uv) helpers for exactly this signature).
    tex("edges", "shader", inputs=["../gpgpu/field"], publish="syphon", wesl="""
    import lygia::filter::edge::prewitt::edgePrewitt;
    fn shade(uv: vec2f) -> vec4f {
        return vec4f(edgePrewitt(tex0, samp, uv, 2.0 / info.size), 1.0);
    }
    """)
    tex("field_view", "shader", inputs=["../gpgpu/field"], publish="syphon", wesl="""
    fn shade(uv: vec2f) -> vec4f { return vec4f(vec3f(1.0 - in0(uv).r), 1.0); }
    """)
