"""Block tree over .py (pure; no zenoh)."""

from asemic_py.blocks import Doc, from_labels
from asemic_py.orca_literal import grid_from_src, is_orca_row, replace_grid

SRC = '''# top comment
x = 1  # trailing

with block("voice"):  # v
    # loud
    amp(0.4)
    with block("env"):
        attack(0.1)
        release(
            0.5,
        )

y = 2
'''


def test_roundtrip_lossless():
    assert Doc(SRC).code == SRC


def test_rows_and_nesting():
    d = Doc(SRC)
    top = d.rows()
    assert [r.name for r in top] == [None, "voice", None]
    assert top[0].src == "x = 1  # trailing"
    assert top[1].src == 'with block("voice"):  # v' and top[1].n_children == 2
    voice = d.rows((1,))
    assert voice[0].src == "amp(0.4)"
    assert voice[1].name == "env"
    env = d.rows((1, 1))
    assert env[1].src.startswith("release(")
    assert d.breadcrumb((1, 1, 0)) == ["voice", "env"]
    assert d.source((1, 1)).strip().startswith('with block("env"):')


def test_stage_commits_and_keeps_comments():
    written = []
    d = Doc(SRC, on_write=written.append)
    assert d.stage((1, 0), "amp(0.6)") is None
    assert "    # loud\n    amp(0.6)\n" in d.code
    assert written[-1] == d.code
    assert d.code == SRC.replace("amp(0.4)", "amp(0.6)")


def test_broken_edit_stays_in_draft(tmp_path):
    f = tmp_path / "s.py"
    f.write_text(SRC)
    d = Doc.load(f)
    err = d.stage((1, 0), "amp(0.6")
    assert err
    assert f.read_text() == SRC and d.code == SRC
    r = d.rows((1,))[0]
    assert r.draft == "amp(0.6" and r.error and r.src == "amp(0.4)"
    assert d.stage((1, 0), "amp(0.7)") is None
    assert "amp(0.7)" in f.read_text() and not d.drafts


def test_header_edit_keeps_body():
    d = Doc(SRC)
    assert d.stage((1,), 'with block("lead"):') is None
    assert d.rows()[1].name == "lead" and d.rows((1,))[0].src == "amp(0.4)"
    assert d.stage((1,), "if x:")  # not a block header -> draft


def test_insert_delete_shift_drafts():
    d = Doc(SRC)
    d.stage((1, 1, 0), "attack(")  # draft in env
    d.insert((1,), 0, "pan(0)")
    assert d.rows((1,))[0].src == "pan(0)"
    assert (1, 2, 0) in d.drafts
    d.delete((1, 0))
    assert (1, 1, 0) in d.drafts
    p = d.insert((1, 1), 2, 'with block("lfo"):')
    assert d.rows(p) == [] or d.rows(p)[0].src == "pass"
    assert Doc(d.code).code == d.code


# ---------------------------------------------------------------- column view (pilot, no zenoh)

from textual.app import App
from textual_vim_textarea import Mode

from asemic_py.columns import BlockColumns, SlashDropdown, slash_to_call


class _ColApp(App):
    def __init__(self, doc, commands=None):
        super().__init__()
        self.doc = doc
        self.commands = commands

    def compose(self):
        yield BlockColumns(self.doc, commands=self.commands)

    def on_mount(self):
        # these tests type row text straight away; the editor starts NORMAL (J 2026-10-11)
        self.query_one(BlockColumns).line.mode = Mode.INSERT


def test_slash_to_call():
    assert slash_to_call("/proc word glyph text=X") == (
        "proc",
        "proc('word', 'glyph', text='X')",
    )


async def test_slash_help_dispatches_local_command():
    d = Doc(SRC)
    app = _ColApp(d)
    seen = []
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        col.post_message = lambda msg: seen.append(msg) or BlockColumns.post_message(col, msg)
        await pilot.press("escape", *":help", "enter")
        assert any(isinstance(m, BlockColumns.Command) and m.name == "help" for m in seen)


async def test_slash_shows_dropdown_candidates():
    """`:` (NORMAL) opens the bottom `CmdBar`; `SlashDropdown` shows LOCAL_COMMANDS + brain verbs at once."""
    d = Doc(SRC)
    app = _ColApp(d)
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        await pilot.press("escape", ":")
        dd = col.query_one("#slash-dropdown", SlashDropdown)
        assert dd.has_class("shown")
        items = [dd.get_option_at_index(i).prompt.plain for i in range(dd.option_count)]
        assert any(":help" in text for text in items)


async def test_slash_dropdown_accept_fills_candidate():
    """Typing a prefix narrows the dropdown; Tab/Enter accepts the highlighted candidate into
    the cmd bar and closes the dropdown."""
    d = Doc(SRC)
    app = _ColApp(d)
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        await pilot.press("escape", *":hel")
        dd = col.query_one("#slash-dropdown", SlashDropdown)
        assert dd.has_class("shown")
        items = [dd.get_option_at_index(i).prompt.plain for i in range(dd.option_count)]
        assert all(":help" in text for text in items)  # prefix-filtered down to just /help
        await pilot.press("tab")
        assert col.query_one("#cmdbar").value == "help "
        assert not dd.has_class("shown")


async def test_slash_block_creates_and_enters_nest():
    d = Doc(SRC)
    app = _ColApp(d)
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        await pilot.press("escape", *":block lfo", "enter")
        assert col.doc.breadcrumb(col.parent_path)[-1] == "lfo"
        assert any(r.name == "lfo" for r in d.rows())


async def test_slash_unknown_leaves_doc_unchanged():
    d = Doc(SRC)
    app = _ColApp(d)
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        before = d.code
        await pilot.press("escape", *":nope", "enter")
        assert d.code == before


async def test_slash_brain_verb_commits_call():
    d = Doc(SRC)
    commands = [{"verb": "proc", "args": ["a"], "doc": ""}]
    app = _ColApp(d, commands=commands)
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        await pilot.press("escape", *":proc 1", "enter")
        assert "proc(1)" in d.code


async def test_columns_nav_edit():
    d = Doc(SRC)
    app = _ColApp(d)
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        assert col.line.text == "x = 1  # trailing"
        await pilot.press("down", "right")  # caret at end on block -> enter voice
        assert col.parent_path == (1,) and col.line.text == "amp(0.4)"
        assert "root › voice" in str(col.query_one("#crumb").render())
        await pilot.press("backspace", "backspace", "backspace", "backspace", *"0.6)", "enter")
        assert "amp(0.6)" in d.code
        await pilot.press("backspace", "down")  # broken -> draft, moves on
        assert d.drafts == {(1, 0): "amp(0.6"} and "amp(0.6)" in d.code
        await pilot.press("right")  # env
        assert col.parent_path == (1, 1)
        await pilot.press("home", "left", "home", "left")  # exit twice
        assert col.parent_path == () and col.cursor == 1
        await pilot.press("down", "down")  # new-row slot
        assert col.path is None
        await pilot.press(*"z = 3", "enter")
        assert d.code.endswith("z = 3\n") and col.path is None
        await pilot.press(*"bad(", "enter")
        assert col.new_draft == "bad(" and "bad(" not in d.code


async def test_breadcrumb_updates_on_zoom():
    """Single-panel nav (plan A, 2026-10-10): the whole-doc tree box is gone; the current
    position shows only as the `#crumb` breadcrumb line, next to the mode tag."""
    d = Doc(SRC)
    app = _ColApp(d)
    async with app.run_test(size=(60, 16)) as pilot:
        col = app.query_one(BlockColumns)
        assert "root" in str(col.query_one("#crumb").render())
        await pilot.press("down", "right")  # -> inside "voice"
        assert "root › voice" in str(col.query_one("#crumb").render())
        await pilot.press("home", "left")  # -> back out
        assert col.parent_path == () and col.cursor == 1  # cursor back on the "voice" row (index 1)


def test_sync_external_edit(tmp_path):
    f = tmp_path / "s.py"
    f.write_text(SRC)
    d = Doc.load(f)
    assert not d.sync()
    f.write_text(SRC.replace("y = 2", "y = 5"))
    assert d.sync() and d.rows()[2].src == "y = 5"
    f.write_text("oops(\n")  # external broken edit: keep tree, refuse writes
    assert d.sync() and d.file_error and d.rows()[2].src == "y = 5"
    assert d.stage((0,), "x = 9") and f.read_text() == "oops(\n"
    f.write_text(SRC)
    assert d.sync() and d.file_error is None and d.stage((0,), "x = 9") is None


async def test_columns_follow_file(tmp_path):
    f = tmp_path / "s.py"
    f.write_text(SRC)
    app = _ColApp(Doc.load(f))
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        f.write_text("a = 1\n" + SRC)
        await pilot.pause(0.4)
        assert col.rows[0].src == "a = 1" and col.line.text == "a = 1"


# ---------------------------------------------------------------- labels / legacy migration

def test_doc_label():
    d = Doc(SRC)
    assert d.label((0,)) == "main"  # root direct leaf
    assert d.label((1,)) == "voice"  # nest header itself
    assert d.label((1, 0)) == "voice"  # leaf inside it
    assert d.label((1, 1)) == "voice/env"  # nested nest header
    assert d.label((1, 1, 0)) == "voice/env"  # leaf inside nested nest


# ---------------------------------------------------------------- `/open` file nav + fuzzy slash

async def test_slash_fuzzy_match_hp_to_help():
    """Slash completion is fuzzy-scored (`textual.fuzzy.Matcher`), not prefix: `:hp` -> `:help`."""
    d = Doc(SRC)
    app = _ColApp(d)
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        await pilot.press("escape", *":hp")
        dd = col.query_one("#slash-dropdown", SlashDropdown)
        assert dd.has_class("shown")
        items = [dd.get_option_at_index(i).prompt.plain for i in range(dd.option_count)]
        assert any(":help" in text for text in items)


async def test_open_lists_and_filters_py_files():
    d = Doc(SRC)
    app = _ColApp(d)
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        await pilot.press("escape", *":open ")
        await pilot.pause(0.6)  # debounce timer + off-thread fzf worker
        dd = col.query_one("#slash-dropdown", SlashDropdown)
        assert dd.has_class("shown") and dd.option_count > 0
        ids = [dd.get_option_at_index(i).id for i in range(dd.option_count)]
        assert all(i.startswith("b:") or (i.startswith("f:") and i.endswith(".py")) for i in ids)
        await pilot.press(*"columns")
        await pilot.pause(0.6)
        ids = [dd.get_option_at_index(i).id for i in range(dd.option_count)]
        assert any("columns.py" in i for i in ids)


async def test_open_accept_loads_file(tmp_path):
    other = tmp_path / "other.py"
    other.write_text("q = 9\n")
    d = Doc(SRC)
    app = _ColApp(d)
    seen = []
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        col.post_message = lambda msg: seen.append(msg) or BlockColumns.post_message(col, msg)
        await pilot.press("escape", *f":open {other}", "enter")
        assert col.doc.path == other
        assert col.doc.code == "q = 9\n"
        assert any(isinstance(m, BlockColumns.FileOpened) for m in seen)


def test_from_labels_converts_flat_blocks():
    text = "x = 1\n# @a\nparam('p')\n\n# @b\nxy('q')\n"
    conv = from_labels(text)
    assert conv == 'x = 1\n\nwith block("a"):\n    param(\'p\')\n\nwith block("b"):\n    xy(\'q\')\n'
    d = Doc(conv)
    assert [r.name for r in d.rows()] == [None, "a", "b"]
    assert d.rows((1,))[0].src == "param('p')"
    assert d.label((1,)) == "a" and d.label((2,)) == "b"


def test_from_labels_no_main_prefix():
    assert from_labels("# @a\nfoo()\n") == 'with block("a"):\n    foo()\n'


def test_from_labels_noop_without_labels():
    assert from_labels("x = 1\ny = 2\n") == "x = 1\ny = 2\n"


def test_from_labels_result_is_idempotent():
    """Already-converted text has no `# @label` lines -> from_labels leaves it alone."""
    conv = from_labels("# @a\nfoo()\n")
    assert from_labels(conv) == conv


# ---------------------------------------------------------------- orca (§9.2): multi-line row

ORCA_SRC = 'x = 1\n\norca("""\n....\n.D1.\n....\n....\n""")\n\ny = 2\n'


def test_multiline_orca_row_is_lossless():
    d = Doc(ORCA_SRC)
    assert d.code == ORCA_SRC
    rows = d.rows()
    assert [r.name for r in rows] == [None, None, None]
    assert rows[1].src == 'orca("""\n....\n.D1.\n....\n....\n""")'


def test_row_label_shows_grid_dims():
    d = Doc(ORCA_SRC)
    assert BlockColumns._row_label(d.rows()[1]) == 'orca("""  ▦ 4x4'


def test_stage_multiline_orca_row(tmp_path):
    f = tmp_path / "s.py"
    f.write_text("a = 1\n")
    d = Doc.load(f)
    assert d.stage((0,), 'orca("""\n..\n..\n""")') is None
    assert f.read_text() == 'orca("""\n..\n..\n""")\n'
    assert d.rows()[0].src == 'orca("""\n..\n..\n""")'


# ---------------------------------------------------------------- orca literal <-> tmpfile (plan §3)

def test_grid_from_src_roundtrips_through_replace_grid():
    src = 'orca("""\n....\n.D1.\n....\n....\n""")'
    grid = grid_from_src(src)
    assert grid == "....\n.D1.\n....\n...."
    assert replace_grid(src, grid) == src  # no-op roundtrip


def test_replace_grid_preserves_everything_but_the_grid():
    src = 'orca("""\n..\n..\n""", bpm=140)'
    assert replace_grid(src, "AB\nCD") == 'orca("""\nAB\nCD\n""", bpm=140)'


def test_is_orca_row():
    assert is_orca_row('orca("""\n..\n..\n""")')
    assert not is_orca_row("x = 1")
    assert not is_orca_row("orca_thing()")


def test_orca_tmpfile_roundtrip(tmp_path):
    """The literal's grid, written to a tmp file (as open_orca does) and read back (as the
    poll/exit path does), is byte-for-byte what a real orca TUI session would see and save."""
    src = 'orca("""\n....\n.D1.\n....\n....\n""")'
    grid = grid_from_src(src)
    tmp = tmp_path / "s.orca"
    tmp.write_text(grid + "\n")
    read_back = tmp.read_text().rstrip("\n")
    assert read_back == grid
    assert replace_grid(src, read_back) == src


async def test_slash_orca_inserts_default_grid(monkeypatch, tmp_path):
    import asemic_py.columns as columns_mod

    monkeypatch.setattr(columns_mod, "ORCA_ADAPTER_DIR", tmp_path)  # !pollute the tracked seed file
    d = Doc(SRC)
    app = _ColApp(d)
    async with app.run_test(size=(60, 12)) as pilot:
        col = app.query_one(BlockColumns)
        col._orca_view = {"attach": "tmux attach -t asemic-orca", "session": "asemic-orca", "seed": "asemic.orca"}
        await pilot.press("escape", *":orca", "enter")
        rows = d.rows()
        assert any(r.src.startswith('orca("""') for r in rows)
        orca_row = next(r for r in rows if r.src.startswith('orca("""'))
        assert orca_row.src.count("\n") == 5  # orca(""" / 4 grid rows / """)
        assert BlockColumns._row_label(orca_row) == 'orca("""  ▦ 8x4'


# ---------------------------------------------------------------- run_tree (fake Repl)

class _FakeRepl:
    """Stands in for namespace.Repl: records (label, code) instead of hitting a brain.
    run_nest/run_tree are the real Repl methods (they only need self.run_block)."""

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.failed = None  # Repl.failed: (line, msg) of the last failed run_block
        self.ran: set[str] = set()

    def pause_nest(self, doc, path):
        pass

    def run_block(self, label, code):
        self.calls.append((label, code))
        return ""

    from asemic_py.namespace import Repl
    run_nest = Repl.run_nest
    run_tree = Repl.run_tree
    del Repl


def test_run_tree_visits_root_then_children_depth_first():
    d = Doc(SRC)
    fake = _FakeRepl()
    fake.run_tree(d)
    labels = [c[0] for c in fake.calls]
    assert labels == ["main", "voice", "voice/env"]
    main_code = dict(fake.calls)["main"]
    assert "x = 1" in main_code and "y = 2" in main_code and "amp" not in main_code
    voice_code = dict(fake.calls)["voice"]
    assert voice_code.strip() == "amp(0.4)"


def test_run_nest_runs_only_own_leaves():
    d = Doc(SRC)
    fake = _FakeRepl()
    fake.run_nest(d, (1,))  # "voice": its own leaf (amp), not child nest "env"
    assert fake.calls == [("voice", "amp(0.4)\n")]


async def test_toast_reparse(tmp_path):
    f = tmp_path / "s.py"
    f.write_text(SRC)
    d = Doc.load(f)
    app = _ColApp(d)
    async with app.run_test(size=(60, 14)) as pilot:
        col = app.query_one(BlockColumns)
        await pilot.press("down", "right", "end", "backspace")  # voice/amp(0.4 -> draft on leave
        await pilot.press("down", "up")
        assert d.drafts == {(1, 0): "amp(0.4"}
        f.write_text(SRC.replace("    # loud\n", "    pan(0)\n    # loud\n"))  # row inserted above
        await pilot.pause(0.4)
        assert col.query_one("#toast").has_class("shown") and d.misplaced == [(1, 0)]
        await pilot.click("#reparse")
        assert d.drafts == {(1, 1): "amp(0.4"} and col.cursor == 1 and col.line.text == "amp(0.4"
        assert not col.query_one("#toast").has_class("shown")


# ---------------------------------------------------------------- timestretch controls

def test_timestretch_defaults_frozen_and_inherits_parent():
    d = Doc('with block("a"):\n    with block("child"):\n        x = 1\nwith block("b", timestretch="1.0"):\n    y = 2\n')
    assert d.effective_timestretch((0,)) == 0.0
    assert d.effective_timestretch((0, 0)) == 0.0
    assert d.effective_timestretch((1,)) == 1.0
    assert d.rows(())[0].timestretch == 0.0
    assert d.rows(())[1].timestretch == 1.0
    d.set_timestretch((0,), 1.0)
    assert d.effective_timestretch((0, 0)) == 1.0
    d.set_timestretch((0,), 0.0)
    assert d.src_at((0,)).startswith('with block("a", timestretch="0.0"):')


def test_doc_undo_redo_covers_every_splice():
    d = Doc('with block("a"):\n    x = 1\n')
    before = d.code
    d.set_timestretch((0,), 0.0)
    d.stage((0, 0), "x = 2")
    assert d.undo() and d.undo() and d.code == before
    assert not d.undo()
    assert d.redo() and 'timestretch="0.0"' in d.code and "x = 1" in d.code


def test_timestretch_can_be_cleared_to_inherit():
    d = Doc('with block("a", timestretch="1.0"):\n    x = 1\n')
    d.set_timestretch((0,), None)
    assert d.src_at((0,)).startswith('with block("a"):')
    assert d.rows(())[0].timestretch == 0.0
