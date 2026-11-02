"""Minimal PTY terminal widget: pyte does the VT100 emulation, we just glue its screen into a
Textual `Widget`, following pyte's own reference integration
(https://github.com/selectel/pyte/blob/master/examples/terminal_emulator.py, adapted for
Textual 8.2.8's current Widget/render API — the upstream example targets Textual >=0.6 and its
`PyteDisplay.__rich_console__` constructor pattern, key names and asyncio wiring are stale).

Used to embed the real `orca` TUI (orca-c) inline under an orca row (plan: asemic-tui-block-repl,
§3). No hand-rolled terminal emulator: pyte parses the VT100 stream; this module only reads the
PTY, feeds pyte, and renders its screen.
"""

from __future__ import annotations

import asyncio
import fcntl
import os
import pty
import struct
import termios

import pyte
from rich.text import Text
from textual import events
from textual.message import Message
from textual.widget import Widget
import contextlib

# Textual key name -> escape sequence, for keys that don't arrive as `event.character`.
_CTRL_KEYS = {
    "left": "\x1b[D",
    "right": "\x1b[C",
    "up": "\x1b[A",
    "down": "\x1b[B",
    "home": "\x1b[H",
    "end": "\x1b[F",
    "delete": "\x1b[3~",
    "enter": "\r",
    "tab": "\t",
    "backspace": "\x7f",
    "escape": "\x1b",
}


class _PyteDisplay:
    """Rich renderable: the lines pyte's screen currently holds."""

    def __init__(self, lines: list[Text]) -> None:
        self.lines = lines

    def __rich_console__(self, console, options):
        yield from self.lines


class PtyTerminal(Widget, can_focus=True):
    """Runs `command` under a PTY, feeds its output through pyte, renders the resulting screen.

    Posts `PtyTerminal.Exited` when the child process ends (EOF on the PTY). The caller is
    responsible for unmounting and for anything that needs to happen on exit (e.g. re-reading a
    file the child wrote).
    """

    DEFAULT_CSS = "PtyTerminal { height: auto; }"

    class Exited(Message):
        def __init__(self, terminal: "PtyTerminal") -> None:
            self.terminal = terminal
            super().__init__()

    def __init__(self, command: list[str], ncol: int, nrow: int, cwd: str | None = None,
                 **kw) -> None:
        super().__init__(**kw)
        self.command = command
        self.ncol, self.nrow = ncol, nrow
        self.cwd = cwd
        self._screen = pyte.Screen(ncol, nrow)
        self._stream = pyte.Stream(self._screen)
        self._display: _PyteDisplay = _PyteDisplay([Text()])
        self._fd: int | None = None
        self._p_out = None
        self._pid: int | None = None

    def render(self):
        return self._display

    def on_mount(self) -> None:
        self._pid, self._fd = pty.fork()
        if self._pid == 0:  # child
            if self.cwd:
                os.chdir(self.cwd)
            env = dict(os.environ, TERM="xterm-256color", COLUMNS=str(self.ncol), LINES=str(self.nrow))
            os.execvpe(self.command[0], self.command, env)
        winsize = struct.pack("HH", self.nrow, self.ncol)
        fcntl.ioctl(self._fd, termios.TIOCSWINSZ, winsize)
        self._p_out = os.fdopen(self._fd, "w+b", 0)
        loop = asyncio.get_running_loop()
        loop.add_reader(self._fd, self._on_readable)
        self.focus()

    def on_unmount(self) -> None:
        self._stop_reading()
        if self._pid is not None:
            try:
                os.kill(self._pid, 15)  # SIGTERM; orca also exits cleanly on EOF of its PTY
            except ProcessLookupError:
                pass
            self._pid = None

    def _stop_reading(self) -> None:
        if self._fd is not None:
            with contextlib.suppress(RuntimeError, ValueError):
                asyncio.get_running_loop().remove_reader(self._fd)
            with contextlib.suppress(OSError):
                self._p_out.close()
            self._fd = None

    def _on_readable(self) -> None:
        try:
            data = self._p_out.read(65536)
        except OSError:
            data = None
        if not data:  # EOF: child exited
            self._stop_reading()
            self.post_message(self.Exited(self))
            return
        self._stream.feed(data.decode(errors="replace"))
        lines = []
        for i, line in enumerate(self._screen.display):
            text = Text.from_ansi(line)
            x = self._screen.cursor.x
            if i == self._screen.cursor.y and x < len(text):
                cursor = text[x : x + 1]
                cursor.stylize("reverse")
                text = text[:x] + cursor + text[x + 1 :]
            lines.append(text)
        self._display = _PyteDisplay(lines)
        self.refresh()

    async def on_key(self, event: events.Key) -> None:
        # Textual's App has a priority `ctrl+q` binding (quit) that intercepts the key before it
        # ever reaches a focused widget's on_key; the host app must suppress that binding (e.g.
        # via `check_action`) while this widget is active, or orca's own ctrl+q never arrives here.
        event.stop()
        if self._fd is None:
            return
        data = _CTRL_KEYS.get(event.key)
        if data is None and event.key.startswith("ctrl+") and len(event.key) == 6:
            letter = event.key[5]
            if "a" <= letter <= "z":
                data = chr(ord(letter) - 96)  # ctrl+a..ctrl+z -> \x01..\x1a
        if data is None:
            data = event.character
        if data:
            os.write(self._fd, data.encode())
