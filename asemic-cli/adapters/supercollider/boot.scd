// asemic supercollider stub: brain sends OSC to sclang (57120), sclang replies to brain (57130).
(
var brain = NetAddr("127.0.0.1", 57130);
s.waitForBoot {
    // Compiled SynthDef (filtered saw, cutoff tracks freq) replaces the bare SinOsc oscillator;
    // the running Synth's own .set keeps the existing `/set/<name>` OSC router (freq/amp + new
    // cutoff/res) working unchanged.
    var voice;
    SynthDef(\asemicVoice, { |freq = 220, amp = 0.1, cutoff = 1200, res = 0.3, out = 0|
        var sig = Saw.ar(freq.lag(0.05));
        sig = RLPF.ar(sig, cutoff.lag(0.05).clip(20, 18000), res.clip(0.05, 1.0));
        Out.ar(out, (sig * amp.lag(0.05)) ! 2);
    }).add;

    s.sync;
    voice = Synth(\asemicVoice);

    // Buffer registry for multiarray data: ~asemic_buffers[bufKey] = Buffer
    ~asemic_buffers = Dictionary.new;
    // Multiarray points registry: ~asemic_points[key] = Array of dictionaries / points
    ~asemic_points = Dictionary.new;

    // asemic/out/supercollider/set/<name> = value
    // sc() rows (asemic_py/namespace.py):
    //   /def [id, code] = Ndef(id, code.interpret)
    //   /tdef [id, code] = Tdef(id, code.interpret).play
    //   /bdef [id, key, flat_data_json_or_array] = allocate / update Buffer
    //   /pdef [id, key, flat_data_json_or_array] = set sequence points array
    //   /map [dst_id, param, src_id] = Ndef(dst_id).map(param, Ndef(src_id))
    //   /nset [id, param, value]; free [id]
    thisProcess.addOSCRecvFunc({ |msg|
        var path = msg[0].asString, fn;
        case
        { path.beginsWith("/set/") } { voice.set(path.drop(5).asSymbol, msg[1]) }
        { path == "/def" } {
            fn = msg[2].asString.interpret;
            if(fn.isNil) { brain.sendMsg("/error", msg[1], "code did not compile") } {
                Ndef(msg[1].asSymbol).fadeTime_(0.5);
                Ndef(msg[1].asSymbol, fn).play;
                brain.sendMsg("/playing", msg[1]);
            }
        }
        { path == "/tdef" } {
            fn = msg[2].asString.interpret;
            if(fn.isNil) { brain.sendMsg("/error", msg[1], "tdef code did not compile") } {
                var wrapped = { |ev|
                    var id = msg[1].asSymbol;
                    var pts = ~asemic_points[id] ? ~asemic_points[(id ++ "_buf").asSymbol] ? [];
                    // Event dictionary with hook points: onset, offset, note
                    if(fn.isKindOf(Dictionary)) {
                        var stream = Pseq(pts, inf).asStream;
                        var note, target;
                        target = fn[\target];
                        while { (note = stream.next(())).notNil } {
                            if(fn[\onset].notNil) {
                                fn[\onset].value(note);
                            } {
                                if(target.notNil) {
                                    Ndef(target).set(\notePitch, note[\pitch], \noteDur, note[\dur], \trig, 1);
                                };
                            };
                            (note[\dur] ? 0.25).wait;
                            if(fn[\offset].notNil) {
                                fn[\offset].value(note);
                            };
                        };
                    } {
                        // Function style: single arg = per-note callback, multi arg = raw stream
                        if(fn.def.argNames.size == 1) {
                            var stream = Pseq(pts, inf).asStream;
                            var note;
                            while { (note = stream.next(())).notNil } {
                                fn.value(note);
                                (note[\dur] ? 0.25).wait;
                            };
                        } {
                            fn.value(pts, ev);
                        };
                    };
                };
                Tdef(msg[1].asSymbol, wrapped).play;
                brain.sendMsg("/playing", msg[1]);
            }
        }
        { path == "/pdef" } {
            var id = msg[1].asSymbol;
            var key = msg[2].asSymbol;
            var fullKey = (id ++ "_" ++ key).asSymbol;
            var raw = msg[3].asString;
            var data = raw.interpret;
            if(data.isNil) {
                data = raw.split($,).collect({ |s| s.stripWhiteSpace.asFloat });
            };
            if(data.notNil and: { data.isArray }) {
                var flat = data.flat;
                var pts = [];
                // Multiarrays have 5 dims [x, y, pitch, dur, vel], 4 dims [x, y, pitch, dur] or 2 dims [dur, pitch]
                if(flat.size >= 5 and: { (flat.size % 5) == 0 }) {
                    (flat.size / 5).do({ |i|
                        pts = pts.add((pitch: flat[i * 5 + 2], dur: flat[i * 5 + 3], vel: flat[i * 5 + 4]));
                    });
                } {
                    if(flat.size >= 4 and: { (flat.size % 4) == 0 }) {
                        (flat.size / 4).do({ |i|
                            pts = pts.add((pitch: flat[i * 4 + 2], dur: flat[i * 4 + 3]));
                        });
                    } {
                        if(flat.size >= 2 and: { (flat.size % 2) == 0 }) {
                            (flat.size / 2).do({ |i|
                                pts = pts.add((dur: flat[i * 2], pitch: flat[i * 2 + 1]));
                            });
                        };
                    };
                };
                ~asemic_points[fullKey] = pts;
                ~asemic_points[key] = pts;
                brain.sendMsg("/pts_ready", msg[1], msg[2], pts.size);
            };
        }
        { path == "/bdef" } {
            var id = msg[1].asSymbol;
            var key = msg[2].asSymbol;
            var fullKey = (id ++ "_" ++ key).asSymbol;
            var raw = msg[3].asString;
            var data = raw.interpret;
            if(data.isNil) {
                // Try parsing numbers if space/comma separated
                data = raw.split($,).collect({ |s| s.stripWhiteSpace.asFloat });
            };
            if(data.notNil and: { data.isArray }) {
                var flat = data.flat.as(FloatArray);
                var buf = ~asemic_buffers[fullKey];
                if(buf.isNil or: { buf.numFrames != flat.size }) {
                    buf.free;
                    buf = Buffer.loadCollection(s, flat, action: { |b|
                        ~asemic_buffers[fullKey] = b;
                        // auto-set control on Ndef if it exists
                        Ndef(id).set(key, b.bufnum);
                        brain.sendMsg("/buf_ready", msg[1], msg[2], b.bufnum);
                    });
                } {
                    buf.sendCollection(flat, action: { |b|
                        Ndef(id).set(key, b.bufnum);
                        brain.sendMsg("/buf_ready", msg[1], msg[2], b.bufnum);
                    });
                };
            };
        }
        { path == "/map" } {
            var dst = msg[1].asSymbol;
            var param = msg[2].asSymbol;
            var src = msg[3].asSymbol;
            Ndef(dst).map(param, Ndef(src));
        }
        { path == "/nset" } { Ndef(msg[1].asSymbol).set(msg[2].asSymbol, msg[3]) }
        { path == "/free" } {
            Ndef(msg[1].asSymbol).end(0.5);
            Tdef(msg[1].asSymbol).stop;
        };
    });
    brain.sendMsg("/ready", 1);
};
)
