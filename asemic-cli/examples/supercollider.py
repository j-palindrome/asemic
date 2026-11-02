# supercollider — xy pad drives a compiled SynthDef voice (adapters/supercollider/boot.scd:
# filtered saw, RLPF cutoff/res) live over OSC.
#
# Explore:
#   - Start the adapter first: use the `:adapters` panel to insert a `supercollider` block and
#     play it (Space), or add `with block("supercollider", timestretch=1.0): pass` to the file.
#     boot.scd compiles `SynthDef(\asemicVoice)` and plays one live Synth instance.
#   - xy("voice") pad -> freq (x) / cutoff (y): dragging it (or anim="drift" wandering on its
#     own) sends `supercollider.set.freq` / `supercollider.set.cutoff` (resolved to
#     `asemic/out/supercollider/set/freq` etc.), which the adapter's `/set/<name>` router
#     applies straight to the running Synth via `.set`.
#   - param("amp")/("res") -> amp/res: loudness and filter resonance, same `/set/<name>`
#     contract; 0 amp = silent, pushing res toward 1.0 self-oscillates the RLPF.
#   - route(frm=, to=) rescales each control's own [min, max] into the SynthDef's arg range
#     (freq 40..2000 Hz, cutoff 100..8000 Hz) so the pad/sliders stay normalized UI controls.

with block("controls", timestretch=1.0):
    xy("voice", anim="drift", depth=0.1, label="VOICE")
    param("amp", 0, 1, default=0.1, label="AMP")
    param("res", 0.05, 1, default=0.3, label="RES")

with block("voice", timestretch=1.0):
    # cross-block src = path, `/` nests into the other block, `.` picks its field (ids::resolve
    # grammar) -- bare `voice.x` would stay scoped to this block and never match.
    route("../controls/voice.x", "supercollider.set.freq", frm=(-1, 1), to=(40, 2000))
    route("../controls/voice.y", "supercollider.set.cutoff", frm=(-1, 1), to=(100, 8000))
    route("../controls/amp", "supercollider.set.amp", frm=(0, 1), to=(0, 1))
    route("../controls/res", "supercollider.set.res", frm=(0.05, 1), to=(0.05, 1))
