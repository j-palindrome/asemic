
SynthDef(\granular, {
	|
	rate = 30,
	inBus = 0,
	outBus = 0,
	level = 1
	|

	var input, sig, bufnum = ~recordBuf;
	
	sig = TGrains.ar(
		numChannels: 2,
		trigger: Impulse.ar(rate),
		bufnum: bufnum,
		rate: LFNoise0.ar(rate, 2, 1),
		centerPos: Line.ar(0, BufDur.ir(bufnum), BufDur.ir(bufnum)),
		dur: (1 / rate) * LFNoise0.ar(rate, 1, 0.5),
		pan: LFNoise0.ar(rate),
		amp: LFNoise1.ar(rate/10),
		interp: 2
	);
	Out.ar(outBus, sig * level);
}).add;

OSCdef.new(\granularRate, { |msg| ~granularSynth.set(\rate, msg[1]); }, "/granular/rate");
OSCdef.new(\granularLevel, { |msg| ~granularSynth.set(\level, msg[1]); }, "/granular/level");