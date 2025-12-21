
SynthDef(\bitcrush, {
	| inBus = 3, outBus = 0, level = 1, rate = 1, mix = 1 |
	var input, freq;
	freq = LFNoise0.ar(LFNoise2.ar(rate, 1/2, 1/2), 1/2, 1/2) * (mix * 2000) + 100;
	input = In.ar(inBus);
	Out.ar(outBus, Latch.ar(input, Impulse.ar(freq)) * level ! 2);
}).add;
OSCdef(\bitcrush_level, { |msg, time, addr, recvPort|
	~bitcrush.set(\level, msg[1]);
}, "/bitcrush/level");
OSCdef(\bitcrush_rate, { |msg, time, addr, recvPort|
	~bitcrush.set(\rate, msg[1]);
}, "/bitcrush/rate");
OSCdef(\bitcrush_mix, { |msg, time, addr, recvPort|
	~bitcrush.set(\mix, msg[1]);
}, "/bitcrush/mix");