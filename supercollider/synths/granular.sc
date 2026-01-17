
SynthDef(\granular, {
	| rate = #[30, 30],
	inBus = 0,
	outBus = 0,
	feedbackBus = 0,
	level = #[1, 1, 0],
	variation = #[0.5, 2] |

	var sig, trigger = Dust.ar(rate[0]), recordBuf = Buffer.alloc(s, 48000 * 5, 1);
	var input = In.ar(inBus, 2);
	RecordBuf.ar(input[0], recordBuf, Phasor.ar(0, 1, 0, BufDur.ir(recordBuf) * 48000));

	sig = TGrains.ar(
		numChannels: 2,
		trigger: trigger,
		bufnum: recordBuf,
		rate: TRand.ar(variation[0], variation[1], trigger),
		centerPos: Wrap.ar(Phasor.ar(Impulse.ar(1 / BufDur.ir(recordBuf)), 1 / SampleRate.ir, 0, BufDur.ir(recordBuf)) + TRand.ar(0, BufDur.ir(recordBuf) / 2 * -1), 0, BufDur.ir(recordBuf)),
		dur: TRand.ar(1 / rate[0], 1/rate[1], trigger),
		pan: TRand.ar(0, 1, trigger),
		amp: TRand.ar(0, 1, trigger),
		interp: 2
	);
	ReplaceOut.ar(outBus, (input * (1 - level[0])) + (sig * level[0]));
	Out.ar(0, sig * level[1]);
	Out.ar(feedbackBus, sig * level[2]);
}).add;

OSCdef.new(\granularRate, { |msg| ~granularSynth.set(\rate, msg[1..2]); }, "/granular/rate");
OSCdef.new(\granularLevel, { |msg| ~granularSynth.set(\level, msg[1..3]); }, "/granular/level");
OSCdef.new(\granularVariation, { |msg| ~granularSynth.set(\variation, msg[1..2]); }, "/granular/variation");