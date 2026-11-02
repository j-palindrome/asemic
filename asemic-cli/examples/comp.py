# comp — Drawing -> Brushes -> Syphon: glyph generator stroked by a dot brush whose
# brightness samples Syphon input (td), screened over td.

with block("td", loop="loop"):
    tex("td", "in", adapter="syphon:TouchDesigner", w=1280, h=720)

with block("comp", timestretch=0.5):
    proc("word", "glyph", text="ASEMIC")
    tex("ink", "draw", inputs=["../td/td"], src=["word"], brush="dot", publish="syphon", brightness="return 0.5 + tex0(info.uv).r;")
    tex("comp", "shader", inputs=["../td/td", "ink"], publish="syphon", wesl="""
    import lygia::color::blend::screen::blendScreen3;
    fn shade(uv: vec2f) -> vec4f { return vec4f(blendScreen3(in0(uv).rgb, in1(uv).rgb), 1.0); }
    """)
