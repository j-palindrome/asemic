// Simple voice passthrough SynthDef with infinite delay using DelayL
s.reboot;
s.options.memSize = 2.pow(20);
s.freeAll;
s.quit;
(
s.freeAll;
OSCdef.freeAll;

~effectsBus = Bus.audio(s, 1);
~recordBuf = Buffer.alloc(s, 44100 * 5, 1);

SynthDef(\input, {
	arg inBus = 0, effectsOutBus = 1, amp = 1.0, pan = 0.5;
	var input, stereo;

	// Get audio input from specified bus (default is hardware input 0)
	input = SoundIn.ar(inBus);
	RecordBuf.ar(input, ~recordBuf, Line.ar(0, BufDur.ir(~recordBuf) * 44100, BufDur.ir(~recordBuf)));
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
OSCdef.new(\passthroughLevel, { |msg| ~passthroughSynth.set(\level, msg[1]); }, "/passthrough/level");

"./synths/*".resolveRelative.loadPaths;
)

(
~inputGroup = Group.new(s, \addToHead);
~effectsGroup = Group.new(s, \addToTail);
~inputSynth = Synth(\input, [\inBus, 0, \effectsOutBus, ~effectsBus, \amp, 1.0], ~inputGroup);
~passthroughSynth = Synth(\passthrough, [\inBus, ~effectsBus.index, \outBus, 0, \amp, 1.0], ~effectsGroup);
~delaysSynth = Synth(\delays, [\inBus, ~effectsBus.index, \outBus, 0, \level, 0], ~effectsGroup);
~granularSynth = Synth(\granular, [\inBus, ~effectsBus.index, \outBus, 0, \level, 0], ~effectsGroup);
~delayDistortion = Synth(\delayDistortion, [\inBus, ~effectsBus.index, \outBus, 0, \level, 0], ~effectsGroup);
~bitcrush = Synth(\bitcrush, [\inBus, ~effectsBus.index, \outBus, 0, \level, 0], ~effectsGroup);
~glitcher = Synth(\glitcher, [\outBus, 0, \level, 0], ~effectsGroup);
)
(
~delayDistortion.set(\level, 0.0, \mix, 1, \delayTimes, 3.collect({ 1/(50.rand + 10) }));
~passthroughSynth.set(\level, 0);
~bitcrush.set(\level, 0);
~granularSynth.set(\level, 0, \rate, 10);
~glitcher.set(\level, 0, \rate, 1);
)
~inputSynth.free;
~passthroughSynth.free;
~delaysSynth.free;
s.queryAllNodes;
s.plotTree;

OSCFunc.trace(true);
OSCFunc.trace(false);