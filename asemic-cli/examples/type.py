# type — Hierarchical control & relative routing: 2 glyph masters -> live variable font
# (axis ASMC 0..1). Parent proc "type_txt" with route targeting "type_txt.ASMC" driven by
# sibling lfo. Drawing -> Brushes -> Syphon: text point arrays rendered through mesh brush
# directly out to Syphon zero-copy surface.

with block("type", loop="loop", timestretch=1.0):
    proc("type_thin", "glyph", stroke=30, seed=3)
    proc("type_bold", "glyph", stroke=110, seed=3)
    type_font = vfont("type_vf", ["type_thin", "type_bold"], chars="ASEMIC", live=True)
    proc("type_txt", "text", text="ASEMIC", path=type_font, ASMC=0)
    proc("type_lfo", "lfo", freq=0.25)
    route("type_lfo:value", "type_txt.ASMC", frm=(-1, 1), to=(0, 1))
    tex("type_ink", "draw", src=["type_txt"], brush="mesh", publish="syphon")
    tex("type_ascii", "ascii", inputs=["type_ink"], atlas=f"text:{type_font}", ramp=" ASEMIC", params=[80, 0], publish="syphon")
