
(
s.options.memSize = 8192 * 5;
s.options.outDevice = "External Headphones";
s.options.inDevice = "Wireless PRO RX";
s.reboot();
)

Server.killAll;

~buffer = Buffer.alloc(s, 1024, 1);

(
s.freeAll;
SynthDef(\delay, {
  |out=0, feedback=0.98, lopass= -0.3, damping=0.5, gain=10|
  var delays, delayTimes, feedbackBus, input, wet, dry, recordIndex, delayTimesK, feedbacksK;
  input = Mix(SoundIn.ar([0, 1, 2, 3])) * 1/4;
	// Out.ar(0, input);
  dry = input;
  delayTimes = [1.0, 1.0, 1.0, 1.0];
  delayTimesK = \delayTimes.kr(delayTimes);
  feedbacksK = \feedbacks.kr(delayTimes.collect({1}));
  feedbackBus = LocalIn.ar(delayTimes.size);

	recordIndex = \recordIndex.kr(-1);

  delays = delayTimes.collect { |time, i|
    var output, recordInput = max(0, 1 - (i - recordIndex).abs);
		output = (recordInput * input) + DelayL.ar((recordInput * input) + (feedbackBus[i] * feedbacksK[i]), 5, delayTimesK[i]);
		output;
	};
	LocalOut.ar(delays);
	wet = Mix.ar(delays) * (1/delays.size);

	Out.ar(out, Pan2.ar(wet) * gain);
}).add;
)
~synth = Synth(\delay);

~synth.set(\recordIndex, 0 );
~synth.set(\delayTimes, [0.075, 2, 0.9, 3]);
~synth.set(\feedbacks, [0.9, 0.9, 0.9, 0.9]);
