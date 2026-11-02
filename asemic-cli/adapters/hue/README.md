# hue adapter

Backend for Philips Hue lighting in asemic. Renders lamp color and brightness from live brain values and pushes updates to the Philips Hue Bridge.

## Overview

- **Kind**: `python` (`lifecycle.start = "adapter.py"` executed with repo virtualenv).
- **Control inputs**:
  - `HUE_ARENA` (default `arena`): XY pad component providing vortex position (`vx`, `vy`).
  - `HUE_CHAOS` (default `chaos`): Chaos noise component (`lx`, `ly`, `angle`, `speed`).
  - `HUE_INTENSITY` (default `intensity`): Global intensity parameter component (range `0.1`..`2.5`, default `1.0`).
  - `HUE_PALETTE` (default `inferno`): Color palette mapped onto lamp positions.
- **Output**:
  - Puts state updates to Philips Hue Bridge over local REST API.
  - Publishes rendered states to Zenoh: `asemic/out/hue/lamp/<id>` (`{"xy", "bri"}`).

## Environment & Configuration

- `HUE_BRIDGE_IP`: IP address of Philips Hue Bridge.
- `HUE_API_KEY`: Application username / API key for bridge.
  - Fallback credentials automatically loaded from vault `.mcp.json` (`philips-hue` MCP server config) if environment variables are not set.
- `ASEMIC_HUE_DRY=1`: Dry run mode; publishes to Zenoh only without sending HTTP requests to the bridge.

## Zenoh Keyspace

- **Subscribes**:
  - `asemic/value/arena.$*`: Vortex position updates.
  - `asemic/value/chaos.$*`: Chaos generator state.
  - `asemic/value/intensity.value`: Intensity scaling.
  - `asemic/state/hue/lamps`: Lamp layout mapping (`{"<id>": {"name", "x", "y"}}`).
- **Publishes**:
  - `asemic/out/hue/lamp/*`: Per-lamp rendered CIE `xy` coordinates and brightness `bri`.
