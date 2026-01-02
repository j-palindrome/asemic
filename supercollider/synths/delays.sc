SynthDef(\delays, {
	arg inBus = 1, outBus = 0, pan = 0, gate = 1,
	delayTime = #[0.25, 0.5, 0.75, 1], feedback = 0.9, level = 0;
	var input, stereo, delayed, feedbackSignal, mixed, delayBus, interference = 0.33;

	// Get audio input from specified bus (default is hardware input 0)
	input = In.ar(inBus) ! 4;

	// Create local bus for feedback loop
	delayBus = LocalIn.ar(4);

	// Add input and feedback signal
	feedbackSignal = input + (delayBus * feedback);

	// Create delay using DelayL (linear interpolation)
	delayed = DelayL.ar(
		feedbackSignal,
		maxdelaytime: 2.0,    // Maximum possible delay time
		delaytime: delayTime   // Actual delay time spread
	);

	// Write delayed signal back to local bus for feedback
	LocalOut.ar(delayed.collect({|x,i| (x + (delayed[0]*interference) + (delayed[1]*interference) + (delayed[2]*interference) + (delayed[3]*interference)) / (1 + (interference * 4))}));

	// Pan to stereo
	stereo = Mix.ar(delayed.collect({|d| Pan2.ar(d, LFNoise2.kr(LFNoise2.kr(1, 0.5, 0.5) * 2 + 0.5))})) * level;
	// Output the voice with amplitude control
	Out.ar(outBus, stereo);
}).add;

OSCdef.new(\delayFeedback, { |msg| ~delaysSynth.set(\feedback, msg[1]); }, "/delay/feedback");
OSCdef.new(\delayTime, { |msg| ~delaysSynth.set(\delayTime, msg[1..4]); }, "/delay/time");
OSCdef.new(\delayMix, { |msg| ~delaysSynth.set(\level, msg[1]); }, "/delay/level");

