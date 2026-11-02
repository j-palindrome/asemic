# gpgpu-swarm — 256 orbiting GPU compute points rendered through a smooth line brush
# directly to Syphon. Drawing -> Brushes -> Syphon.
# Explore: knobs (SPIN/RADIUS multi slider, 2 sliders routed into compute params 0/1).

with block("gpgpu", timestretch=1.0, loop="loop"):
    with block("controls"):
        # multi(): array of sliders -> asemic/value/<id>.<i>; `.<i>` routes each index individually.
        multi("knobs", 0, 1, default=0.3, n=2, label="SPIN / RADIUS")
        route("knobs.0", "asemic/tex/gpgpu/swarm.param.0", frm=(0, 1), to=(0.0, 0.08))
        route("knobs.1", "asemic/tex/gpgpu/swarm.param.1", frm=(0, 1), to=(0.1, 0.45))
    tex("swarm", "compute", count=256, pingpong=True, params=[0.02, 0.3], wesl="""
    fn point(i: u32) -> Point {
        let a = f32(i) / 256.0 * 6.2831 + info.time * param(0u) * 50.0;
        let goal = vec2f(0.5) + param(1u) * vec2f(cos(a), sin(a * 2.0));
        let p = mix(vec2f(prev(i).x, prev(i).y), goal, 0.2);
        return Point(p.x, p.y);
    }
    """)
    tex("trails", "draw", points="swarm", brush="line", pingpong=True, smooth=0.8, publish="syphon")
