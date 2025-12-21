
// s.freeAll;
// ~recordBuf = Buffer.alloc(s, 48000 * 5, 1);
(
SynthDef(\glitcher, {
	|
	rate = 1,
	outBus = 0,
	level = 1
	|

	var rand, sig, bufnum = ~recordBuf,
	generator = Dust.ar(rate).round;

	RecordBuf.ar(In.ar(2), ~recordBuf, Line.ar(0, BufDur.ir(~recordBuf) * SampleRate.ir, BufDur.ir(~recordBuf)));

	sig = GrainBuf.ar(
		numChannels: 2,
		trigger: generator,
		sndbuf: bufnum,
		rate: TRand.ar(1, 1.5, generator),
		pos: Phasor.ar(Impulse.ar(1 / BufDur.ir(bufnum)), 1 / SampleRate.ir, 0, BufDur.ir(bufnum)) - TRand.ar(0, 1, generator),
		dur: TRand.ar(1/rate, 1/rate*20, generator),
		pan: TRand.ar(-1, 1, generator),
		interp: 1
	);
	Out.ar(outBus, sig * level);
}).add;
);

OSCdef(\glitcherRate, {
	|msg|
	~glitcher.set(\rate, msg[1]);
}, "/glitcher/rate");

OSCdef(\glitcherLevel, {
	|msg|
	~glitcher.set(\level, msg[1]);
}, "/glitcher/level");