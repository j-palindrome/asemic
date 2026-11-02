# gpgpu-physics-hybrid — CPU rapier2d balls (`proc(..., "physics")`) feed a GPU compute node
# as `src` (read back via `src_point(i)`/`src_count()`/`attr(i, k)`, graph.rs Compute docs),
# which spawns secondary GPU "spark" particles per ball, drawn with a dot brush.
# Explore: n/gravity/restitution/radius/kick on the physics proc; count (sparks per frame
# budget, not per-ball); params[0] = spark jitter/spread.

with block("balls"):
    proc("balls", "physics", n=10, gravity=1.0, restitution=0.85, radius=0.03, kick=3.0)
    tex("balls_ink", "draw", src=["balls"], brush="dot", publish="syphon")

with block("gpgpu"):
    # sparks: each GPU point reads one physics ball (round-robin via i % src_count()) and
    # jitters around it; src="balls" gen -> attr(i, k) / src_point(i) inside point().
    tex("sparks", "compute", src=["../balls/balls"], count=400, pingpong=True, params=[0.02], wesl="""
    fn point(i: u32) -> Point {
        let n = src_count();
        if (n == 0u) { return Point(0.0, 0.0); }
        let ball = src_point(i % n);
        let a = f32(i) * 2.399963 + info.time * 4.0;
        let spread = param(0u) * (0.5 + 0.5 * sin(f32(i) * 1.7));
        let jitter = vec2f(cos(a), sin(a)) * spread;
        return Point(ball.x + jitter.x, ball.y + jitter.y);
    }
    """)
    tex("sparks_ink", "draw", points="sparks", brush="dot", pingpong=True, smooth=0.6, publish="syphon")

# Note (verified in proc.rs Physics::points/circle): `balls`' point array is NOT one point
# per ball — Physics::points() draws each ball as a 13-point circle outline (x, y only, no
# vx/vy; velocity only exists as the scalar noisegen channels "vx"/"vy" for ball 0, which
# route() can target but src_point()/attr() cannot see). So `src_count()` here = n * 13,
# and `src_point(i % n)` above actually walks circle-outline vertices round-robin rather
# than ball centers — still real, moving positions per ball, just denser/jitterier than one
# anchor per ball. Gap: no compute-visible per-point velocity attr from physics; getting
# spark velocity from ball velocity would need proc.rs to attr-tag the Multi with vx/vy
# (it currently doesn't), or driving a param via route("balls/balls:vx", "asemic/tex/gpgpu/sparks.param.1").
