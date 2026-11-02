# clock — a bare tempo-only block (`timestretch=1.0` = real-time, `loop="loop"`).
# Minimal reference for a block that exists purely to carry a shared tempo.

with block("clock", timestretch=1.0, loop="loop"):
    tempo(96)
