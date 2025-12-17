
~synthBuffer = Buffer.alloc(s, 44100 * 2, 1);
SynthDef(\granular, {
	|
		inBus, outBus,
		bufnum,
		grainDur = 0.1,      // Grain duration in seconds
		density = 10,        // Average grains per second
		densityVar = 0.5,    // Density variation (0-1)
		speedVar = 0.5,      // Playback speed variation (0-1)
		pitchVar = 0.5,      // Pitch variation (0-1)
		amp = 0.5,           // Output amplitude
		attack = 0.001,      // Envelope attack time
		release = 0.1        // Envelope release time
	|

	var input, sig;

	// Record input to buffer
	input = In.ar(inBus, 1);
	RecordBuf.ar(input, bufnum);
	sig = TGrains.ar(
			numChannels: 2,
			trigger: Dust.ar(10),
			bufnum: bufnum,
			rate: LFNoise0.kr(10, 2, 1),
			centerPos: Line.kr(0, BufDur.ir(bufnum), BufDur.ir(bufnum)),
			dur: 0.1,
			pan: 0.5,
			amp: 1,
			interp: 2
	);
	Out.ar(outBus, sig * amp);
}).add;