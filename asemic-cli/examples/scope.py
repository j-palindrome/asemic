# scope — x/y oscilloscope over JACK (out_1 = x, out_2 = y); jackd must be running.

with block("comp", timestretch=0.5):
    proc("word", "glyph", text="ASEMIC")

with block("scope", loop="loop"):
    output("scope", "jack", src="../comp/word", hz=60)
