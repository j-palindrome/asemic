# physics-noise-coupled — physics forces modulated by a noisegen through `anim` (§8.1.3),
# then routed into the physics proc's own params (route dst = asemic/state/param/<id>.<key>,
# the general escape hatch past the adapter-output dst_key() mapping — proc.rs's
# Engine::put_param updates a live Gen's params for any key, not only `.attr.*`).
#
# Explore:
#   - noise("turb", "chaos", ...) Lorenz attractor drives two params via `anim`:
#       - param("kick") anim="turb" mode="add": kick's base ± turb.value*depth, so the
#         impulse strength itself breathes with the chaos signal instead of being constant.
#       - xy("push") anim="turb" mode="drift": a 2D point that *drifts* (walks) under the
#         chaos velocity channels (vx/vy) -- its x axis is routed into gravity.x so the
#         balls get buffeted sideways in a drifting, never-repeating pattern.
#   - Swap noise("turb", "chaos", ...) for "perlin"/"simplex"/"lfo"/"random-walk" (§8.1.2.1)
#     to compare smooth vs. jittery coupling -- chaos (Lorenz) is the spikiest, lfo the
#     smoothest.
#   - param("depth") scales the coupling for both anim-ed components without touching the
#     noise source itself: anim depth kwarg is set live by re-running the block with a new
#     literal, or drag it if you wire a param -> anim depth route (not shown; depth isn't a
#     brain-live-tunable field today -- see gap below).
#   - param("kick_rate"): base kick level before chaos modulation (anim mode="add" adds
#     on top of this base).
# `anim.depth` is live-routable too (engine.rs reads `asemic/state/param/<id>.depth` at runtime),
# so you can route a control into it to tune how strongly the turbulence drives the kick.

with block("clock"):
    tempo(100)

with block("noise"):
    proc("turb", "chaos", speed=1.0, rho=28.0, sigma=10.0, beta=2.667)

with block("controls"):
    param("kick_rate", 0, 4, default=0.5, label="KICK BASE")
    param("kick", 0, 4, default=0.5, anim="turb", mode="add", depth=1.5, label="KICK (chaos)")
    xy("push", anim="turb", mode="drift", depth=0.3, label="PUSH (chaos drift)")

with block("balls"):
    proc("balls", "physics", n=20, gravity=0.6, restitution=0.85, radius=0.025, kick=0.5)
    route("../controls/kick", "asemic/state/param/balls/balls.kick", frm=(0, 4), to=(0, 4))
    route("../controls/push.x", "asemic/state/param/balls/balls.gravity", frm=(-1, 1), to=(-1.5, 1.5))

with block("draw"):
    tex("balls_ink", "draw", src=["../balls/balls"], brush="dot", publish="syphon")
    tex("balls_txt", "ascii", inputs=["balls_ink"], ramp=" .:-=+*#%@", params=[80, 0], publish="syphon")
