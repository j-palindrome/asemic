# quantum-wave — stationary 1D Schrödinger via `schroidnger_equation`'s Numerov shooting
# integrator (proc.rs Wave, §11.6), potential = QHO (½kx²) across x in [-span, span].
#
# Explore:
#   - param("energy") swept by hand or by anim: sweeping `energy` through the QHO
#     eigenvalues E_n = (n + 0.5) * sqrt(k/mass) flips the sign of the wavefunction's tail
#     (proc.rs's `value` channel = tanh of psi at the right edge) -- with the defaults below
#     (k=1, mass=1) that's E_0=0.5, E_1=1.5, E_2=2.5, ...; watch the ascii/draw trace jump
#     as `energy` crosses each one (this is exactly `wave_uses_crate_and_tail_flips_across_
#     eigenvalue` in proc.rs's tests, just swept continuously instead of in two steps).
#   - noise("sweep", "lfo") + anim on `energy` auto-sweeps it back and forth through several
#     eigenvalues so you can see the tail-flip live without touching a slider.
#   - param("k"): QHO stiffness -- raising it spaces the eigenvalues (and the wave) out
#     (ω = sqrt(k/mass) grows), so the same `energy` range crosses fewer levels.
#   - param("mass"): heavier "particle" -> smaller ω -> eigenvalues packed closer together.
#   - param("span"): half-width of the integration domain; too small clips the wavefunction
#     against the box edges (visible as the drawn curve getting chopped near x=±1).
#
# QHO comparison: the `qho_energy` python helper below is the textbook analytic
# E_n = (n + 0.5) * sqrt(k/mass) (ħ=1 units) so you can read off which eigenvalue `energy`
# is near as you sweep it -- proc.rs's Wave itself only integrates Numerov; it does not
# report which n the current energy is closest to.

def qho_energy(n: int, k: float = 1.0, mass: float = 1.0) -> float:
    return (n + 0.5) * (k / mass) ** 0.5


with block("clock"):
    tempo(90)

with block("controls"):
    param("k", 0.1, 4, default=1.0, label="K (stiffness)")
    param("mass", 0.1, 4, default=1.0, label="MASS")
    param("span", 1, 10, default=5.0, label="SPAN")
    param("energy", 0, 3, default=0.5, label="ENERGY")
    with block("auto_sweep"):
        # un-comment to auto-sweep energy across E_0..E_2 (~0.5..2.5) instead of hand-dragging
        # noise("sweep", "lfo", freq=0.1)
        # param("energy", 0, 3, default=0.5, anim="sweep", mode="replace", depth=1.0)
        pass

with block("wave"):
    proc("psi", "wave", energy=0.5, k=1.0, mass=1.0, span=5.0)
    route("../controls/energy", "asemic/state/param/wave/psi.energy", frm=(0, 3), to=(0, 3))
    route("../controls/k", "asemic/state/param/wave/psi.k", frm=(0.1, 4), to=(0.1, 4))
    route("../controls/mass", "asemic/state/param/wave/psi.mass", frm=(0.1, 4), to=(0.1, 4))
    route("../controls/span", "asemic/state/param/wave/psi.span", frm=(1, 10), to=(1, 10))

with block("draw"):
    tex("psi_ink", "draw", src=["../wave/psi"], brush="line", publish="syphon")
    tex("psi_txt", "ascii", inputs=["psi_ink"], ramp=" .:-=+*#%@", params=[100, 0], publish="syphon")
