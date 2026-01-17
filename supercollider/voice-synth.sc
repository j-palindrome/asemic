// Simple voice passthrough SynthDef with infinite delay using DelayL

s.options.memSize = 2.pow(20);
s.options.numWireBufs = 128;
Sever.killAll;
s.reboot;
(
s.waitForBoot({
	s.freeAll;
	OSCdef.freeAll;

	~inputBus = Bus.audio(s, 2);
	~effectsBus = Bus.audio(s, 2);
	~feedbackBus = Bus.audio(s, 2);

	"./synths/*".resolveRelative.loadPaths;
	s.sync;

	~inputGroup = Group.new(s, \addToHead);
	~effectsGroup = Group.new(s, \addToTail);

	~inputSynth = Synth(\input, [\inBus, 0, \effectsOutBus, ~effectsBus, \amp, 1.0], ~inputGroup);
	~delayDistortion = Synth(\delayDistortion, [\inBus, ~effectsBus, \outBus, ~effectsBus, \feedbackBus, ~feedbackBus], ~effectsGroup, \addToTail);
	~granularSynth = Synth(\granular, [\inBus, ~effectsBus, \outBus, ~effectsBus, \feedbackBus, ~feedbackBus], ~effectsGroup, \addToTail);
	~bitcrush = Synth(\bitcrush, [\inBus, ~effectsBus, \outBus, ~effectsBus, \feedbackBus, ~feedbackBus], ~effectsGroup, \addToTail);
	~output = Synth(\output, [], ~effectsGroup, \addToTail);	
});
)
s.queryAllNodes;
~delayDistortion.set(\mix, [1, 0, 1, 0]);
~delayDistortion.set(\rate, Array.fill(3, {|p| 0.1.rand}));

