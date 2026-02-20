s.reboot


(
// Define the synth
SynthDef(\birderVoice, {
	var freq = \freq.kr(880);
	var duration = \duration.kr(5);
	var twit = \twitter.kr(9);
	var out = SinOsc.ar(freq);
	var env;
	out = out * LFTri.ar(twit);
	out = out * LFTri.ar(0.2);
	out = Pan2.ar(out, LFNoise1.kr(2));

	// Envelope for fade in/out
	env = EnvGen.kr(Env.linen(0.1, duration - 0.2, 0.1), doneAction: 2);
	Out.ar(0, out * env * \amp.kr(1));
}).add;
)
(
// Function to spawn a new synth
SystemClock.clear;
// Schedule continuous spawning
5.do {
	SystemClock.sched(2, {
	/*if(synthChorus.size > 0) {
		synthChorus = synthChorus.reject { |s| s.isRunning.not };
	};*/


	var duration = rrand(1.0, 5.0);
	var freq = rrand(600, 1200);
	var synth = Synth(\birderVoice, [
		\freq, freq,
		\duration, duration,
		\twitter, rrand(5, 10),
		\amp, 1/5
	]);
	duration + rrand(0, 5); // return duration for scheduling
});
}
)