# Configuration

This page covers Zenoh networking, UI/performance settings, and environment variables.

## Zenoh configuration

Zenoh config files live in `config/`:

- `config/peer.json5` — client mode, connects to the router at `tcp/127.0.0.1:7447`.
- `config/router.json5` — router config.

Use a custom config:

```bash
asemic --config path/to/peer.json5
```

The brain looks for the config relative to `--root` (default current working directory, overridable with `ASEMIC_ROOT`).

## Environment variables

| variable | effect |
|----------|--------|
| `ASEMIC_ROOT` | Root directory used by `asemic-brain` for config/adapter discovery (default: current dir). |
| `ASEMIC_ZENOH_CONFIG` | Override the default `config/peer.json5` path. |
| `ASEMIC_PYTHON` | Python interpreter used for `kind = "python"` adapters (default: repo `.venv/bin/python`). |
| `ASEMIC_SURFACES=1` | Enable opt-in surface debug screenshots in tests. |
| `RUST_LOG` | Rust logging level when running the brain directly. |

## UI / performance settings

UI/perf settings are stored at `asemic/state/ui` and controlled by the `ui(...)` verb:

```python
ui(image="auto", hz=20, clock=True)
```

- `image` — terminal preview renderer: `auto`, `quad`, `halfcell`, `tgp`, `sixel`, `unicode`.
- `hz` — max UI redraws per second.
- `clock` — whether tempo ticks wake the UI.

## Single brain per machine

`asemic-brain` uses a lock file in the system temp directory to ensure only one brain runs per machine. This prevents Syphon name collisions. If you see "another asemic-brain is already running", kill the other process or use `asemic --restart`.
