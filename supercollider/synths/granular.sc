
SynthDef(\granular, {
	|
	rate = #[30, 30],
	inBus = 0,
	outBus = 0,
	level = 1,
	variation = #[0.5, 2]
	|

	var input, sig, bufnum = ~recordBuf, trigger = Dust.ar(rate[0]);

	sig = TGrains.ar(
		numChannels: 2,
		trigger: trigger,
		bufnum: bufnum,
		rate: TRand.ar(variation[0], variation[1], trigger),
		centerPos: Wrap.ar(Phasor.ar(Impulse.ar(1 / BufDur.ir(bufnum)), 1 / SampleRate.ir, 0, BufDur.ir(bufnum)) + TRand.ar(0, BufDur.ir(bufnum) / 2 * -1), 0, BufDur.ir(bufnum)),
		dur: TRand.ar(1 / rate[0], 1/rate[1], trigger),
		pan: TRand.ar(0, 1, trigger),
		amp: TRand.ar(0, 1, trigger),
		interp: 2
	);
	Out.ar(outBus, sig * level);
}).add;

OSCdef.new(\granularRate, { |msg| ~granularSynth.set(\rate, msg[1..2]); }, "/granular/rate");
OSCdef.new(\granularLevel, { |msg| ~granularSynth.set(\level, msg[1]); }, "/granular/level");
OSCdef.new(\granularVariation, { |msg| ~granularSynth.set(\variation, msg[1..2]); }, "/granular/variation");