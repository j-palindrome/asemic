// Simple voice passthrough SynthDef with infinite delay using DelayL
(
s.freeAll;
SynthDef(\voicePassthrough, {
  arg inBus = 0, outBus = 0, amp = 1.0, pan = 0, gate = 1,
      delayTime = 0.5, feedback = 0.9, mix = 0.5;
  var input, stereo, delayed, feedbackSignal, mixed;
  var delayBus;

  // Get audio input from specified bus (default is hardware input 0)
  input = SoundIn.ar(inBus);

  // Create local bus for feedback loop
  delayBus = LocalIn.ar(1);

  // Add input and feedback signal
  feedbackSignal = input + (delayBus * feedback);

  // Create delay using DelayL (linear interpolation)
  delayed = DelayL.ar(
    feedbackSignal,
    maxdelaytime: 2.0,    // Maximum possible delay time
    delaytime: delayTime   // Actual delay time
  );

  // Write delayed signal back to local bus for feedback
  LocalOut.ar(delayed);

  // Mix dry and delayed signals
  mixed = (input * (1 - mix)) + (delayed * mix);

  // Pan to stereo
  stereo = Pan2.ar(mixed, pan);

  // Output the voice with amplitude control
  Out.ar(outBus, stereo * amp);
}).add;
)

(
~voice = Synth(\voicePassthrough);
)

// OSC listener for /sc/sample messages to control delayTime
(
// Free any existing OSC listener
OSCdef.freeAll;

// Create new listener on default port (57120)
OSCdef.new(\scSample, { |msg, time, addr, recvPort|
   ~voice.set(\delayTime, msg[1].clip(0.0, 2.0));
}, '/sc/sample');

"OSC listener active on port % for /sc/sample".format(NetAddr.langPort).postln;
)

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
