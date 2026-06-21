# Agent Dispatch

Burrete is a macOS desktop app, Finder Quick Look extension, and source-built
iPhone preview app for molecular structure files. Keep this file as a
dispatcher; load the focused doc for the surface you are changing.

## Documentation Graph

- User-facing overview: [README.md](README.md)
- Changelog pointer: [CHANGELOG.md](CHANGELOG.md)
- Documentation map: [docs/README.md](docs/README.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Configuration: [docs/configuration.md](docs/configuration.md)
- Modular runtime refactor: [docs/modular-runtime-refactor.md](docs/modular-runtime-refactor.md)
- Renderer support: [docs/renderer-support.md](docs/renderer-support.md)
- Security and permissions: [docs/security-and-permissions.md](docs/security-and-permissions.md)
- Quick Look debugging: [docs/quicklook-debugging.md](docs/quicklook-debugging.md)
- Agent platform: [docs/agent-platform.md](docs/agent-platform.md)
- Repo-local Codex maintenance skills: [.codex/README.md](.codex/README.md)
- Agent tool index: [docs/tools/index.md](docs/tools/index.md)
- Testing surfaces: [docs/tools/testing-surfaces.md](docs/tools/testing-surfaces.md)
- Release process: [docs/releasing.md](docs/releasing.md)

## Directory Context

- Desktop hooks: [apps/desktop/src/hooks/README.md](apps/desktop/src/hooks/README.md)
- Desktop library helpers: [apps/desktop/src/lib/README.md](apps/desktop/src/lib/README.md)
- Desktop Vite runtime: [apps/desktop/vite/README.md](apps/desktop/vite/README.md)
- Quick Look extension: [PreviewExtension/AGENTS.md](PreviewExtension/AGENTS.md)
- iOS mobile app: [ios/BurreteMobile/AGENTS.md](ios/BurreteMobile/AGENTS.md)
- Agent plugin: [plugins/burette-agent/AGENTS.md](plugins/burette-agent/AGENTS.md)
- Repository scripts: [scripts/README.md](scripts/README.md)

## Common Routing

- For frontend development and JavaScript validation, use Vite+ through `vp`;
  see [docs/vite-plus.md](docs/vite-plus.md) and [scripts/README.md](scripts/README.md).
- Install or refresh lightweight repository tools when the documented workflow
  requires them, for example `vp install` for Vite+ native bindings. Do not
  change application code to work around a missing local toolchain.
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
- For iPhone app work, read [ios/BurreteMobile/AGENTS.md](ios/BurreteMobile/AGENTS.md)
  and verify the intended surface: generic build, Simulator, or real device.
- For Apple-platform build/run/test work, invoke the relevant plugin first:
  `@build-ios-apps` for iOS and `@build-macos-apps` for macOS/Quick Look.
- For Apple-platform UI, UX, icon, SF Symbols, SwiftUI/AppKit, or visual polish
  work, invoke `$apple-design`; invoke `@product-design` for product flow,
  prototype, or design-context work before implementation.
- For plugin/MCP/skill work, read
  [plugins/burette-agent/AGENTS.md](plugins/burette-agent/AGENTS.md) and
  [docs/agent-platform.md](docs/agent-platform.md).
- For repo maintenance, PR body, release readiness, or final review work, use
  the repo-local skills under [.codex/skills](.codex/skills). Keep those
  separate from packaged product skills under `plugins/burette-agent/skills`.

## Change Discipline

- Keep changes staged and reviewable. If a change is not mechanical and grows
  beyond a focused patch, split it into the smallest coherent stage that
  preserves behavior and can be validated independently.
- As a rule of thumb, keep non-mechanical changes under roughly 500 changed
  lines. If a diff approaches 800 changed lines, stop and split it unless the
  change is generated, vendored, or otherwise mechanically reviewed.
- Do not grow central orchestration files unless the task is trivial or there
  is a documented reason. Prefer adding focused modules near the surface that
  owns the behavior.
- Treat `apps/desktop/src/App.tsx`, `apps/desktop/vite.config.ts`,
  `PreviewExtension/Web/viewer.js`, and `PreviewExtension/Web/viewer-shell.js`
  as high-touch boundaries. New behavior should usually live behind existing
  hooks, Vite helpers, runtime adapters, or dedicated modules.
- Do not add single-use helper methods, test-only production hooks, broad
  compatibility shims, or speculative configuration. Use existing abstractions
  unless a new one removes real duplication or isolates a real boundary.
- Prefer private/local APIs by default. Export only the symbols that are needed
  across module or package boundaries.
- When extracting code from a large file, move the closest relevant tests,
  comments, and invariants with the implementation so ownership remains clear.

## Contract Surfaces

Before changing any contract surface, identify the consumer, update the paired
metadata, and run the focused contract check.

- Quick Look bundle identifiers, content types, document types, Launch Services
  behavior, and native preview registration are stable release contracts.
- Keep `config/preview-formats.json`,
  `apps/desktop/src-tauri/AppMetadata.plist`, `PreviewExtension/Info.plist`,
  `PreviewExtension/ThumbnailInfo.plist`, and related format tests in sync.
- Browser-dev, browser Quick Look, tokenized preview, and packaged Quick Look
  are separate runtime surfaces. Passing one does not prove the others.
- CLI, MCP, and plugin tool contracts are defined by
  `scripts/burrete-agent.mjs`, `scripts/agent-preview.mjs`,
  `docs/agent-platform.md`, and `plugins/burette-agent/**`. Do not change JSON
  shapes, action names, session files, or widget artifact shapes without tests
  and docs.
- Tauri commands, event payloads, menu actions, and frontend bridge messages are
  app contracts. Prefer typed payloads and explicit discriminants over ambiguous
  booleans or positional literals.
- Release, installer, updater, Homebrew cask, and versioning changes must keep
  package metadata, release checks, and documentation aligned.
- Changes should preserve the supported macOS desktop, Quick Look, browser-dev,
  and iPhone source-app surfaces unless the task is explicitly scoped to one
  surface. When behavior intentionally diverges by surface, document that
  decision near the owning code or docs.

## Generated, Vendored, And Lock Files

- If dependency manifests change, update the matching lockfile in the same
  change: `bun.lock`, `Cargo.lock`, or package-specific metadata as applicable.
- If Mol*, RDKit, grid bundles, or preview runtime assets change, update or
  verify `vendor-assets.lock.json` and the generated files under
  `PreviewExtension/Web/` through the documented scripts.
- If preview formats, runtime profiles, plist metadata, schemas, or generated
  Tauri capability files change, run the corresponding check before finalizing.
- Do not edit generated or vendored dist files by hand unless the repository
  script owns that edit path and the generated source of truth is updated too.

## Payload And Context Bounds

- Anything injected into agent context, MCP resources, widget snapshots,
  browser-session files, reports, or logs must be bounded and intentionally
  shaped. Do not stream arbitrary full files or unbounded directory listings
  into agent-visible payloads.
- Keep molecular report/table/trajectory artifacts within the limits documented
  by [docs/agent-platform.md](docs/agent-platform.md) and
  [plugins/burette-agent/AGENTS.md](plugins/burette-agent/AGENTS.md).
- For large molecular files, keep payloads path-based or summarized unless the
  receiving runtime explicitly requires inline data.
- Preserve existing session history and runtime state unless the task is
  explicitly a reset, migration, or cache-clear operation.

## Validation Routing

- Use [docs/tools/index.md](docs/tools/index.md) to pick the smallest reliable
  command for the changed surface.
- Use [docs/tools/testing-surfaces.md](docs/tools/testing-surfaces.md) before
  starting dev servers, browser Quick Look URLs, or broad contract checks.
- Rust validation runs from `apps/desktop/src-tauri`; use `cargo test`,
  `cargo clippy`, and `cargo fmt --check` when changing Tauri/Rust code.
- If a Vite+ command reports a missing Rolldown native binding in the Codex
  desktop shell, run `vp install`, then retry with a normal system Node before
  changing app code.
- Run focused checks automatically for the touched surface. Ask before running
  broad, slow, or native-heavy sweeps such as full CI, all-samples native Quick
  Look smoke, release builds, or long performance runs unless the user already
  requested that level of validation.

## Test Guidance

- Prefer contract and integration tests for preview runtime, agent platform,
  Quick Look routing, Tauri bridge, and browser-shell behavior. Unit tests are
  useful for pure helpers but are not enough for cross-surface contracts.
- Do not add tests that only assert static constants, mirror implementation
  details, or preserve behavior that has intentionally been removed.
- Avoid production code paths whose only purpose is to make tests easier. Put
  test helpers in test files or existing test-support modules.
- When behavior changes user-visible UI, text, menus, tooltips, preview output,
  or browser-shell state, include the smallest practical UI, Browser, snapshot,
  or smoke verification.
- Prefer assertions over whole structured results instead of checking many
  unrelated fields one by one.
- Keep fixtures small and reviewed. Large real-world files belong outside git
  unless they are intentionally minimized and documented under `samples/` or
  `tests/fixtures/`.

## Rust And TypeScript Conventions

- In Rust, prefer enums, named methods, or explicit types over call sites with
  unclear `false`, `true`, `None`, or numeric positional arguments.
- Keep Rust `match` statements exhaustive where practical. Avoid wildcard arms
  when named variants would make future changes safer.
- New Rust traits should document their role and implementation expectations.
- Prefer typed TypeScript unions and explicit action names for renderer, shell,
  and agent messages. Avoid unstructured `any` payloads at boundaries.
- Do not mutate process-level environment in tests when a dependency, option,
  or injected setting can model the same behavior.

## Maintenance Rules

- Keep durable engineering docs under `docs/`.
- Use local README files for ordinary code architecture guidance.
- Use local AGENTS files only for high-risk agent/runtime boundaries.
- Use `.codex/skills` for repository maintenance and review workflows, not
  user-facing molecular plugin workflows.
- Do not add `.override` docs unless a maintainer explicitly asks for that
  resolution model.
- Do not reintroduce imported reference snapshots or migration handoff logs into
  the active docs graph.
- Verify doc claims against source, scripts, or runtime output before updating
  docs.
