
// (
// ~delayDistortion.free;
// OSCdef(\delayDistortionRate).free;
// OSCdef(\delayDistortionLevel).free;
// OSCdef(\delayDistortionMix).free;
// );
// ~delayDistortion = Synth(\delayDistortion, [\inBus, 2, \outBus, 0, \level, 1]);
// ~delayDistortion.free;
// ~delayDistortion.set(\level, 1, \delayTimes, 3.collect({ 1/(30.rand + 10); }), \inBus, 2, \outBus, 0);
(

SynthDef(\delayDistortion, {
	arg rate = #[0.1, 0.1, 0.1, 0.1], level = #[1, 1], inBus = 2, outBus = 0, mix = #[1, 1, 0, 0], feedbackBus = 0;
	var input, delayed, feedback, matrix, count = 4, mixRatio = 1 - mix[0], amp;

	input = In.ar(inBus) + InFeedback.ar(feedbackBus);

	// Create feedback with lowpass filtering
	feedback = LocalIn.ar(count);

	// Create 6-tap delay network
	delayed = rate.collect { |delayTime, idx|
		var sig = feedback[idx] + input / 2;
		DelayL.ar(sig, 0.8, delayTime * LFNoise2.ar(1, mix[3], 1))
			// * LFNoise2.ar(rate, 0.01, 1));
	};


	// Generate random 3x3 matrix
	matrix = Array2D(count, count);
	count.do({|i|
		count.do({|j| matrix[i,j] =
			LFNoise2.ar(1, 0.2, 1) * if (i==j, {1-mix[1]}, {mix[1]});
	}) });

	delayed = delayed.collect({|d, i|
		var delay = Mix.ar(delayed.collect({|d, y| d * matrix[i,y]})) / Mix.ar(matrix.colAt(i)),
		amp;
		amp = Amplitude.ar(delay, 0.05, 0.5);
		delay = delay * Clip.ar(1 + (0.4 - amp * mix[2]), 0.9, 1.1);
		// delay = LeakDC.ar(delay, 0.95);
		delay = CompanderD.ar(delay, 0.95, 1, 0, 0.05, 0.1);
		delay;
	});

	feedback = delayed * mix[0] * 2;

	LocalOut.ar(feedback.tanh);
	delayed = Mix.ar(delayed.collect({ |d| Pan2.ar(d, LFNoise2.ar(1)) }));

	// Output mix
	ReplaceOut.ar(outBus, (input * (1 - level[0])) + (Clip.ar(delayed, -1, 1) * level[0]));
	Out.ar(0, Clip.ar(delayed, -1, 1) * level[1]);
}).add;
);

OSCdef.new(\delayDistortionRate, { |msg, time, addr, recvPort|
	~delayDistortion.set(\rate, msg[1..4]);
}, "/delaydistortion/rate");
OSCdef.new(\delayDistortionLevel, { |msg, time, addr, recvPort|
	~delayDistortion.set(\level, msg[1..2]);
}, "/delaydistortion/level");
OSCdef.new(\delayDistortionMix, { |msg, time, addr, recvPort|
	~delayDistortion.set(\mix, msg[1..4]);
}, "/delaydistortion/mix");