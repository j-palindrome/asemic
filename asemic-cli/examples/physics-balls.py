# physics-balls — rapier2d balls (proc.rs Physics, §11.6) driven by an xy gravity vector
# and param components for ball count/bounciness/damping/settle.
#
# Explore:
#   - xy("gravity") pad -> physics.gravity: drag it to tilt/invert gravity live (anim="drift"
#     keeps it wandering on its own even if you never touch the pad); its DEPTH slider
#     routes into the component's own `depth` param (live-changeable anim depth, §8.1.3.2) --
#     at 0 the pad sits still even though "drift" is selected.
#   - param("count") -> physics.n: ball count (clamped 1..256 in proc.rs); raising it live
#     rebuilds the box (Physics::build fires whenever n/radius/restitution change).
#   - param("bounce") -> physics.restitution: 0 = balls go dead on contact, 1 = near-perfect
#     bounce.
#   - param("kick") -> physics.kick: periodic random impulse per ball, so the pile never
#     fully settles (proc.rs applies it scaled by dt and ball mass).
#   - param("damping")/("spin_damping") -> physics.damping/angular_damping: per-frame linear
#     /angular velocity decay (rapier2d set_linear_damping/set_angular_damping); turn damping
#     up to settle the pile without killing bounce (restitution stays independent of it).
#   - route "gravity.y" into physics.gravity only takes the y axis of the xy pad, scaled by
#     frm/to, so slamming the pad up/down flips gravity hard without touching x.
#   - asemic/gen/balls points now carry vx/vy per ball (screen convention, y down) alongside
#     x/y, so a `draw` brush/modifier can read velocity (e.g. stretch or recolor by speed).

with block("clock"):
    tempo(96)

with block("controls"):
    xy("gravity", anim="drift", depth=0.15, label="GRAVITY")
    param("gravity_depth", 0, 1, default=0.15, label="GRAVITY DEPTH")
    param("count", 1, 64, default=16, step=1, label="COUNT")
    param("bounce", 0, 1, default=0.9, label="BOUNCE")
    param("kick", 0, 4, default=0.0, label="KICK")
    param("damping", 0, 10, default=0.0, label="DAMPING")
    param("spin_damping", 0, 10, default=0.0, label="SPIN DAMPING")

with block("balls"):
    proc("balls", "physics", n=16, gravity=1.0, restitution=0.9, radius=0.03, kick=0.0, damping=0.0, angular_damping=0.0)
    route("../controls/gravity.y", "asemic/state/param/balls/balls.gravity", frm=(-1, 1), to=(-2, 2))
    route("../controls/gravity_depth", "asemic/state/param/controls/gravity.depth", frm=(0, 1), to=(0, 1))
    route("../controls/count", "asemic/state/param/balls/balls.n", frm=(1, 64), to=(1, 64))
    route("../controls/bounce", "asemic/state/param/balls/balls.restitution", frm=(0, 1), to=(0, 1))
    route("../controls/kick", "asemic/state/param/balls/balls.kick", frm=(0, 4), to=(0, 4))
    route("../controls/damping", "asemic/state/param/balls/balls.damping", frm=(0, 10), to=(0, 10))
    route("../controls/spin_damping", "asemic/state/param/balls/balls.angular_damping", frm=(0, 10), to=(0, 10))

with block("draw"):
    tex("balls_ink", "draw", src=["../balls/balls"], brush="dot", publish="syphon")
    tex("balls_txt", "ascii", inputs=["balls_ink"], ramp=" .:-=+*#%@", params=[80, 0], publish="syphon")
