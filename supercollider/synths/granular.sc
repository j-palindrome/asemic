
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
		trigger: Dust.ar(rate),
		bufnum: bufnum,
		rate: LFNoise0.kr(rate, 2, 1),
		centerPos: Line.kr(0, BufDur.ir(bufnum), BufDur.ir(bufnum)),
		dur: (1 / rate) * LFNoise0.kr(rate, 1, 0.5),
		pan: LFNoise0.kr(rate),
		amp: LFNoise1.kr(rate/10),
		interp: 2
	);
	Out.ar(outBus, sig * level);
}).add;

OSCdef.new(\granularRate, { |msg| ~granularSynth.set(\rate, msg[1]); }, "/granular/rate");
OSCdef.new(\granularLevel, { |msg| ~granularSynth.set(\level, msg[1]); }, "/granular/level");