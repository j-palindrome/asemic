#!/usr/bin/env bash
# Builds AsemicURLHandler.app -- a minimal AppleScript applet (osacompile) that registers
# CFBundleURLSchemes=asemic and forwards whatever URL macOS hands it to
# `python -m asemic_py.jump` (handler.applescript's `dispatch`). The AppleScript-applet
# route (over a Swift app) is the current standard recipe for a custom URL scheme handler
# that just needs to shell out -- confirmed 2026-10-11 against:
#   - https://stackoverflow.com/questions/68872304/how-to-configure-a-custom-scheme-handler-on-macos-from-command-line
#   - https://gist.github.com/pegakmupyem/622bb88ee5e571ab71a064071932ccf6
#   - https://www.macscripter.net/t/custom-url-scheme-fails-when-applet-is-running/72465
# all of which osacompile the applet, then add CFBundleURLTypes/CFBundleURLSchemes to its
# Info.plist with PlistBuddy (osacompile itself has no flag for a custom scheme).
#
# This script ONLY builds, into this repo's build/ dir. It never copies the .app anywhere
# LaunchServices scans (/Applications, ~/Applications) and never calls `open`,
# `lsregister`, or anything else that would register the scheme on this machine -- that's
# install.sh, a separate script J runs by hand (see README.md). Registering a URL scheme
# changes what macOS does when ANY app on J's machine opens an asemic:// link, so that step
# must be an explicit, manual choice.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
OUT_DIR="$REPO_ROOT/build/asemic-url-handler"
APP="$OUT_DIR/AsemicURLHandler.app"

mkdir -p "$OUT_DIR"
rm -rf "$APP"
osacompile -o "$APP" "$HERE/handler.applescript"

PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string com.asemic.url-handler" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string asemic" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST"  # no Dock icon/app-switcher entry
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.asemic.url-handler" "$PLIST" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.asemic.url-handler" "$PLIST"

echo "built: $APP"
echo "NOT installed/registered -- run install.sh by hand (see README.md) to do that."
