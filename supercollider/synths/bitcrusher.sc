
SynthDef(\bitcrush, {
	| inBus = 3, outBus = 0, level = #[1, 1], rate = 1, mix = 1 |
	var input = In.ar(inBus, 2);
	var freq = LFNoise0.ar(LFNoise2.ar(rate, 1/2, 1/2), 1/2, 1/2) * (mix * 2000) + 100;
	var output = Latch.ar(input, Impulse.ar(freq));
	Out.ar(outBus, (input * (1 - level[0])) + (output * level[0]));
	Out.ar(0, output * level[1]);
}).add;

OSCdef(\bitcrush_level, { |msg, time, addr, recvPort|
	~bitcrush.set(\level, msg[1..2]);
}, "/bitcrush/level");
OSCdef(\bitcrush_rate, { |msg, time, addr, recvPort|
	~bitcrush.set(\rate, msg[1]);
}, "/bitcrush/rate");
OSCdef(\bitcrush_mix, { |msg, time, addr, recvPort|
	~bitcrush.set(\mix, msg[1]);
}, "/bitcrush/mix");