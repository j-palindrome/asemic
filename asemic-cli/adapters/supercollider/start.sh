#!/bin/sh
# Start sclang on the asemic language port, reaping a stale instance first.
#
# A cargo-watch rebuild or a SIGKILLed brain orphans the previous sclang: it is in its own
# process group, so nothing TERMs it, and it keeps UDP 57120 bound forever. The next sclang
# then binds 57121 while the brain keeps sending OSC to 57120 -- the zombie's server is gone,
# so `/def` parks every waiting Tdef (`s.sync` never completes) and blocks fall silent while
# their timestretch still reads 1.0.
#
# Only our own `boot.scd` instance is matched: a user's SuperCollider GUI is never touched.
port=57120
for pid in $(lsof -tiUDP:"$port" 2>/dev/null); do
    cmd=$(ps -p "$pid" -o command= 2>/dev/null) || continue
    case "$cmd" in
        *boot.scd*)
            echo "reaping stale sclang $pid holding udp/$port" >&2
            kill "$pid" 2>/dev/null
            sleep 0.3
            ;;
    esac
done

exec /Applications/SuperCollider.app/Contents/MacOS/sclang -u "$port" boot.scd
