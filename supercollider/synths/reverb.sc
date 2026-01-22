
// (
// ~delayDistortion.free;
// OSCdef(\delayDistortionRate).free;
// OSCdef(\delayDistortionLevel).free;
// OSCdef(\delayDistortionMix).free;
// );
// ~delayDistortion = Synth(\delayDistortion, [\inBus, 2, \outBus, 0, \level, 1]);
// ~delayDistortion.free;
// ~delayDistortion.set(\level, 1, \delayTimes, 3.collect({ 1/(30.rand + 10); }), \inBus, 2, \outBus, 0);
(
SynthDef(\reverb, {
	arg level = #[0], inBus = 2, outBus = 0;
	
	var input = In.ar(inBus, 2);
	var output = FreeVerb2.ar(input[0], input[1], mix: level[0], room: 0.5, damp: 0.5);

	// Output mix
	ReplaceOut.ar(outBus, output);
}).add;
);

OSCdef.new(\reverbLevel, { |msg, time, addr, recvPort|
	~reverb.set(\level, [msg[1]]);
}, "/reverb/level");