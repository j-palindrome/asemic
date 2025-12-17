
SynthDef(\bitcrush, {
	| inBus = 3, outBus = 0, level = 1 |
	var input, freq;
	freq = LFNoise0.ar(LFNoise2.ar(1, 1/2, 1/2) * 20 + 1, 1/2, 1/2) * 2000 + 1000;
	input = In.ar(inBus);
	Out.ar(outBus, Latch.ar(input, Impulse.ar(freq)) * level ! 2);
}).add;