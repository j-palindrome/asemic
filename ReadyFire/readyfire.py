# readyfire — asemic-cli template (blank). Open with `j asemic Projects/ReadyFire/readyfire.py`?
# Affinity: `affinity("score", input="chorus")` draws each new `chorus` multiarray in Affinity's
# current document (saved in this folder); score.json is written here.


with block("readyfire", loop="loop", timestretch="0.0"):
    with block("affinity", timestretch="0.0"):
        # Input motif seed row: 12-tone melodic/rhythmic birdcall motif (pitch_offset, dur_seconds)
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

        # Official brain proc `variations`: takes input seed gen (or multiarray from another proc),
        # then introduces 12-tone variations (transpositions, inversions, retrogrades) modulated by noise.
        variations("chorus", input="motif", voices=4, base=78.0, spread=10.0, noise_speed=0.25, rest_min=0.15, rest_max=2.2, duration=32.0, seed=108)

        # renderer row: draws `chorus` in Affinity using second-notation x=[1,0], lines only
        affinity("score", input="chorus", x=[1, 0], y=[1, 0], settings={"spacing": 1.0}, notes=("lines", "names"), preview="image", file="./score.af")
        embed("score")

    # Peer SuperCollider Ndef block: audio rate synth voice
    with block("scndef", timestretch=1.0):
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

    # Peer SuperCollider Tdef block: task proxy sequencer pulling multiarray from melody proc
    with block("sctdef", timestretch=1.0, length=16.0):
        melody("notes", voices=1, base=60.0, beats=16.0)

        # Zero-code Tdef sequencer: routes `notes` multiarray properties to `scndef/voice` controls
        sc("seq", type="tdef", input="notes", target="scndef/voice", map={"pitch": "notePitch", "dur": "noteDur"})

    # Peer Sequencer block: sends MIDI events to external ports / DAWs (CoreMIDI / ALSA)
    with block("sequencer", timestretch=1.0, length=16.0):
        # Generates scale-degree melody multiarray for MIDI transmission
        melody("stream", voices=1, base=60.0, beats=16.0)
