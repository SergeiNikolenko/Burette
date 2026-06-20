# Documentation Map

This directory is the current documentation graph for Burrete. It intentionally
contains only documents that describe the active project.

## Current Docs

- [Architecture](architecture.md): repository boundaries and runtime shape.
- [Renderer support](renderer-support.md): renderer modes, supported formats,
  Ketcher editing scope, artifacts, and checks.
- [Performance architecture](performance.md): runtime profiles, caches, binary
  payloads, grid search, and no-regression guardrails.
- [Stability program](stability.md): preview trace, runtime manifest, nightly
  smoke, and staged stability guardrails.
- [Vite+ workflow](vite-plus.md): `vp` entrypoints for frontend development and
  JavaScript validation.
- [Modular runtime refactor](modular-runtime-refactor.md): staged extraction
  plan for `vite.config.ts`, `App.tsx`, and browser-dev runtime modules.
- [Development loops](development-loops.md): fast edit, debug, patch, and remote
  check paths that avoid full local rebuilds.
- [Control affordances](control-affordances.md): tooltip and menu-detail rules
  for compact controls across React, Mol*, `xyzrender`, Grid, and Ketcher.
- [Quick Look debugging](quicklook-debugging.md): Finder preview diagnosis and
  cache reset workflow.
- [iOS mobile app](../ios/BurreteMobile/README.md): source-built iPhone preview
  app target, runtime reuse, signing, and real-device install flow.
- [Launch modes](launch-modes.md): normal, file-open, tray, and registration
  launch semantics.
- [Releasing](releasing.md): version, build, signing, update, and artifact
  requirements.
- [Keyboard shortcuts](keyboard-shortcuts.md): app shortcuts and command palette
  actions.

## Maintenance Rules

- Keep user-facing installation and usage in [README.md](../README.md).
- Keep current engineering docs in `docs/`.
- Do not keep imported reference snapshots or migration handoff logs in the
  active docs graph.
- Verify doc claims against code, scripts, or runtime output before changing
  docs.
