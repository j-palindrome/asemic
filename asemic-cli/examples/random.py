# random — raw iid jitter plugged onto a param two ways via route(combine=).
# "jitter" (white) adds onto base_gain's stored value; "jitter2" (gauss) multiplies onto spread.
# Explore: swap gen= white/gauss, tweak scale/sigma kwargs, compare combine=add vs multiply.

with block("random", loop="loop"):
    param("base_gain", 0, 2, default=1.0, label="BASE GAIN")
    param("spread", 0, 2, default=1.0, label="SPREAD")
    proc("jitter", "white", scale=0.15)
    proc("jitter2", "gauss", sigma=0.1)
    route("jitter", "base_gain", frm=(-1, 1), to=(-1, 1), combine="add")
    route("jitter2", "spread", frm=(-1, 1), to=(0.5, 1.5), combine="multiply")
