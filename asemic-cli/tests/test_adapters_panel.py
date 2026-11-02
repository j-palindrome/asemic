"""`/adapters` slash verb (this task): inline panel listing every `adapters/*/adapter.toml`,
same harness style as `test_links.py` (OSC 8 link helpers) and `test_param_focus.py`
(manually-mounted panel + fake `rapp`, no live zenoh/brain). Brain-status fan-out
(`asemic/adapter/*/status`) is stubbed via a fake client -- the live brain path is covered by
`test_adapters_live.py` (ignored here, per the run instructions)."""

from types import SimpleNamespace

import pytest
from textual.app import App, ComposeResult
from textual.widgets import OptionList

from asemic_py.app import AdaptersPanel, adapter_status, load_adapter_manifests
from asemic_py.blocks import Doc
from asemic_py.columns import BlockColumns, LOCAL_COMMAND_NAMES


# ------------------------------------------------------------ load_adapter_manifests (pure)
def test_load_adapter_manifests_reads_real_adapters_dir():
    manifests = load_adapter_manifests()
    names = [m["name"] for m in manifests]
    assert "hue" in names
    assert "orca" in names
    assert names == sorted(names)  # sorted by name
    hue = next(m for m in manifests if m["name"] == "hue")
    assert hue["kind"] == "python"
    assert hue["path"].name == "adapter.toml"
    assert any(p["dir"] == "out" and p["name"] == "lamps" for p in hue["io"])


def test_load_adapter_manifests_skips_malformed(tmp_path):
    (tmp_path / "adapters" / "bad").mkdir(parents=True)
    (tmp_path / "adapters" / "bad" / "adapter.toml").write_text("not = [valid toml")
    (tmp_path / "adapters" / "good").mkdir(parents=True)
    (tmp_path / "adapters" / "good" / "adapter.toml").write_text(
        '[adapter]\nname = "good"\nkind = "cli"\n'
    )
    manifests = load_adapter_manifests(root=tmp_path)
    assert [m["name"] for m in manifests] == ["good"]


def test_load_adapter_manifests_empty_dir(tmp_path):
    assert load_adapter_manifests(root=tmp_path) == []


# ------------------------------------------------------------ adapter_status (brain stub)
def test_adapter_status_no_client_is_all_unknown():
    assert adapter_status(None, ["hue", "orca"]) == {"hue": None, "orca": None}


def test_adapter_status_from_fake_client():
    client = SimpleNamespace(
        get=lambda sel, timeout=1.0: [
            ("asemic/adapter/hue/status", {"running": True}),
            ("asemic/adapter/orca/status", {"running": False}),
        ]
    )
    assert adapter_status(client, ["hue", "orca", "midi"]) == {
        "hue": True,
        "orca": False,
        "midi": None,  # brain didn't answer for it
    }


def test_adapter_status_brain_unreachable_falls_back_unknown():
    def _raises(sel, timeout=1.0):
        raise RuntimeError("no brain")

    client = SimpleNamespace(get=_raises)
    assert adapter_status(client, ["hue"]) == {"hue": None}


# ------------------------------------------------------------ /adapters is a known local verb
def test_adapters_is_a_local_command():
    assert "adapters" in LOCAL_COMMAND_NAMES


# ------------------------------------------------------------ AdaptersPanel (Pilot)
def _fake_rapp(client=None):
    return SimpleNamespace(client=client)


class _Harness(App):
    def compose(self) -> ComposeResult:
        yield BlockColumns(Doc("x = 1\n"), id="cols")


@pytest.mark.asyncio
async def test_adapters_panel_lists_every_manifest(monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    app = _Harness()
    async with app.run_test() as pilot:
        await pilot.pause()
        cols = app.query_one("#cols", BlockColumns)
        panel = AdaptersPanel(_fake_rapp())
        cols.query_one("#rows").mount(panel)
        await pilot.pause()
        names = {panel.get_option_at_index(i).id for i in range(panel.option_count)}
        expected = {m["name"] for m in load_adapter_manifests()}
        assert names == expected
        assert panel.option_count > 0


@pytest.mark.asyncio
async def test_adapters_panel_shows_running_status_from_client(monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    client = SimpleNamespace(
        get=lambda sel, timeout=1.0: [("asemic/adapter/hue/status", {"running": True})]
    )
    app = _Harness()
    async with app.run_test() as pilot:
        await pilot.pause()
        cols = app.query_one("#cols", BlockColumns)
        panel = AdaptersPanel(_fake_rapp(client))
        cols.query_one("#rows").mount(panel)
        await pilot.pause()
        hue_idx = next(i for i in range(panel.option_count) if panel.get_option_at_index(i).id == "hue")
        hue_opt = panel.get_option_at_index(hue_idx)
        assert "running" in str(hue_opt.prompt)
        # any adapter the brain never answered for shows "?"
        other_idx = next(
            i for i in range(panel.option_count) if panel.get_option_at_index(i).id not in ("hue",)
        )
        assert "?" in str(panel.get_option_at_index(other_idx).prompt)


@pytest.mark.asyncio
async def test_adapters_panel_name_is_osc8_link_to_its_toml(monkeypatch):
    monkeypatch.setenv("ASEMIC_LINKS", "1")
    app = _Harness()
    async with app.run_test() as pilot:
        await pilot.pause()
        cols = app.query_one("#cols", BlockColumns)
        panel = AdaptersPanel(_fake_rapp())
        cols.query_one("#rows").mount(panel)
        await pilot.pause()
        hue_idx = next(i for i in range(panel.option_count) if panel.get_option_at_index(i).id == "hue")
        prompt = panel.get_option_at_index(hue_idx).prompt
        spans = getattr(prompt, "spans", [])
        assert any("link" in str(s.style) and "adapter.toml" in str(s.style) for s in spans)


@pytest.mark.asyncio
async def test_enter_on_adapters_row_inserts_parent_block():
    """Enter on a row inserts the adapter's parent `with block("<name>"):` into the current block (chosen UX, see
    `AdaptersPanel`'s docstring): this exercises `on_option_list_option_selected` directly via
    `OptionList.OptionSelected`, same as pressing Enter on the highlighted option would."""
    inserted: list[str] = []

    class _FakeCols:
        def insert_call(self, text: str) -> None:
            inserted.append(text)

    app = _Harness()
    async with app.run_test() as pilot:
        await pilot.pause()
        rapp = SimpleNamespace(
            client=None,
            query_one=lambda *a, **k: _FakeCols(),
            action_toggle_adapters=lambda: None,
        )
        cols = app.query_one("#cols", BlockColumns)
        panel = AdaptersPanel(rapp)
        cols.query_one("#rows").mount(panel)
        await pilot.pause()
        panel.post_message(
            OptionList.OptionSelected(panel, panel.get_option_at_index(0), 0)
        )
        await pilot.pause()
        assert inserted
        name = panel.get_option_at_index(0).id
        assert inserted[0] == f'with block({name!r}):\n    pass'
