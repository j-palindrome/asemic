
SynthDef(\bitcrush, {
	| inBus = 3, outBus = 0, level = #[0, 0, 0], rate = #[0, 0, 0, 0], mix = 1 |
	var input = In.ar(inBus, 2);
	var output = Mix.ar(rate.collect { |f| Pan2.ar(Latch.ar(input, Impulse.ar(f * 4000 + 50)), LFNoise2.ar(1, -1, 1)) }) / rate.size;
	ReplaceOut.ar(outBus, (input * (1 - level[0])) + (output * level[0]));
	Out.ar(0, output * level[1]);
}).add;

OSCdef(\bitcrush_level, { |msg, time, addr, recvPort|
	~bitcrush.set(\level, msg[1..3]);
}, "/bitcrush/level");
OSCdef(\bitcrush_rate, { |msg, time, addr, recvPort|
	~bitcrush.set(\rate, msg[1..4]);
}, "/bitcrush/rate");
OSCdef(\bitcrush_mix, { |msg, time, addr, recvPort|
	~bitcrush.set(\mix, msg[1]);
}, "/bitcrush/mix");