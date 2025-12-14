// Simple voice passthrough SynthDef with infinite delay using DelayL
s.reboot;
s.options.memSize = 20000;
(
s.freeAll;
SynthDef(\voicePassthrough, {
  arg inBus = 1, outBus = 0, amp = 1.0, pan = 0, gate = 1,
	 delayTime = #[0.25, 0.5, 0.75, 1], feedback = 0.9, mix = 0.5;
  var input, stereo, delayed, feedbackSignal, mixed;
  var delayBus;

  // Get audio input from specified bus (default is hardware input 0)
  input = SoundIn.ar(inBus) ! 4;

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
	delayed.scope;

  // Write delayed signal back to local bus for feedback
  LocalOut.ar(delayed);

  // Mix dry and delayed signals
  mixed = ((input) * (1 - mix)) + (delayed * mix);
  // Pan to stereo
  stereo = Pan2.ar(Mix.ar(mixed) / 4, pan);
  // Output the voice with amplitude control
  Out.ar(outBus, stereo * amp);
}).add;
)
(
~voice = Synth(\voicePassthrough, [delayTime: [0.25, 0.5, 0.75, 1]]);
)
(
OSCdef.freeAll;
/*OSCdef.new(\delay, { |msg| if (~voice.isRunning, {~voice.set(\delayTime, msg[1]); "set delay %".format(msg[0]).postln; }); }, "/delay");
OSCdef.new(\feedback, { |msg| if (~voice.isRunning, {~voice.set(\feedback, msg[1]); "set feedback %".format(msg[1]).postln; }); }, "/feedback");*/
OSCdef.new(\delay, { |msg| ~voice.set(\delayTime, [msg[1], msg[2], msg[3], msg[4]]); "set delay %".format([msg[1], msg[2], msg[3], msg[4]]).postln; }, "/delay");
OSCdef.new(\feedback, { |msg| ~voice.set(\feedback, msg[1]); "set feedback %".format(msg[1]).postln; }, "/feedback");
/*OSCdef.new(\toggleDelay, { |msg|
	if (msg[1] == 0.0, { ~voice.free(); }, { if (~voice.isRunning == false, { ~voice = Synth(\voicePassthrough); }) });
}, "/toggle/delay");*/
)

s.queryAllNodes;
s.plotTree;

OSCFunc.trace(true);
OSCFunc.trace(false);

// Test the OSC listener locally
(
"Testing OSC listener...".postln;
NetAddr("127.0.0.1", NetAddr.langPort).sendMsg('/sc/sample', 0.75);
)

// Usage example:
// Start the synth
// ~voice = Synth(\voicePassthrough, [\amp, 0.8]);

// Stop the synth
// ~voice.set(\gate, 0);
