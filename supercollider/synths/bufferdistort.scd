// Allocate 48K sample buffer
~bufferSize = 512;
~distortBuffer = Buffer.alloc(s, ~bufferSize, 1);

// Function to update buffer with MIDI note frequencies
(
~updateNotes = { |midiNotes|
	var bufferData = FloatArray.fill(~bufferSize, 0);

	// For each frequency, mark corresponding position in buffer with 1
	midiNotes.do { |freq|
		var index = 0, freqs = freq.midicps;
		while { index < ~bufferSize } {
			if (bufferData[index] == 1, {bufferData[index] = 0}, {bufferData[index] = 1});
			index = index + freqs;
		};
	};

	// Fill the buffer with the data
	~distortBuffer.loadCollection(bufferData);
};
)

(
Ndef(\bufferdistort, {
	var bufplay = PlayBuf.ar(1, ~distortBuffer, 1, 0, 0, 1);
	Out.ar(0, bufplay ! 2);
});
)