(
Ndef(\distortion3,
	{ |mix = 1, rates = #[0.1, 0.1, 0.1], feedback = 1.1|
	var count = 3;

	var in = SoundIn.ar(0);

	// create two FbNodes with different delay times
		var fbNodes = rates.collect({ |i| FbNode(1, 1);});

		var sigs = Array.fill(count, { |i| Mix.ar(fbNodes.collect({ |node, j| node.delay(rates[j]) * if (i==j, {1}, {LFNoise1.ar(1, 0.2, 1-0.2) * mix * 0.6})})) + in });

	sigs.do({ |sig, i|
		fbNodes[i].write(sig);
	});

	Out.ar(0, Pan2.ar(sigs[0], -0.8) + Pan2.ar(sigs[1], 0.8) + Pan2.ar(sigs[2], 0));
})
)
Ndef(\distortion3).set(\rates, Array.rand(3, 0.05, 0.3), \mix, 0.6);
s.reboot;