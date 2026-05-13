# Documentation Map

This directory is the current documentation graph for Burrete. It intentionally
contains only documents that describe the active project.

## Current Docs

- [Architecture](architecture.md): repository boundaries and runtime shape.
- [Renderer support](renderer-support.md): renderer modes, supported formats,
  artifacts, and checks.
- [Quick Look debugging](quicklook-debugging.md): Finder preview diagnosis and
  cache reset workflow.
- [Releasing](releasing.md): version, build, signing, update, and artifact
  requirements.
- [Keyboard shortcuts](keyboard-shortcuts.md): app shortcuts and command palette
  actions.
- [Specs](specs/README.md): current product and runtime specs.

## Maintenance Rules

- Keep user-facing installation and usage in [README.md](../README.md).
- Keep current engineering docs in `docs/`.
- Keep specs under `docs/specs/`.
- Do not keep imported reference snapshots or migration handoff logs in the
  active docs graph.
- Verify doc claims against code, scripts, or runtime output before changing
  docs.
