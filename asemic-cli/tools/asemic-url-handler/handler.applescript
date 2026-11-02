-- AsemicURLHandler: a minimal macOS app bundle whose only job is to register for the
-- asemic:// scheme and forward whatever URL it's given to jump.py (`asemic_py/jump.py`),
-- which does the actual work (find the running REPL / spawn a fresh one). See build.sh's
-- comment block for why an AppleScript applet (osacompile), not a Swift app.
--
-- `on open location` is the event macOS sends a registered scheme handler when something
-- (Ghostty's OSC 8 link, `open "asemic://..."`, etc.) opens a URL in that scheme -- see
-- stackoverflow.com/questions/68872304 and gist.github.com/pegakmupyem/622bb88ee5e571ab71a064071932ccf6.
--
-- REPO_ROOT is baked in at build time (handler.applescript lives at
-- <repo>/tools/asemic-url-handler/, so this is just that path, hardcoded rather than
-- computed, since a compiled .app has no reliable way to find "the asemic-cli checkout"
-- on its own -- there's exactly one, and it doesn't move without this file moving too).
property REPO_ROOT : "/Users/jpalindrome/jVault/Projects/Asemic/asemic-cli"
property LOG_FILE : "/tmp/asemic-jump.log"

on open location this_URL
	my dispatch(this_URL)
end open location

-- Also handle a plain double-click/launch (no URL) by doing nothing visible -- LSUIElement
-- (set by build.sh) already keeps this out of the Dock/app-switcher; this is just the no-op
-- `run` handler osacompile expects an applet to have.
on run
end run

on dispatch(this_URL)
	set shellCmd to "cd " & quoted form of REPO_ROOT & ¬
		" && uv run python -m asemic_py.jump " & quoted form of this_URL & ¬
		" >> " & quoted form of LOG_FILE & " 2>&1"
	try
		do shell script shellCmd
	on error errMsg
		do shell script "echo " & quoted form of ("AsemicURLHandler: " & errMsg) & " >> " & quoted form of LOG_FILE
	end try
end dispatch
