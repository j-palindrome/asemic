# Troubleshooting

Common problems and how to fix them.

## Brain already running

**Symptom:** `another asemic-brain is already running`.

**Cause:** `asemic-brain` uses a lock file in the system temp directory to ensure only one brain per machine owns Syphon names.

**Fix:** Kill the other brain or use `asemic --restart`.

## Brain not answering

**Symptom:** `brain not answering (is asemic-brain running?)`.

**Cause:** zenohd is down or the brain crashed.

**Fix:** `asemic --restart`, or run `zenohd -c config/router.json5` manually, then restart the REPL.

## Blank preview / no frames

**Symptom:** a node panel shows no preview.

**Cause:** previews are demand-gated; no subscriber on `asemic/preview/<id>`.

**Fix:** focus the row, open its panel, or call `embed(id)` in code.

## Block stays frozen

**Symptom:** a block does not animate.

**Cause:** `timestretch` defaults to `0.0`.

**Fix:** set `timestretch=1.0` in the `block()` call or press **Space** on the block row.

## Adapter won't start

**Symptom:** playing a block that owns an adapter (or calling `build(name)` from the command line) fails.

**Cause:** missing external app, bad manifest, or not built.

**Fix:** check `adapters/<name>/adapter.toml`, ensure the external app is installed, and run `:build <name>` first or use the adapters panel.

## Type errors in REPL / missing completions

**Symptom:** editor complains about unknown verbs or wrong signatures.

**Cause:** `_api.pyi` / `_types.py` are stale.

**Fix:** run `python scripts/gen_api.py` and `bash scripts/gen_types.sh`.

## Syphon not visible

**Symptom:** a Syphon output does not appear in other apps.

**Cause:** only one brain per machine can own Syphon names.

**Fix:** ensure no other `asemic-brain` is running.

## Debug the brain

Run the brain directly with debug logging:

```bash
RUST_LOG=debug cargo run --bin asemic-brain -- --config config/peer.json5
```

This prints every verb call, Zenoh routing event, and adapter lifecycle action.
