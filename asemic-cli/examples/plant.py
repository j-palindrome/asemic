# plant — Hierarchical parameter control & relative routing:
# Parent proc "plant" has nested params controlling its parameters (angle, growth) without
# redundant prefix. Sibling noise "plant_lfo" routes to "plant.attr.hue" (relative attribute
# offset). Drawing -> Brushes -> Syphon: stochastic branching L-system point arrays stroked
# by line brush directly out to Syphon zero-copy surface.

with block("plant", loop="loop"):
    proc("plant", "lsys", axiom="F", rules="0.6: F -> F[+F]F; 0.4: F -> F[-F]", n=4, angle=25, step=0.02, attrs={"hue": 0.3})
    param("angle", 10, 60, default=25)
    param("growth", 0, 1, default=1.0)
    proc("plant_lfo", "lfo")
    route("plant_lfo:value", "plant.attr.hue", frm=(-1, 1), to=(0, 0.6))
    tex("plant_ink", "draw", src=["plant"], brush="line", publish="syphon", brightness="return 0.4 + attr(info, DIM_hue);")
    tex("plant_txt", "ascii", inputs=["plant_ink"], ramp=" .:-=+*#%@", params=[100, 0], publish="syphon")
    # Sprout variant: glyph points sprout secondary trees along stroke tangents -> line brush to Syphon
    proc("sprout", "glyph", text="ASEMIC", size=0.12)
    proc("bush", "lsys", input="sprout", axiom="F", rules="0.6: F -> F[+F]F; 0.4: F -> F[-F]", n=3, angle=30, step=0.008, stride=6)
    tex("bush_ink", "draw", src=["sprout", "bush"], brush="line", publish="syphon")
    tex("bush_txt", "ascii", inputs=["bush_ink"], font="asemic", ramp=" ABCD", params=[60, 1], publish="syphon")
