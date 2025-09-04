~buffer = Buffer.alloc(s, 1024, 1);

SynthDef(\bufferSinOsc, {
  |bufnum = 0, freq = 440, amp = 0.5, out = 0|
  var sample, osc;
  sample = BufRd.kr(1, bufnum, 0);
  osc = SinOsc.ar(sample, 0, amp);
  Out.ar(out, osc);
}).add;