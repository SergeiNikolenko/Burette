---
name: burette-review-testing
description: Review whether Burette changes have the right focused validation.
---

# Testing Review

Use this skill when reviewing whether a change is adequately verified.

## Principles

- Prefer contract and integration tests for cross-surface behavior.
- Unit tests are useful for pure helpers but are not enough for Quick Look,
  agent, Tauri bridge, browser-shell, or release contracts.
- Do not add test-only production code paths.
- Do not claim a native surface is validated by a browser-only check.
- Keep fixtures small, reviewed, and intentionally placed under `samples/` or
  `tests/fixtures/`.

## Common Focused Checks

Use `docs/tools/index.md` and `docs/tools/testing-surfaces.md` to pick the
narrowest relevant command. Common checks include:

```bash
bun tests/test-ui-shell-contract.mjs
bun tests/test-viewer-bridge-message-contract.mjs
bun tests/test-runtime-storage-contract.mjs
bun tests/test-dev-namespace.mjs
bun tests/test-quicklook-preview-smoke-contract.mjs
bun tests/test-agent-preview-server.mjs
bun run test:agent
bun run test:update
bun run test:ui
bun run test:tauri-structure
bun run check
vp check
vp test
```

## Native Checks

For packaged desktop or Finder Quick Look changes, browser checks are not
enough. Require the documented build/install/smoke flow with a unique
`BURETTE_DEV_FLAVOR` unless the user explicitly scoped the task away from native
verification.

## Output

List missing tests or mismatched validation with the changed behavior they fail
to cover.
