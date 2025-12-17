
SynthDef(\glitcher, {
	|
	rate = 1,
	outBus = 0,
	level = 1
	|

	var rand, sig, bufnum = ~recordBuf,
	generator = Dust.kr(rate / 2),
	toggle = ToggleFF.kr(generator),
	randRate = TRand.kr(rate / 2, rate * 2, toggle);

	sig = TGrains.ar(
		numChannels: 2,
		trigger: Gate.ar(Impulse.ar(randRate), toggle),
		bufnum: bufnum,
		rate: 1,
		centerPos: Line.ar(0, BufDur.ir(bufnum), BufDur.ir(bufnum)),
		dur: 1 / randRate,
		pan: TRand.kr(0, 1, toggle),
		amp: toggle,
		interp: 0
	);
	Out.ar(outBus, sig * level);
}).add;