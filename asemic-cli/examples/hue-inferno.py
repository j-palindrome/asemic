# hue-inferno, rebuilt on asemic-cli (plan §10)
# Ctrl+R evals everything. Brain animates the vortex; the hue adapter only renders lamps.

xy("arena", label="VORTEX", anim="chaos", mode="drift")
param("intensity", 0.1, 2.5, default=1.0, step=0.1, label="INT")
proc("chaos", "chaos", speed=1.2, rho=28.0, sigma=10.0, beta=2.667)

with block("hue"):  # the hue adapter starts when this block starts
    pass

