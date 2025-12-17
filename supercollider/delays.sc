SynthDef(\delays, {
  arg inBus = 1, outBus = 0, amp = 1.0, pan = 0, gate = 1,
	 delayTime = #[0.25, 0.5, 0.75, 1], feedback = 0.9, mix = 0.5;
  var input, stereo, delayed, feedbackSignal, mixed;
  var delayBus;

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
  LocalOut.ar(delayed);

  // Mix dry and delayed signals
  mixed = ((input) * (1 - mix)) + (delayed * mix);
  // Pan to stereo
  stereo = Pan2.ar(Mix.ar(mixed) / 4, pan);
  // Output the voice with amplitude control
  Out.ar(outBus, stereo * amp);
}).add;

OSCdef.new(\delayFeedback, { |msg| ~delaysSynth.set(\feedback, msg[1]); }, "/delay/feedback");
OSCdef.new(\delayTime, { |msg| ~delaysSynth.set(\delayTime, msg[1..4]); }, "/delay/time");
OSCdef.new(\delayMix, { |msg| ~delaysSynth.set(\mix, msg[1]); }, "/delay/level");

