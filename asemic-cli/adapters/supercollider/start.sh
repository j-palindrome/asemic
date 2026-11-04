#!/bin/sh
# Start sclang on the asemic language port, verifying the audio ports are clear first.
#
# A cargo-watch rebuild or a SIGKILLed brain orphans sclang: it is in its own process group,
# so nothing TERMs it, and it keeps UDP 57120 bound forever. Its scsynth is orphaned with it
# and keeps UDP 57110. The next sclang then binds 57121 (or fails to boot a server) while the
# brain keeps sending OSC to 57120 -- the zombie's server is gone, so `/def` parks every
# waiting Tdef (`s.sync` never completes) and blocks fall silent while their timestretch
# still reads 1.0.
#
# This runs on every adapter cold start and only ever reaps asemic's own processes:
#   - 57120: a process whose command line carries our `boot.scd`
#   - 57110: a scsynth orphaned to init (ppid 1); a SuperCollider GUI's server has a live parent
# Anything else still holding the ports is reported and the start fails loudly, rather than
# leaving the brain talking to a stranger.
set -u

sclang=/Applications/SuperCollider.app/Contents/MacOS/sclang
port=57120
server_port=57110

port_holders() { lsof -tiUDP:"$1" 2>/dev/null; }

# 1. Reap the previous run's sclang (identified by our own boot.scd in its command line).
for pid in $(port_holders "$port"); do
    cmd=$(ps -p "$pid" -o command= 2>/dev/null) || continue
    case "$cmd" in
        *boot.scd*)
            echo "supercollider: reaping stale sclang $pid holding udp/$port" >&2
            kill "$pid" 2>/dev/null
            sleep 0.3
            ;;
    esac
done

# 2. Reap a scsynth left orphaned to init by a dead parent.
for pid in $(port_holders "$server_port"); do
    cmd=$(ps -p "$pid" -o command= 2>/dev/null) || continue
    ppid=$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ')
    case "$cmd" in
        *scsynth*)
            if [ "${ppid:-0}" = "1" ]; then
                echo "supercollider: reaping orphaned scsynth $pid holding udp/$server_port" >&2
                kill "$pid" 2>/dev/null
                sleep 0.3
            fi
            ;;
    esac
done

# 3. Verify the language port is actually free; a foreign holder is a real conflict we must
#    not silently work around (a second sclang would answer on 57121 and hear nothing).
if held=$(port_holders "$port"); then
    for pid in $held; do
        cmd=$(ps -p "$pid" -o command= 2>/dev/null) || continue
        echo "supercollider: udp/$port still held by pid $pid: $cmd" >&2
        echo "supercollider: refusing to start a second sclang on a different port" >&2
        exit 1
    done
fi

exec "$sclang" -u "$port" boot.scd
