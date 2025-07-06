(
// Configure server options
s = Server.local;
s.options.numOutputBusChannels = 2; // Stereo output
s.options.numInputBusChannels = 2;  // Stereo input
s.options.sampleRate = 44100;
s.reboot;

// Boot server with these options
s.waitForBoot({
	"Server booted and ready for headphone monitoring.".postln;
});
);

s.freeAll;
{SinOsc.ar(440, 0, 0.1)}.play;
// Wait for server to boot before continuing with synth definitions
(
SynthDef(\micThrough, {
	arg in=0, out=0, amp=1;
	var sig, panPos;

	// Get audio from microphone (stereo)
	// sig = SoundIn.ar(in);
	sig = SinOsc.ar(440);

	// Apply amplitude control
	sig = sig * amp;

	// Compression
	sig = Compander.ar(sig,
		thresh: 0.5,      // Threshold
		slopeBelow: 1,    // Slope below threshold
		slopeAbove: 0.5,  // Slope above threshold
		clampTime: 0.01,  // Attack time
		relaxTime: 0.1    // Release time
	);

	// Autopanning (using Balance2 for stereo input)
	// Initialize panning position with default value
	panPos = 0;

	// Define OSC receiver for pan control
	OSCdef(\panControl, {|msg|
		panPos = msg[1].clip(-1, 1);  // OSC message first value, clipped to valid range
	}, '/asemic/pan');  // OSC address pattern

	// Apply panning with OSC-controlled position
	sig = Pan2.ar(sig, panPos);

	

	// Reverb
	sig = FreeVerb.ar(sig,
		mix: 0.3,         // Dry/wet mix
		room: 0.6,        // Room size
		damp: 0.5         // High frequency damping
	);

	// Output to headphones
	Out.ar(out, sig);
}).add;
// Free previous instance if it exists
/*if(~micThrough.notNil) {
	~micThrough.free;
	"Freed previous mic".postln;
};*/
~micThrough = Synth(\micThrough);
);