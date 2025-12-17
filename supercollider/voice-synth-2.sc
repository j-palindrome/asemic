s.freeAll;
s.quit;
(
s.freeAll;
// Boot server if needed
s.waitForBoot({

    // Create an effects bus (stereo)
    ~fxBus = Bus.audio(s, 2);

    // Input Synth - sends to effects bus
    SynthDef(\inputSynth, { | out = 3 |
		var sig;
		sig = SoundIn.ar(0);

        // Send to effects bus
        Out.ar(out, sig ! 2);
    }).add;

    // Effects Synth - reads from effects bus, outputs to main
    SynthDef(\fxReverb, {
        arg in = 0, out = 0, mix = 0.5, room = 0.8, damp = 0.5;
        var sig, fx;

        // Read from effects bus
        sig = In.ar(in, 2);

        // Apply reverb effect
        fx = FreeVerb.ar(sig, mix: mix, room: room, damp: damp);

        // Output to main bus
        Out.ar(out, fx);
    }).add;
});
)

(
// Create the effects synth (always running, at tail of default group)
    /*~fxSynth = Synth.tail(s, \fxReverb, [
        \in, ~fxBus,
        \out, 0,
        \mix, 0.5,
        \room, 0.8,
        \damp, 0.5
    ]);*/
	~inputSynth = Synth(\inputSynth, [\out, ~fxBus]);

)
