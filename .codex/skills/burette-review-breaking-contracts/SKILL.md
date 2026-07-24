---
name: burette-review-breaking-contracts
description: Review Burette changes for breaking runtime and integration contracts.
---

# Breaking Contract Review

Search for breaking changes across Burette's public and agent-visible surfaces.
Do not stop after the first issue.

## Surfaces

- Quick Look: bundle identifiers, extension identifiers, content types,
  document types, thumbnail/preview registration, Launch Services behavior,
  packaged app layout, and `BURETTE_DEV_FLAVOR` isolation.
- Browser surfaces: browser-dev shell, browser Quick Look route,
  `quickLookFile`, tokenized browser preview, dev filesystem allow-listing,
  local server port behavior, and Browser plugin handoff.
- Desktop app: Tauri command names, event payloads, menu actions, shell actions,
  viewer bridge messages, persisted runtime state, and app launch modes.
- Agent platform: `scripts/burette-agent.mjs`, `scripts/agent-preview.mjs`,
  observe/action JSON shapes, session files, MCP registrations, widget manifests,
  and plugin skill workflow handoff.
- Molecular runtime: preview format registry, Mol*/RDKit/xyzrender assets,
  grid viewer behavior, text/spectrum fallback, and report rendering.
- iOS source app: runtime asset reuse, document handoff, WKWebView loading,
  bundle identifiers, signing assumptions, and real-device behavior.
- Release and install: package versions, updater manifests, Homebrew tap update,
  Bun package installer, app bundle layout, signing, and notarization.

## Checks

- Identify the consumer of every changed contract.
- Confirm paired metadata files changed together.
- Confirm focused tests or smoke commands cover the affected surface.
- Flag silent shape changes, renamed actions, changed defaults, or new required
  fields that older callers will not provide.
- Flag changes that prove only one runtime while claiming another runtime is
  safe.

## Output

Return only concrete breaking-change risks with file path, line number, and the
consumer that would break.
