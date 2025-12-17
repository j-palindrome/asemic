// Simple voice passthrough SynthDef with infinite delay using DelayL
s.reboot;
s.options.memSize = 2.pow(20);
s.freeAll;
s.quit;
(
s.freeAll;
OSCdef.freeAll;

SynthDef(\input, {
	arg inBus = 0, effectsOutBus = 1, amp = 1.0, pan = 0.5;
	var input, stereo;

	// Get audio input from specified bus (default is hardware input 0)
	input = SoundIn.ar(inBus);

	// Route to effects bus
	Out.ar(effectsOutBus, Pan2.ar(input * amp), pan);
}).add;

SynthDef(\passthrough, {
	arg inBus = 1, outBus = 0, amp = 1.0;
	var input;

	// Read from effects bus and pass through with amplitude control
	input = In.ar(inBus, 2);
	Out.ar(outBus, input * amp);
}).add;
OSCdef.new(\passthroughLevel, { |msg| ~passthroughSynth.set(\amp, msg[1]); }, "/passthrough/level");

"granular.sc".loadRelative;
"delays.sc".loadRelative;

~effectsBus = Bus.audio(s, 1);
)

(
~inputGroup = Group.new(s, \addToHead);
~effectsGroup = Group.new(s, \addToTail);

// Spawn synths in correct order
~inputSynth = Synth(\input, [\inBus, 0, \effectsOutBus, ~effectsBus, \amp, 1.0], ~inputGroup);
~passthroughSynth = Synth(\passthrough, [\inBus, ~effectsBus.index, \outBus, 0, \amp, 1.0], ~effectsGroup);
// ~delaysSynth = Synth(\delays, [\inBus, ~effectsBus.index, \outBus, 0], ~effectsGroup);
// ~granularSynth = Synth(\granular, [\inBus, ~effectsBus.index, \outBus, 0, \bufnum, ~synthBuffer], ~effectsGroup);
)

(
Tdef(\granularT, {
	|
		grainDur = 0.1,      // Grain duration in seconds
		density = 10,        // Average grains per second
		densityVar = 0.5,    // Density variation (0-1)
		speedVar = 0.5,      // Playback speed variation (0-1)
		pitchVar = 0.5,      // Pitch variation (0-1)
		amp = 0.5,           // Output amplitude
		attack = 0.001,      // Envelope attack time
		release = 0.1        // Envelope release time
	|

	var input, sig, inBus = ~effectsBus.index, outBus = 0,
		bufnum = ~synthBuffer;

	// Record input to buffer
	input = In.ar(inBus, 1);
	RecordBuf.ar(input, bufnum);
	sig = TGrains.ar(
			numChannels: 2,
			trigger: Dust.ar(10),
			bufnum: bufnum,
			rate: LFNoise0.kr(10, 2, 1),
			centerPos: Line.kr(0, BufDur.ir(bufnum), BufDur.ir(bufnum)),
			dur: 0.1,
			pan: 0.5,
			amp: 1,
			interp: 2
	);
	Out.ar(outBus, sig * amp);
});
)

~inputSynth.free;
~passthroughSynth.free;
~delaysSynth.free;
s.queryAllNodes;
s.plotTree;

OSCFunc.trace(true);
OSCFunc.trace(false);