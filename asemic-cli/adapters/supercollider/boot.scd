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
    // Multiarray chunk assembly staging
    ~asemic_chunks = Dictionary.new;
    // Conditions for waiting Tdefs
    ~asemic_conds = Dictionary.new;

    // asemic/out/supercollider/set/<name> = value
    // sc() rows (asemic_py/namespace.py):
    //   /def [id, code] = Ndef(id, code.interpret)
    //   /tdef [id, code] = Tdef(id, code.interpret).play
    //   /bdef [id, key, flat_data_json_or_array] = allocate / update Buffer
    //   /pdef [id, key, flat_data_json_or_array, chunk_idx, total_chunks] = set sequence points array
    //   /map [dst_id, param, src_id] = Ndef(dst_id).map(param, Ndef(src_id))
    //   /nset [id, param, value]; free [id]
    // Debug & Inspection OSC handlers:
    //   /status = sends /status_reply [numSynths, numGroups, cpu, isPlaying]
    //   /inspect_buffer [bufKey] = loads buffer contents and replies with /buffer_data [bufKey, size, sample_vals]
    //   /inspect_points [key] = replies with /points_data [key, count, sample_pts_json]
    thisProcess.addOSCRecvFunc({ |msg|
        var path = msg[0].asString, fn;
        case
        { path.beginsWith("/set/") } { voice.set(path.drop(5).asSymbol, msg[1]) }
        { path == "/status" } {
            s.serverRunning.if({
                brain.sendMsg("/status_reply", s.numSynths, s.numGroups, s.avgCPU, Ndef.all.size);
            }, {
                brain.sendMsg("/status_reply", 0, 0, 0.0, 0);
            });
        }
        { path == "/dump_tree" } {
            var ndefList = Ndef.all.keys.asArray.asString;
            var tdefList = Tdef.all.keys.asArray.asString;
            var ptsCount = ~asemic_points.size;
            var bufCount = ~asemic_buffers.size;
            brain.sendMsg("/tree_reply", ndefList, tdefList, ptsCount, bufCount);
        }
        { path == "/inspect_buffer" } {
            var key = msg[1].asSymbol;
            var buf = ~asemic_buffers[key];
            if(buf.notNil) {
                buf.loadToFloatArray(action: { |arr|
                    var sample = arr.keep(10).asString;
                    brain.sendMsg("/buffer_data", msg[1], arr.size, sample);
                });
            } {
                brain.sendMsg("/buffer_data", msg[1], 0, "nil");
            };
        }
        { path == "/inspect_points" } {
            var key = msg[1].asSymbol;
            var pts = ~asemic_points[key] ? [];
            var preview = pts.keep(5).collect({ |p| [p[\pitch], p[\dur]] }).asString;
            brain.sendMsg("/points_data", msg[1], pts.size, preview);
        }
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
                var id = msg[1].asSymbol;
                var cond = ~asemic_conds[id] ? Condition.new;
                var wrapped;
                ~asemic_conds[id] = cond;
                wrapped = { |ev|
                    var stream, note, target, pts;
                    loop {
                        pts = ~asemic_points[id] ? ~asemic_points[(id ++ "_buf").asSymbol] ? [];
                        if(pts.notEmpty) {
                            stream = Pseq(pts, 1).asStream;
                            while { (note = stream.next(())).notNil } {
                                if(fn.isKindOf(Dictionary)) {
                                    target = fn[\target];
                                    if(fn[\onset].notNil) {
                                        fn[\onset].value(note);
                                    } {
                                        if(target.notNil) {
                                            Ndef(target).set(\notePitch, note[\pitch], \noteDur, note[\dur], \t_trig, 1, \trig, 1);
                                        };
                                    };
                                    (note[\dur] ? 0.25).wait;
                                    if(fn[\offset].notNil) {
                                        fn[\offset].value(note);
                                    };
                                } {
                                    if(fn.def.argNames.size == 1) {
                                        fn.value(note);
                                        (note[\dur] ? 0.25).wait;
                                    } {
                                        fn.value(pts, ev);
                                        (pts.first ? (dur: 0.25))[\dur].wait;
                                    };
                                };
                            };
                        } {
                            cond.wait;
                        };
                    };
                };
                Tdef(id, wrapped);
                Tdef(id).quant = 0;
                Tdef(id).play(quant: 0);
                brain.sendMsg("/playing", msg[1]);
            }
        }
        { path == "/pdef" } {
            var id = msg[1].asSymbol;
            var key = msg[2].asSymbol;
            var fullKey = (id ++ "_" ++ key).asSymbol;
            var raw = msg[3].asString;
            var chunkIdx = if(msg.size > 4) { msg[4].asInteger } { 0 };
            var totalChunks = if(msg.size > 5) { msg[5].asInteger } { 1 };
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
                if(totalChunks > 1) {
                    var chunkList = ~asemic_chunks[fullKey] ? Array.newClear(totalChunks);
                    chunkList[chunkIdx] = pts;
                    ~asemic_chunks[fullKey] = chunkList;
                    // If all chunks assembled, commit to ~asemic_points
                    if(chunkList.every({ |c| c.notNil })) {
                        pts = chunkList.flat;
                        ~asemic_chunks[fullKey] = nil;
                        ~asemic_points[fullKey] = pts;
                        ~asemic_points[key] = pts;
                        ~asemic_points[id] = pts;
                        brain.sendMsg("/pts_ready", msg[1], msg[2], pts.size);
                        if(~asemic_conds[id].notNil) {
                            ~asemic_conds[id].unhang;
                        };
                        if(Tdef(id).notNil and: { pts.notEmpty and: { Tdef(id).isPlaying.not } }) {
                            Tdef(id).quant = 0;
                            Tdef(id).play(quant: 0);
                            brain.sendMsg("/playing", msg[1]);
                        };
                    };
                } {
                    ~asemic_points[fullKey] = pts;
                    ~asemic_points[key] = pts;
                    ~asemic_points[id] = pts;
                    brain.sendMsg("/pts_ready", msg[1], msg[2], pts.size);
                    if(~asemic_conds[id].notNil) {
                        ~asemic_conds[id].unhang;
                    };
                    if(Tdef(id).notNil and: { pts.notEmpty and: { Tdef(id).isPlaying.not } }) {
                        Tdef(id).quant = 0;
                        Tdef(id).play(quant: 0);
                        brain.sendMsg("/playing", msg[1]);
                    };
                };
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
