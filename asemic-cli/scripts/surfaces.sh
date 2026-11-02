#!/usr/bin/env bash
# Runs tests/test_debug_surfaces.py (opt-in: ASEMIC_SURFACES=1) and lists the artifacts it
# produced -- tests/artifacts/<example>/{tui.svg,frame.png}. Needs zenohd + asemic-brain up
# for the frame half (rig.ensure() will start them if not); skips that half cleanly without.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ASEMIC_SURFACES=1 uv run pytest tests/test_debug_surfaces.py -m surfaces -v "$@"

echo
echo "artifacts:"
find tests/artifacts -maxdepth 2 \( -name tui.svg -o -name frame.png \) | sort
