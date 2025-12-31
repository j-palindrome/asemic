
SynthDef(\granular, {
	|
	rate = 30,
	inBus = 0,
	outBus = 0,
	level = 1
	|

	var input, sig, bufnum = ~recordBuf, trigger = Dust.ar(rate);

	sig = TGrains.ar(
		numChannels: 2,
		trigger: trigger,
		bufnum: bufnum,
		rate: TRand.ar(0.5, 2, trigger),
		centerPos: Phasor.ar(Impulse.ar(1 / BufDur.ir(bufnum)), 1 / SampleRate.ir, 0, BufDur.ir(bufnum)),
		dur: (1 / rate),
		pan: LFNoise0.ar(rate),
		amp: LFNoise1.ar(rate/10),
		interp: 2
	);
	Out.ar(outBus, sig * level);
}).add;

OSCdef.new(\granularRate, { |msg| ~granularSynth.set(\rate, msg[1]); }, "/granular/rate");
OSCdef.new(\granularLevel, { |msg| ~granularSynth.set(\level, msg[1]); }, "/granular/level");