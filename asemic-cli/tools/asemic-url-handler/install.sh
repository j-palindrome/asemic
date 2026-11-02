#!/usr/bin/env bash
# Installs the ALREADY-BUILT AsemicURLHandler.app (run build.sh first) to ~/Applications and
# registers it with LaunchServices as the asemic:// handler. This changes system state (what
# opens asemic:// links machine-wide) -- run it yourself; it is never invoked automatically.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
APP="$REPO_ROOT/build/asemic-url-handler/AsemicURLHandler.app"
DEST="$HOME/Applications/AsemicURLHandler.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"

if [ ! -d "$APP" ]; then
  echo "not built yet -- run build.sh first ($APP missing)" >&2
  exit 1
fi

mkdir -p "$HOME/Applications"
rm -rf "$DEST"
cp -R "$APP" "$DEST"

# Register (and open once -- the surest way LaunchServices actually picks up a new
# CFBundleURLSchemes claim is a first launch, per multiple reports in the sources build.sh
# cites). LSUIElement keeps this launch invisible (no Dock icon).
"$LSREGISTER" -f "$DEST"
open "$DEST"

echo "installed: $DEST"
echo "test with: open 'asemic://open?file=$REPO_ROOT/examples/startup.py&label=main'"
echo "log: /tmp/asemic-jump.log"
