# asemic:// URL handler

`handler.applescript` -> `osacompile` -> `AsemicURLHandler.app`, a tiny menu-less app whose
only job is to register for the `asemic://` scheme and forward whatever URL it gets to
`python -m asemic_py.jump` (`asemic_py/jump.py`), which finds a running REPL with that file
open and jumps it to the block, or starts a fresh REPL already zoomed there.

Build (safe, writes only under this repo's `build/`, installs/registers nothing):

```
tools/asemic-url-handler/build.sh
```

Install (changes system state -- run by hand, never automatically):

```
tools/asemic-url-handler/install.sh
```

What it does: copies the built `.app` to `~/Applications/`, then `lsregister -f` + one
`open` so LaunchServices actually picks up the new `CFBundleURLSchemes` claim (a cold
registration-only add isn't reliably enough on its own, per the sources `build.sh` cites).
The first time anything opens an `asemic://` link afterward, macOS may prompt once to
confirm handling an app you haven't run before -- expected, same prompt any new scheme
handler gets.

Test:

```
open "asemic://open?file=/absolute/path/to/doc.py&label=main"
```

Check `/tmp/asemic-jump.log` if nothing seems to happen.

Uninstall: delete `~/Applications/AsemicURLHandler.app`, then
`lsregister -u ~/Applications/AsemicURLHandler.app` (same `lsregister` path as in
`install.sh`) if another app should take over the scheme.
