---
name: feedback-push-every-message
description: J wants every committed change pushed immediately, not held locally
metadata:
  type: feedback
---

Commit **and push** to `origin main` after every change, on every message — do not leave commits local.

**Why:** J asked for this explicitly on 2026-11-03 while debugging the readyfire play/pause bug ("push on every message please"); the global "never push unless asked" default is overridden for this repo.

**How to apply:** after each committed scope run `git push origin main` in the same turn. Still do not commit unrelated or J-WIP files. See [[project-readyfire-play-cutoff]].
