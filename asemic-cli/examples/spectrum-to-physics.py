# spectrum-to-physics — rustfft bands (proc.rs Spectrum, §11.6) kicking physics bodies:
# cross-processor chaining. Spectrum's `input` kwarg takes an io stream OR a noise/value key
# ("gen_id:field", verbs.rs `proc` doc + engine.rs's per-frame `slot.input` sampling), so with
# no live audio adapter this falls back to sampling a chaos noisegen's `value` channel every
# frame as Spectrum's signal; swap the `input=` below for a real `asemic/io/<adapter>/<name>`
# key once an audio adapter (JACK capture etc.) is wired in.
#
# Explore:
#   - noise("src", "chaos", ...): the fallback "signal" spectrum analyzes; try "perlin" or
#     "random-walk" for a less tonal spectrum.
#   - proc("spec", "spectrum", input="src:value", gain=...): `gain` param scales band energy
#     before the tanh squash (proc.rs Spectrum::step); push it up to make quiet signal regions
#     register as louder bands.
#   - route("spec:high", ... balls.kick): the `high` channel (top half of the FFT, proc.rs
#     `band(32, SN/2)`) drives physics.kick -- bright/high-frequency content in the signal
#     kicks the balls; swap `high` for `low`/`mid`/`centroid`/`value` to chain a different band.
#   - param("sensitivity"): scales physics.restitution, letting you tune how bouncy the
#     balls stay as the spectrum kicks them.

with block("clock", timestretch=1.0):
    tempo(100)

with block("noise", timestretch=1.0):
    proc("src", "chaos", speed=1.5, rho=28.0, sigma=10.0, beta=2.667)

with block("controls", timestretch=1.0):
    param("gain", 0.1, 4, default=1.0, label="FFT GAIN")
    param("sensitivity", 0, 4, default=1.5, label="KICK SENS")

with block("spectrum", timestretch=1.0):
    proc("spec", "spectrum", input="../noise/src:value", gain=1.0)
    route("../controls/gain", "asemic/state/param/spectrum/spec.gain", frm=(0.1, 4), to=(0.1, 4))

with block("balls", timestretch=1.0):
    proc("balls", "physics", n=16, gravity=0.8, restitution=0.9, radius=0.03, kick=0.0)
    route("../spectrum/spec:high", "asemic/state/param/balls/balls.kick", frm=(-1, 1), to=(0, 4), id="high_kick")
    route("../controls/sensitivity", "asemic/state/param/balls/balls.restitution", frm=(0, 4), to=(0.5, 1.0))

with block("draw", timestretch=1.0):
    tex("spec_ink", "draw", src=["../spectrum/spec"], brush="line", publish="syphon")
    tex("balls_ink", "draw", src=["../balls/balls"], brush="dot", publish="syphon")
    tex("comp", "shader", inputs=["spec_ink", "balls_ink"], publish="syphon", wesl="""
    import lygia::color::blend::screen::blendScreen3;
    fn shade(uv: vec2f) -> vec4f { return vec4f(blendScreen3(in0(uv).rgb, in1(uv).rgb), 1.0); }
    """)
    tex("comp_txt", "ascii", inputs=["comp"], ramp=" .:-=+*#%@", params=[80, 0], publish="syphon")
