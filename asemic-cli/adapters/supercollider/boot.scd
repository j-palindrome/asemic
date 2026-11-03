// asemic supercollider stub: brain sends OSC to sclang (57120), sclang replies to brain (57130).
(
var brain = NetAddr("127.0.0.1", 57130);
s.options.numInputBusChannels = 0;
s.waitForBoot {
    // Compile SynthDef for legacy /set/<name> control; do not run an un-gated Synth on boot
    SynthDef(\asemicVoice, { |freq = 220, amp = 0.1, cutoff = 1200, res = 0.3, out = 0|
        var sig = Saw.ar(freq.lag(0.05));
        sig = RLPF.ar(sig, cutoff.lag(0.05).clip(20, 18000), res.clip(0.05, 1.0));
        Out.ar(out, (sig * amp.lag(0.05)) ! 2);
    }).add;

    s.sync;

    // Buffer registry for multiarray data: ~asemic_buffers[bufKey] = Buffer
    ~asemic_buffers = Dictionary.new;
    // Multiarray points registry: ~asemic_points[key] = Array of dictionaries / points
    ~asemic_points = Dictionary.new;
    // Multiarray chunk assembly staging
    ~asemic_chunks = Dictionary.new;
    // Conditions for waiting Tdefs
    ~asemic_conds = Dictionary.new;
    // Node readiness tracking: ~asemic_node_ready[id] = Boolean
    ~asemic_node_ready = Dictionary.new;
    // Conditions for nodes waiting to become ready: ~asemic_node_conds[id] = Condition
    ~asemic_node_conds = Dictionary.new;

    ~updateBuffer = { |fullKey, id, key, flat, msg1, msg2|
        var buf = ~asemic_buffers[fullKey];
        if(buf.isNil or: { buf.numFrames != flat.size }) {
            buf.free;
            buf = Buffer.loadCollection(s, flat, action: { |b|
                ~asemic_buffers[fullKey] = b;
                Ndef(id).set(key, b.bufnum);
                brain.sendMsg("/buf_ready", msg1, msg2, b.bufnum);
            });
        } {
            buf.sendCollection(flat, action: { |b|
                Ndef(id).set(key, b.bufnum);
                brain.sendMsg("/buf_ready", msg1, msg2, b.bufnum);
            });
        };
    };

    ~getNodeCond = { |sym|
        var cond = ~asemic_node_conds[sym];
        if(cond.isNil) {
            cond = Condition({ ~asemic_node_ready[sym] == true });
            ~asemic_node_conds[sym] = cond;
        } {
            cond.test = { ~asemic_node_ready[sym] == true };
        };
        cond;
    };

    ~playNdef = { |sym, idStr|
        var cond = ~getNodeCond.value(sym);
        Ndef(sym).fadeTime_(0.0);
        Ndef(sym).resume;
        if(Ndef(sym).isMonitoring.not) {
            Ndef(sym).play;
        };
        fork {
            s.sync;
            ~asemic_node_ready[sym] = true;
            cond.signal;
            brain.sendMsg("/node_ready", idStr ? sym.asString, Ndef(sym).isPlaying.asInteger, Ndef(sym).isMonitoring.asInteger);
            brain.sendMsg("/playing", idStr ? sym.asString);
        };
    };

    ~commitPoints = { |fullKey, id, key, pts, msg1, msg2|
        ~asemic_points[fullKey] = pts;
        ~asemic_points[id] = pts;
        brain.sendMsg("/pts_ready", msg1, msg2, pts.size);
        if(~asemic_conds[id].notNil) {
            ~asemic_conds[id].unhang;
        };
        if(Tdef(id).notNil and: { pts.notEmpty and: { Tdef(id).isPlaying.not } }) {
            Tdef(id).quant = 0;
            Tdef(id).play(quant: 0);
            brain.sendMsg("/playing", msg1);
        };
    };

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
        { path.beginsWith("/set/") } {
            if(~asemic_voice.isNil) { ~asemic_voice = Synth(\asemicVoice) };
            ~asemic_voice.set(path.drop(5).asSymbol, msg[1]);
        }
        { path == "/status" } {
            s.serverRunning.if({
                brain.sendMsg("/status_reply", s.numSynths, s.numGroups, s.avgCPU, Ndef.all.size);
            }, {
                brain.sendMsg("/status_reply", 0, 0, 0.0, 0);
            });
        }
        { path == "/inspect_bus" } {
            var id = msg[1].asSymbol;
            var ndef = Ndef(id);
            if(ndef.notNil and: { ndef.bus.notNil }) {
                var bus = ndef.bus;
                var rate = ndef.rate;
                var isMon = ndef.isMonitoring;
                var ch = ndef.numChannels;
                if(rate == \control) {
                    bus.getn(bus.numChannels, { |vals|
                        brain.sendMsg("/bus_reply", msg[1], rate.asString, ch, isMon.asInteger, vals.asString);
                    });
                } {
                    // Audio rate bus: capture 64 audio samples to a temporary buffer and read back float values
                    var sampleBuf = Buffer.alloc(s, 64, 1, { |b|
                        var synth = {
                            RecordBuf.ar(In.ar(bus.index, 1), b, loop: 0, doneAction: 2);
                        }.play(target: RootNode(s), addAction: \addToTail);
                        SystemClock.sched(0.05, {
                            b.loadToFloatArray(count: 64, action: { |arr|
                                var peak = arr.abs.maxItem.round(0.0001);
                                var sampleStr = arr.keep(8).round(0.0001).asString;
                                brain.sendMsg("/bus_reply", msg[1], rate.asString, ch, isMon.asInteger, peak, sampleStr);
                                b.free;
                            });
                            nil;
                        });
                    });
                };
            } {
                brain.sendMsg("/bus_reply", msg[1], "nil", 0, 0, "not found");
            };
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
                var sym = msg[1].asSymbol;
                ~asemic_node_ready[sym] = false;
                Ndef(sym, fn);
                ~playNdef.value(sym, msg[1].asString);
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
                            if(fn.isKindOf(Dictionary)) {
                                target = fn[\target];
                                if(target.notNil) {
                                    var tgtSym = target.asSymbol;
                                    var nodeCond = ~getNodeCond.value(tgtSym);
                                    if(Ndef(tgtSym).isMonitoring.not or: { ~asemic_node_ready[tgtSym] != true }) {
                                        if(Ndef(tgtSym).isMonitoring.not) {
                                            ~playNdef.value(tgtSym);
                                        };
                                        nodeCond.wait;
                                    };
                                };
                            };
                            stream = Pseq(pts, 1).asStream;
                            while { (note = stream.next(())).notNil } {
                                if(fn.isKindOf(Dictionary)) {
                                    target = fn[\target];
                                    if(fn[\onset].notNil) {
                                        fn[\onset].value(note);
                                    } {
                                        if(target.notNil) {
                                            ~step = (~step ? 0) + 1;
                                            Ndef(target).set(\notePitch, note[\pitch], \noteDur, note[\dur], \trig, ~step);
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
                        ~commitPoints.value(fullKey, id, key, pts, msg[1], msg[2]);
                    };
                } {
                    ~commitPoints.value(fullKey, id, key, pts, msg[1], msg[2]);
                };
            };
        }
        { path == "/bdef" } {
            var id = msg[1].asSymbol;
            var key = msg[2].asSymbol;
            var fullKey = (id ++ "_" ++ key).asSymbol;
            var raw = msg[3].asString;
            var chunkIdx = if(msg.size > 4) { msg[4].asInteger } { 0 };
            var totalChunks = if(msg.size > 5) { msg[5].asInteger } { 1 };
            var data = raw.interpret;
            if(data.isNil) {
                // Try parsing numbers if space/comma separated
                data = raw.split($,).collect({ |s| s.stripWhiteSpace.asFloat });
            };
            if(data.notNil and: { data.isArray }) {
                var flat = data.flat.as(FloatArray);
                if(totalChunks > 1) {
                    var bufChunks = ~asemic_chunks[(fullKey ++ "_b").asSymbol] ? Array.newClear(totalChunks);
                    bufChunks[chunkIdx] = flat;
                    ~asemic_chunks[(fullKey ++ "_b").asSymbol] = bufChunks;
                    if(bufChunks.every({ |c| c.notNil })) {
                        flat = bufChunks.flat.as(FloatArray);
                        ~asemic_chunks[(fullKey ++ "_b").asSymbol] = nil;
                        ~updateBuffer.value(fullKey, id, key, flat, msg[1], msg[2]);
                    };
                } {
                    ~updateBuffer.value(fullKey, id, key, flat, msg[1], msg[2]);
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
        { path == "/play" } {
            var sym = msg[1].asSymbol;
            var isTdef = Tdef.all.at(sym).notNil and: { Tdef.all.at(sym).source.notNil };
            if(isTdef) {
                Tdef(sym).quant = 0;
                Tdef(sym).play(quant: 0);
                brain.sendMsg("/playing", msg[1]);
            } {
                ~playNdef.value(sym, msg[1].asString);
            };
        }
        { path == "/stop" } {
            var sym = msg[1].asSymbol;
            var isTdef = Tdef.all.at(sym).notNil and: { Tdef.all.at(sym).source.notNil };
            if(isTdef) {
                Tdef(sym).stop;
            } {
                Ndef(sym).pause;
            };
        }
        { path == "/free" } {
            var sym = msg[1].asSymbol;
            ~asemic_node_ready[sym] = false;
            Ndef(sym).end(0.0);
            Tdef(sym).stop;
            brain.sendMsg("/node_ready", msg[1], 0, 0);
        };
    });
    brain.sendMsg("/ready", 1);
};
)
