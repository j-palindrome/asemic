// Simple audio passthrough SynthDef with amplitude and pan control
s.reboot;
(
s.freeAll;
SynthDef(\passthrough, {
  arg inBus = 0, outBus = 0, amp = 1.0, pan = 0;
  var input, stereo;

  // Get audio input from specified bus (default is hardware input 0)
  input = SoundIn.ar(inBus);

  // Pan to stereo
  stereo = Pan2.ar(input, pan);

  // Output the signal with amplitude control
  Out.ar(outBus, stereo * amp);
}).add;
)

(
~passthrough = Synth(\passthrough, [inBus: 0, outBus: 0, amp: 1.0]);
)

(
OSCdef.freeAll;
OSCdef.new(\amp, { |msg| ~passthrough.set(\amp, msg[1]); }, "/passthrough/amp");
OSCdef.new(\pan, { |msg| ~passthrough.set(\pan, msg[1]); }, "/passthrough/pan");
OSCdef.new(\togglePassthrough, { |msg|
	if (msg[1] == 0.0, { ~passthrough.free(); }, { if (~passthrough.isRunning == false, { ~passthrough = Synth(\passthrough); }) });
}, "/toggle/passthrough");
)

s.queryAllNodes;
s.plotTree;
