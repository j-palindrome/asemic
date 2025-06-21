(
s.options.maxLogins = 3;
s.options.inDevice = "MacBook Air Microphone";
s.options.outDevice = "External Headphones";
s.options.sampleRate = 44100;
s.options.blockSize = 1024;
s.options.hardwareBufferSize = 1024;
);
s.reboot;

// Reset commands
s.reboot;
s.waitForBoot({
	// Wait for server to be ready before continuing
	"Server booted successfully".postln;
});
s.freeAll;
Server.killAll;
~oscFuncs.do(_.free);

(
// SynthDefs for audio processing
SynthDef(\vsts, {
	|in, out|
	var sound = In.ar(in, 1).dup(2);
	sound = VSTPlugin.ar(sound, 2, id: \shimmer);
	sound = VSTPlugin.ar(sound, 2, id: \reverb);
	sound = VSTPlugin.ar(sound, 2, id: \vocorder);
	Out.ar(out, sound);
}).add;

SynthDef(\spinner, {
	|in, out, rate1=0.1, rate2=0.2, rate3=0.3, rate4=0.4|
	var sound = In.ar(in, 1).dup(2);
	var spin1, spin2, spin3, spin4, mixed;

	spin1 = Balance2.ar(sound[0], sound[1], SinOsc.ar(rate1));
	spin2 = Balance2.ar(sound[0], sound[1], SinOsc.ar(rate2));
	spin3 = Balance2.ar(sound[0], sound[1], SinOsc.ar(rate3));
	spin4 = Balance2.ar(sound[0], sound[1], SinOsc.ar(rate4));

	mixed = (spin1 + spin2 + spin3 + spin4) * 0.25;

	Out.ar(out, mixed);
}).add;

SynthDef(\drone, {
	|out, freq=440, detune=0.1, amp=0.3, filterFreq=800, resonance=0.3|
	var sound, env, freqMod, filterMod;

	// Slowly evolving frequency modulation
	freqMod = LFNoise1.kr(0.02).range(0.95, 1.05) *
				LFNoise1.kr(0.05).range(0.98, 1.02);

	// Filter modulation
	filterMod = LFNoise1.kr(0.03).range(0.5, 2.0);

	// Multiple oscillators for richness
	sound = Mix([
		SinOsc.ar(freq * freqMod),
		SinOsc.ar(freq * freqMod * 1.01),
		SinOsc.ar(freq * freqMod * 0.99),
		Saw.ar(freq * freqMod * 0.5) * 0.1
	]);

	// Slow amplitude envelope
	env = LFNoise1.kr(0.01).range(0.7, 1.0) *
			LFNoise1.kr(0.04).range(0.8, 1.0);

	// Filter sweep
	sound = RLPF.ar(sound, filterFreq * filterMod, resonance);
	sound = sound * env * amp;

	// Stereo spread
	sound = Pan2.ar(sound, LFNoise1.kr(0.02));

	Out.ar(out, sound);
}).add;

~voiceBus = Bus.audio(s, 1);
~voice = { Out.ar(~voiceBus, SoundIn.ar(0)) }.play; // Convert mono to stereo

~outBus = Bus.audio(s, 2);
~outMonitor = {
	var sound = In.ar(~outBus, 2);
	sound = Compander.ar(sound, sound,
		thresh: 0.5,
		slopeBelow: 1,
		slopeAbove: 0.5,
		clampTime:  0.01,
		relaxTime:  0.01
	);
	sound = Limiter.ar(sound, 0.99, 0.01);
	Out.ar(0, sound);
}.play;

~vsts = Synth(\vsts, [\in, ~voiceBus, \out, ~outBus]);
~spinner = Synth(\spinner, [\in, ~voiceBus, \out, ~outBus]);
~drone = Synth(\drone, [\out, ~outBus]);
~sineWave = { Out.ar(~outBus, SinOsc.ar(440, 0, 0.1).dup(2)) }.play;

~shimmer = VSTPluginController(~vsts, id: \shimmer);
~shimmer.open("ValhallaSupermassive", editor: true, verbose: true);
~reverb = VSTPluginController(~vsts, id: \reverb);
~reverb.open("Raum", editor: true, verbose: true);
~vocorder = VSTPluginController(~vsts, id: \vocorder);
~vocorder.open("Surge XT Effects.vst3", editor: true, verbose: true);

// OSC functions
(
~oscFuncs = [
	['reverb', 'vocorder', 'shimmer'].collect({ |name|
		[
			OSCFunc({
				|msg|
				currentEnvironment[name.asSymbol].set(*msg[1..]);
				("Message received by " ++ name ++ ": " ++ msg).postln;
			}, ('/' ++ name).asSymbol),
			OSCFunc({
				|msg|
				currentEnvironment[name.asSymbol].setn(0, msg[1..]);
				("Message received by " ++ name ++ ": " ++ msg).postln;
			}, ('/' ++ name ++ '/n').asSymbol)
		]
	}).flatten
];
);
);
