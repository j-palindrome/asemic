# readyfire — asemic-cli template (blank). Open with `j asemic Projects/ReadyFire/readyfire.py`?
# Affinity: `affinity("score", input="chorus")` draws each new `chorus` multiarray in Affinity's
# current document (saved in this folder); score.json is written here.


with block("readyfire", loop="loop", timestretch="1.0"):
    # 1. Input motif seed row: 12-tone melodic/rhythmic birdcall motif (pitch_offset, dur_seconds)
    def bird_motif(p):
        # Rapid, chirping birdcall gestures modeled after SuperCollider call patch
        motif_pts = [
            (0.0, 0.05), (11.0, 0.04), (19.0, 0.06), (18.0, 0.04),
            (23.0, 0.03), (15.0, 0.07), (7.0, 0.08), (2.0, 0.12),
        ]
        t = 0.0
        line = []
        for pitch, dur in motif_pts:
            y = 1.0 - (pitch + 72.0 - 36.0) / 72.0
            line.append((t, y, pitch, dur))
            t += dur
        return {"dims": ["pitch", "dur"], "lines": [line]}

    py("motif", fn="./bird_motif")

    # 1.1 Variations proc: 12-tone variations (transpositions, inversions, retrogrades) modulated by noise
    variations("chorus", input="motif", voices=4, base=78.0, spread=10.0, noise_speed=0.25, rest_min=0.15, rest_max=2.2, duration=32.0, seed=108)

    # 1.1.1 Affinity score renderer: draws `chorus` multiarray in Affinity
    affinity("score", input="chorus", x=[1, 0], y=[1, 0], settings={"spacing": 1.0}, notes=("lines", "names"), preview="image", file="./score.af")
    embed("score")

    # 1.1.2.1 SuperCollider Ndef: audio rate synth voice
    sc("voice", """
{ |trig = 0, notePitch = 60, noteDur = 0.5, amp = 0.2|
    var t = trig.max(0);
    var env = EnvGen.kr(Env.perc(0.01, (noteDur * 0.8).clip(0.05, 4.0)), t);
    var freq = notePitch.midicps;
    var sig = VarSaw.ar(freq, 0, 0.3) * env;
    sig = MoogFF.ar(sig, (freq * 3).clip(100, 12000), 1.5);
    Pan2.ar(sig * amp, 0.0)
}
""", type="ndef")

    # 1.1.2 SuperCollider Tdef sequencer: routes `chorus` variations multiarray to `voice` controls
    sc("seq", type="tdef", input="chorus", target="voice", map={"pitch": "notePitch", "dur": "noteDur"})
