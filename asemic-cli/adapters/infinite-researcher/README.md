# infinite-researcher adapter

One-shot research synthesis CLI adapter integrating Infinite Researcher into asemic.

## Overview

- **Kind**: `cli` (no persistent daemon; executed per input request).
- **Command**:
  ```bash
  uv run --directory "${HOME}/jVault/Projects/Infinite Researcher/server" python -m infinite_researcher.cli research {query}
  ```
- **Execution model**:
  - A Zenoh `put` on input plug executes the CLI command template directly (without shell wrapping).
  - Stdout streams line-by-line to the output plug.
  - Upon process exit, a completion event with return code is published.

## Zenoh Keyspace & I/O

- **Input plug `query`**:
  - `asemic/io/infinite-researcher/query`: Initiates research job for received query string.
- **Output plug `answer`**:
  - `asemic/out/infinite-researcher/answer`: Real-time streaming chunks / lines from research synthesis.
  - `asemic/out/infinite-researcher/answer/done`: Carries completion payload `{"code": <exit_status>}`.
