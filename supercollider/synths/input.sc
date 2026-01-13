SynthDef(\input, {
  arg inBus = 0, effectsOutBus = 1, amp = 1.0, level = 1;
  var input = CompanderD.ar(SoundIn.ar(inBus), 0.8, 1, 0.8);
  var output = Pan2.ar(input * amp, 0.5);

  // Get audio input from specified bus (default is hardware input 0)
  // Route to effects bus
  Out.ar(effectsOutBus, output);
  Out.ar(0, output * level);
}).add;
OSCdef.new(\passthroughLevel, { |msg| ~inputSynth.set(\level, msg[1]) }, "/passthrough/level");