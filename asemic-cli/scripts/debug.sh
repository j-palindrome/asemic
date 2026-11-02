#!/usr/bin/env bash
# Launches the asemic Textual REPL under devtools inside a tmux session, with a
# live `textual console` window tee'd to a log file, for agent-driven debugging.
#
# Usage: scripts/debug.sh [-d] [-k] [-h] [-- <asemic args>]
#   -d   detached: don't attach to the tmux session after setup (for agent use)
#   -k   kill existing session first (default behavior already recreates it)
#   -h   show this help
#
# Windows:
#   0 "app"     - TEXTUAL=devtools,debug .venv/bin/asemic (remain-on-exit on)
#   1 "console" - .venv/bin/textual console -v | tee .debug/textual-console.log
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="asemic-debug"
DETACH=0

usage() {
	grep '^#' "${BASH_SOURCE[0]}" | sed 's/^#//' | sed '1d'
}

while getopts ":dkh" opt; do
	case "$opt" in
		d) DETACH=1 ;;
		k) ;; # recreate is already the default; kept for explicitness
		h) usage; exit 0 ;;
		*) usage; exit 1 ;;
	esac
done
shift $((OPTIND - 1))

if ! command -v tmux >/dev/null 2>&1; then
	echo "error: tmux not found on PATH" >&2
	exit 1
fi

mkdir -p "$ROOT/.debug"
LOG="$ROOT/.debug/textual-console.log"

GITIGNORE="$ROOT/.gitignore"
if [ -f "$GITIGNORE" ]; then
	grep -qxF '.debug/' "$GITIGNORE" || echo '.debug/' >> "$GITIGNORE"
else
	echo '.debug/' > "$GITIGNORE"
fi

# Kill & recreate if the session already exists.
if tmux has-session -t "$SESSION" 2>/dev/null; then
	tmux kill-session -t "$SESSION"
fi

tmux new-session -d -s "$SESSION" -x 200 -y 60 -n console
tmux send-keys -t "$SESSION:console" \
	"cd '$ROOT' && .venv/bin/textual console -v 2>&1 | tee '$LOG'" C-m

# Wait (max ~5s) for the devtools console server to start listening.
for _ in $(seq 1 25); do
	if nc -z localhost 8081 2>/dev/null; then
		break
	fi
	sleep 0.2
done

tmux new-window -t "$SESSION" -n app
tmux set-option -t "$SESSION:app" remain-on-exit on
tmux send-keys -t "$SESSION:app" \
	"cd '$ROOT' && TEXTUAL=devtools,debug .venv/bin/asemic $*" C-m

echo "tmux session: $SESSION"
echo "console log:  $LOG"
echo
echo "Inspect without attaching:"
echo "  tmux capture-pane -pt $SESSION:app"
echo "  tmux capture-pane -pt $SESSION:console"
echo "Send keys to the app:"
echo "  tmux send-keys -t $SESSION:app '<keys>' C-m"
echo "Tear down:"
echo "  tmux kill-session -t $SESSION"

if [ "$DETACH" -eq 0 ]; then
	tmux attach -t "$SESSION:app"
fi
