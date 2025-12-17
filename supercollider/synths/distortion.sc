
SynthDef(\delayDistortion, {
	arg delayTimes = #[0.1, 0.1, 0.1], mix = 0.2, level = 1, inBus = 0, outBus = 0;
	var input, delayed, feedback, filtered, output;
	var feedbackAmount = 1;
	var matrix, matrixMixed, sig2;

	input = In.ar(inBus);

	// Create feedback with lowpass filtering
	feedback = LocalIn.ar(3);

	// Create 6-tap delay network
	delayed = delayTimes.collect { |delayTime, idx|
		var sig = feedback[idx] * mix + input;
		DelayL.ar(Compander.ar(sig, sig, 0.5, 1, 0, 0.01), 0.2, delayTime);
	};

	// Generate random 3x3 matrix
	matrix = Array2D(3, 3);
	3.do({|i| 3.do({|j| matrix[i,j] = 0.4.rand + 0.8; }); });

	delayed[0] = (delayed[0] * matrix[0, 0]) + (delayed[1] * matrix[0, 1]) + (delayed[2] * matrix[0, 2]) / 3;
	delayed[1] = (delayed[0] * matrix[1, 0]) + (delayed[1] * matrix[1, 1]) + (delayed[2] * matrix[1, 2]) / 3;
	delayed[2] = (delayed[0] * matrix[2, 0]) + (delayed[1] * matrix[2, 1]) + (delayed[2] * matrix[2, 2]) / 3;

	sig2 = delayed.tanh;
	LocalOut.ar(Clip.ar(Compander.ar(sig2, sig2, 0.5, 1, 0), -1, 1));

	// Output mix
	Out.ar(outBus, Mix.ar(delayed) * level ! 2);
}).add;


/*sample = {{2.1.rand}.dup(3)}.dup(3);
	matrix = Array2D.fromArray(3, 3, sample.flat);

	3.do({ |i|
		delayed[i] = 3.collect({ |j| "delayed % * matrix %, %, % + ".format(j, i, j, matrix[i,j]).postln; delayed[j] * matrix[i, j] }).sum / 3;
	});*/

OSCdef.new(\delayDistortionTimes, { |msg, time, addr, recvPort|
	~delayDistortion.set(\delayTimes, msg[1..3]);
}, "/delaydistortion/times");
OSCdef.new(\delayDistortionMix, { |msg, time, addr, recvPort|
	~delayDistortion.set(\mix, msg[1]);
}, "/delaydistortion/mix");