
(
~delayDistortion.free;
OSCdef(\delayDistortionRate).free;
OSCdef(\delayDistortionLevel).free;
OSCdef(\delayDistortionMix).free;
);
~delayDistortion = Synth(\delayDistortion, [\inBus, 2, \outBus, 0, \level, 1]);
// ~delayDistortion.free;
~delayDistortion.set(\level, 1, \delayTimes, 3.collect({ 1/(30.rand + 10); }), \inBus, 2, \outBus, 0);
(

SynthDef(\delayDistortion, {
	arg delayTimes = #[0.1, 0.1, 0.1], level = 1, inBus = 2, outBus = 0, mix = 1, rate = 1;
	var input, delayed, feedback, filtered, output;
	var feedbackAmount = 1;
	var matrix, matrixMixed, sig2;

	input = In.ar(inBus);

	// Create feedback with lowpass filtering
	feedback = LocalIn.ar(3);

	// Create 6-tap delay network
	delayed = delayTimes.collect { |delayTime, idx|
		var sig = feedback[idx];
		DelayL.ar(sig, 0.8, delayTime);
	};

	// Generate random 3x3 matrix
	matrix = Array2D(3, 3);
	3.do({|i| 3.do({|j| matrix[i,j] = LFNoise2.ar(rate, 0.2, 0.8) }); });

	/*delayed[0] = (delayed[0] * matrix[0, 0]) + (delayed[1] * matrix[0, 1]) + (delayed[2] * matrix[0, 2]) / (1 + matrix[0,1] + matrix[0,2]);
	delayed[1] = (delayed[0] * matrix[1, 0]) + (delayed[1] * matrix[1, 1]) + (delayed[2] * matrix[1, 2]) / (1 + matrix[1,1] + matrix[1,2]);
	delayed[2] = (delayed[0] * matrix[2, 0]) + (delayed[1] * matrix[2, 1]) + (delayed[2] * matrix[2, 2]) / (1 + matrix[2,1] + matrix[2,2]);*/

	delayed = delayed.collect({|d, i|
		var delay = (delayed[0] * matrix[i, 0]) + (delayed[1] * matrix[i, 1]) + (delayed[2] * matrix[i, 2]) / (matrix[i, 0] + matrix[i, 1] + matrix[i, 2]),
		sig = Compander.ar(d, d, 0.5, 1.0, 0.25, 0.01),
		sig3 = Amplitude.ar(sig + input, 0.05, 0.5);
		// sig * (1 - (sig3 - 1)) * (LFNoise2.ar(1, 0.5, 1 - (0.5 / 2)));
		sig * (1 - (sig3 - 0.9)) * (LFNoise2.ar(rate, 0.1, 1 - (0.1 / 2)));
	});

	LocalOut.ar((delayed.tanh) * mix + (input ! 3));

	// Output mix
	Out.ar(outBus, Mix.ar(delayed) * level ! 2);
}).add;
);


/*sample = {{2.1.rand}.dup(3)}.dup(3);
	matrix = Array2D.fromArray(3, 3, sample.flat);

	3.do({ |i|
		delayed[i] = 3.collect({ |j| "delayed % * matrix %, %, % + ".format(j, i, j, matrix[i,j]).postln; delayed[j] * matrix[i, j] }).sum / 3;
	});*/

OSCdef.new(\delayDistortionRate, { |msg, time, addr, recvPort|
	~delayDistortion.set(\delayTimes, msg[1..3]);
}, "/delaydistortion/rate");
OSCdef.new(\delayDistortionLevel, { |msg, time, addr, recvPort|
	~delayDistortion.set(\level, msg[1]);
}, "/delaydistortion/level");
OSCdef.new(\delayDistortionMix, { |msg, time, addr, recvPort|
	~delayDistortion.set(\mix, msg[1]);
}, "/delaydistortion/mix");