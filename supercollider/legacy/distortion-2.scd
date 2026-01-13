
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
	arg rate = #[0.1, 0.1, 0.1], level = 1, inBus = 2, outBus = 0, mix = #[1, 1, 1];
	var input, delayed, feedback, filtered, output;
	var feedbackAmount = 1;
	var matrix, matrixMixed, sig2;

	input = In.ar(inBus);

	// Create feedback with lowpass filtering
	feedback = LocalIn.ar(3);

	// Create 6-tap delay network
	delayed = rate.collect { |delayTime, idx|
		var sig = feedback[idx];
		DelayL.ar(sig, 0.8, delayTime);
	};

	// Generate random 3x3 matrix
	matrix = Array2D(3, 3);
	3.do({|i| 3.do({|j| matrix[i,j] = if (i == j, {1}, {LFNoise2.ar(1, 0.2, 0.8) * mix[1]}) }); });

	delayed = delayed.collect({|d, x|
		var delay = Mix.ar(delayed.collect({|d, y| d * matrix[x,y]})) / Mix.ar(matrix.colAt(x)),
		amp;
		delay = CompanderD.ar(d, 0.5, 1.0, 0.25, 0.01);
		amp = Amplitude.ar(delay + input, 0.05, 0.5);
		amp.poll;
		delay * (1 - (amp - 0.9 * mix[2])) * (LFNoise2.ar(1, 0.1, 1 - (0.1 / 2)));
	});

	LocalOut.ar((delayed.tanh) * mix[0] + (input ! 3));

	// Output mix
	Out.ar(outBus, Clip.ar(Mix.ar(delayed), 0, 1) * level ! 2);
}).add;
);

OSCdef.new(\delayDistortionRate, { |msg, time, addr, recvPort|
	~delayDistortion.set(\rate, msg[1..3]);
}, "/delaydistortion/rate");
OSCdef.new(\delayDistortionLevel, { |msg, time, addr, recvPort|
	~delayDistortion.set(\level, msg[1]);
}, "/delaydistortion/level");
OSCdef.new(\delayDistortionMix, { |msg, time, addr, recvPort|
	~delayDistortion.set(\mix, msg[1]);
}, "/delaydistortion/mix");