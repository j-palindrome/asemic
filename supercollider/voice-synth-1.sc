// Simple voice passthrough SynthDef with infinite delay using DelayL
s.reboot;
s.options.memSize = 2.pow(20);
s.freeAll;
s.quit;
(
s.freeAll;
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

SynthDef(\input, {
	arg inBus = 0, effectsOutBus = 1, amp = 1.0, pan = 0.5;
	var input, stereo;

	// Get audio input from specified bus (default is hardware input 0)
	input = SoundIn.ar(inBus);

	// Route to effects bus
	Out.ar(effectsOutBus, Pan2.ar(input * amp), pan);
}).add;

SynthDef(\passthrough, {
	arg inBus = 1, outBus = 0, amp = 1.0;
	var input;

	// Read from effects bus and pass through with amplitude control
	input = In.ar(inBus, 2);
	Out.ar(outBus, input * amp);
}).add;
~effectsBus = Bus.audio(s, 1);
)

(
~inputGroup = Group.new(s, \addToHead);
~effectsGroup = Group.new(s, \addToTail);

// Spawn synths in correct order
~inputSynth = Synth(\input, [\inBus, 0, \effectsOutBus, ~effectsBus, \amp, 1.0], ~inputGroup);
~passthroughSynth = Synth(\passthrough, [\inBus, ~effectsBus.index, \outBus, 0, \amp, 1.0], ~effectsGroup);
~delaysSynth = Synth(\delays, [\inBus, ~effectsBus, \outBus, 0, \amp, 1.0], ~effectsGroup, \addToTail);
"Routing initialized: input -> effects -> {passthrough, delays} -> master";
)

(
OSCdef.freeAll;

// Passthroguh
OSCdef.new(\passthroughLevel, { |msg| ~passthroughSynth.set(\amp, msg[1]); }, "/passthrough/level");

// Effects
OSCdef.new(\effectsLevel, { |msg| ~masterSynth.set(\effectsLevel, msg[1]); }, "/effects/level");

// Delay
OSCdef.new(\feedback, { |msg| ~delaysSynth.set(\feedback, msg[1]); }, "/delay/feedback");
OSCdef.new(\delay, { |msg| ~delaysSynth.set(\delayTime, msg[1..4]); }, "/delay/time");
OSCdef.new(\delayMix, { |msg| ~delaysSynth.set(\mix, msg[1]); }, "/delay/level");
OSCdef.new(\toggleDelay, { |msg|
	if (msg[1] == 0.0, { ~delaysSynth.free(); }, { if (~delaysSynth.isRunning == false, { ~delaysSynth = Synth(\delays, [\inBus, ~effectsBus.index, \outBus, ~effectsBus.index], ~effectsGroup); }) });
}, "/delay/toggle");
)
~inputSynth.free;
~passthroughSynth.free;
~delaysSynth.free;
s.queryAllNodes;
s.plotTree;

OSCFunc.trace(true);
OSCFunc.trace(false);

// Test the OSC listener locally
(
"Testing OSC listener...".postln;
NetAddr("127.0.0.1", NetAddr.langPort).sendMsg('/passthrough/level', 0.75);
)

