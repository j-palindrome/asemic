# gpgpu-life — Conway's Game of Life as a WESL compute field (self-input via `in0`, needs
# pingpong=True to read last frame), viewed through the ascii node.
# Explore: w/h (grid resolution == pixel resolution here, 1 cell/texel), ascii params
# [columns, colour] to change character density.

with block("gpgpu"):
    tex("life", "compute", inputs=["life"], pingpong=True, smooth=0.0, w=96, h=96,
        wesl="""
    fn alive(uv: vec2f) -> f32 { return select(0.0, 1.0, in0(uv).r > 0.5); }
    fn compute(p: vec2u) -> vec4f {
        let d = 1.0 / info.size;
        let uv = (vec2f(p) + 0.5) * d;
        var n = 0.0;
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                if (x == 0 && y == 0) { continue; }
                n += alive(uv + vec2f(f32(x), f32(y)) * d);
            }
        }
        let a = alive(uv);
        // classic rule: alive stays w/ 2-3 neighbours, dead births w/ exactly 3
        let next = select(select(0.0, 1.0, n == 3.0), select(0.0, 1.0, n == 2.0 || n == 3.0), a > 0.5);
        // seed on this node's first frame, regardless of brain uptime (hash21 = SEED helper)
        return vec4f(select(next, select(0.0, 1.0, hash21(uv) > 0.72), info.frame == 0u), 0.0, 0.0, 1.0);
    }
    """)

with block("view"):
    tex("life_txt", "ascii", inputs=["../gpgpu/life"], ramp=" .", params=[96, 0], publish="syphon")
