// Simple voice passthrough SynthDef with infinite delay using DelayL

s.options.memSize = 2.pow(20);
s.options.numWireBufs = 128;
s.reboot;
(
s.waitForBoot({
	s.freeAll;
	OSCdef.freeAll;

	~inputBus = Bus.audio(s, 2);
	~effectsBus = Bus.audio(s, 2);
	~recordBuf = Buffer.alloc(s, 44100 * 5, 1);

	SynthDef(\input, {
		arg inBus = 0, effectsOutBus = 1, amp = 1.0, pan = 0.5;
		var input, stereo;

		// Get audio input from specified bus (default is hardware input 0)
		input = CompanderD.ar(SoundIn.ar(inBus), 0.8, 1, 0.8);
		// Route to effects bus
		Out.ar(effectsOutBus, Pan2.ar(input * amp), pan);
	}).add;

	SynthDef(\passthrough, {
		arg inBus = 1, outBus = 0, level = 1.0;
		var input;

		// Read from effects bus and pass through with amplitude control
		input = In.ar(inBus, 2);
		Out.ar(outBus, input * level);
	}).add;
	OSCdef.new(\passthroughLevel, { |msg| ~passthroughSynth.set(\level, msg[1]) }, "/passthrough/level");

	/*SynthDef(\output, {
		Out.ar(0, In.ar(~effectsBus, 2));
	}).add;*/

	"./synths/*".resolveRelative.loadPaths;
	s.sync;



	~inputGroup = Group.new(s, \addToHead);
	~effectsGroup = Group.new(s, \addToTail);

	// {Out.ar(0, In.ar(~distortionBus))}.play;


	~inputSynth = Synth(\input, [\inBus, 0, \effectsOutBus, ~effectsBus, \amp, 1.0], ~inputGroup);

	~delayDistortion = Synth(\delayDistortion, [\inBus, ~effectsBus, \outBus, 0, \level, 1], ~effectsGroup, \addToTail);
	~delayDistortion.set(\rate, Array.rand(3, 0.1, 0.2));
	~delayDistortion.set(\mix, [1, 0, 0]);

	//~passthroughSynth = Synth(\passthrough, [\inBus, ~effectsBus, \outBus, 0, \level, 1], ~effectsGroup);
	//~granularSynth = Synth(\granular, [\inBus, ~effectsBus, \outBus, ~effectsBus, \level, 0], ~effectsGroup, \addToTail);
	//~bitcrush = Synth(\bitcrush, [\inBus, ~distortionBus, \outBus, 0, \level, 0], ~effectsGroup);


});
)
s.queryAllNodes;
~delayDistortion.set(\mix, [1, 0, 1, 0]);
~delayDistortion.set(\rate, Array.fill(3, {|p| 0.1.rand}));

