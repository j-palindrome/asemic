# gpgpu-particles — N orbiting/attracted particles with velocity carried in extra point
# dims via GPU pingpong (`prev(i)`), drawn with a line brush for motion trails.
# Explore: count (particle count, rebuilds buffers), params[0] = attract strength,
# params[1] = drag, xy("target") drives the attractor; smooth= on the draw node controls
# trail persistence (0 = no trail, closer to 1 = long trail).

with block("noise"):
    proc("drift", "chaos", speed=0.6)

with block("controls"):
    xy("target", anim="drift")
    param("attract", 0, 4, default=1.2)
    param("drag", 0, 1, default=0.08)

with block("gpgpu"):
    # count particles; each Point carries position (x, y) + velocity (vx, vy) as extra
    # attrs, read back next frame through `prev(i)` (requires pingpong=True).
    tex("particles", "compute", count=400, pingpong=True, params=[1.2, 0.08, 0.5, 0.5],
        attrs={"vx": 0.0, "vy": 0.0},
        wesl="""
    fn point(i: u32) -> Point {
        let p = prev(i);
        var pos = vec2f(p.x, p.y);
        var vel = vec2f(attr(i, DIM_vx), attr(i, DIM_vy));
        // seed scattered on first frame (prev() reads zeroed buffer)
        if (pos.x == 0.0 && pos.y == 0.0 && vel.x == 0.0 && vel.y == 0.0) {
            let a = f32(i) * 2.399963;
            pos = vec2f(0.5) + 0.3 * vec2f(cos(a), sin(a));
        }
        let tgt = vec2f(param(2u), param(3u)); // xy("target") routed in below; we read its x/y via param(2u)/param(3u)
        let pull = normalize(tgt - pos + vec2f(1e-6)) * param(0u);
        vel = (vel + pull * 0.01) * (1.0 - param(1u));
        pos += vel * 0.01;
        return Point(pos.x, pos.y, vel.x, vel.y);
    }
    """)
    tex("trails", "draw", points="particles", brush="line", pingpong=True, smooth=0.85, publish="syphon")

with block("wire"):
    # route the xy pad into the attractor via texparam (full zenoh path, compute params[2]/[3])
    route("../controls/target:x", "asemic/tex/gpgpu/particles.param.2", frm=(-1, 1), to=(0, 1))
    route("../controls/target:y", "asemic/tex/gpgpu/particles.param.3", frm=(-1, 1), to=(0, 1))
