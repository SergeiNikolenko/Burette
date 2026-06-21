# Agent Dispatch

Burrete is a macOS menu bar app plus a Quick Look Preview Extension for
molecular structure files. Keep this file as a dispatcher; load the focused doc
for the surface you are changing.

## Documentation Graph

- User-facing overview: [README.md](README.md)
- Documentation map: [docs/README.md](docs/README.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Modular runtime refactor: [docs/modular-runtime-refactor.md](docs/modular-runtime-refactor.md)
- Renderer support: [docs/renderer-support.md](docs/renderer-support.md)
- Quick Look debugging: [docs/quicklook-debugging.md](docs/quicklook-debugging.md)
- Agent platform: [docs/agent-platform.md](docs/agent-platform.md)
- Agent tool index: [docs/tools/index.md](docs/tools/index.md)
- Release process: [docs/releasing.md](docs/releasing.md)

## Directory Context

- Desktop hooks: [apps/desktop/src/hooks/README.md](apps/desktop/src/hooks/README.md)
- Desktop library helpers: [apps/desktop/src/lib/README.md](apps/desktop/src/lib/README.md)
- Desktop Vite runtime: [apps/desktop/vite/README.md](apps/desktop/vite/README.md)
- Quick Look extension: [PreviewExtension/AGENTS.md](PreviewExtension/AGENTS.md)
- Agent plugin: [plugins/burette-agent/AGENTS.md](plugins/burette-agent/AGENTS.md)
- Repository scripts: [scripts/README.md](scripts/README.md)

## Common Routing

- For frontend development and JavaScript validation, use Vite+ through `vp`;
  see [docs/vite-plus.md](docs/vite-plus.md) and [scripts/README.md](scripts/README.md).
- For browser previews, use the built-in Browser plugin. Do not use macOS
  `open`, Chrome, Safari, or another external browser unless the user explicitly
  asks for an external browser.
- Do not open the desktop app as a substitute for a browser preview. Use
  `desktop-app` only for packaged app, native app, Quick Look, or other
  desktop-specific verification.
- For packaged local testing, always use a unique `BURRETE_DEV_FLAVOR` unless
  the task is explicitly release-bundle work.
- For Quick Look work, read [PreviewExtension/AGENTS.md](PreviewExtension/AGENTS.md)
  before building, installing, or forcing previews.
- For plugin/MCP/skill work, read
  [plugins/burette-agent/AGENTS.md](plugins/burette-agent/AGENTS.md) and
  [docs/agent-platform.md](docs/agent-platform.md).

## Validation Routing

- Use [docs/tools/index.md](docs/tools/index.md) to pick the smallest reliable
  command for the changed surface.
- Rust validation runs from `apps/desktop/src-tauri`; use `cargo test`,
  `cargo clippy`, and `cargo fmt --check` when changing Tauri/Rust code.
- If a Vite+ command reports a missing Rolldown native binding in the Codex
  desktop shell, run `vp install`, then retry with a normal system Node before
  changing app code.

## Maintenance Rules

- Keep durable engineering docs under `docs/`.
- Use local README files for ordinary code architecture guidance.
- Use local AGENTS files only for high-risk agent/runtime boundaries.
- Do not add `.override` docs unless a maintainer explicitly asks for that
  resolution model.
- Do not reintroduce imported reference snapshots or migration handoff logs into
  the active docs graph.
- Verify doc claims against source, scripts, or runtime output before updating
  docs.
