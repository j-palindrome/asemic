"""~/.asemic.json / ./.asemic.json (package.json-style): optional user/project config.
Currently just `exampleDirs` -- extra directories scanned for examples alongside `examples/`,
relative to the config file's own directory, searched before cwd/`main`'s path resolution."""

import json
from pathlib import Path

from .client import ROOT

_CONFIG_NAMES = (Path.home() / ".asemic.json", Path.cwd() / ".asemic.json")


def _load_one(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def load_config() -> dict:
    """Project config (./.asemic.json) overrides user config (~/.asemic.json); shallow merge."""
    merged: dict = {}
    for path in _CONFIG_NAMES:
        merged.update(_load_one(path))
    return merged


def example_dirs() -> list[Path]:
    """`examples/` always first, then each `exampleDirs` entry (resolved relative to its
    config file's directory when relative), in config-file order; duplicates dropped."""
    dirs = [ROOT / "examples"]
    cfg = load_config()
    extra = cfg.get("exampleDirs") or []
    if isinstance(extra, str):
        extra = [extra]
    for entry in extra:
        p = Path(entry).expanduser()
        if not p.is_absolute():
            p = Path.cwd() / p
        p = p.resolve()
        if p not in dirs:
            dirs.append(p)
    return [d for d in dirs if d.is_dir()]
