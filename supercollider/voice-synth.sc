// Simple voice passthrough SynthDef with infinite delay using DelayL

s.options.memSize = 2.pow(20);
s.options.numWireBufs = 128;
Server.killAll;
s.reboot;
(
s.waitForBoot({
	s.freeAll;
	OSCdef.freeAll;

	~inputBus = Bus.audio(s, 2);
	~effectsBus = Bus.audio(s, 2);

	"./synths/*".resolveRelative.loadPaths;
	s.sync;

	~inputGroup = Group.new(s, \addToHead);
	~effectsGroup = Group.new(s, \addToTail);

	~inputSynth = Synth(\input, [\inBus, 0, \effectsOutBus, ~effectsBus], ~inputGroup);
	~delayDistortion = Synth(\delayDistortion, [\inBus, ~effectsBus, \outBus, ~effectsBus], ~effectsGroup, \addToTail);
	~granularSynth = Synth(\granular, [\inBus, ~effectsBus, \outBus, ~effectsBus], ~effectsGroup, \addToTail);
	~bitcrush = Synth(\bitcrush, [\inBus, ~effectsBus, \outBus, ~effectsBus], ~effectsGroup, \addToTail);
	~reverb = Synth(\reverb, [\inBus, ~effectsBus, \outBus, ~effectsBus], ~effectsGroup, \addToTail);
	~output = Synth(\output, [], ~effectsGroup, \addToTail);
});
)
s.queryAllNodes;
OSCFunc.trace(false);
~delayDistortion.set(\mix, [1, 0, 1, 0]);
~delayDistortion.set(\rate, Array.fill(4, {|p| 0.1.rand}));

