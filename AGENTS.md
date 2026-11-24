# Agent Dispatch

Burette is a desktop app (macOS primary, plus active Linux and Windows ports),
Finder Quick Look extension, source-built iPhone preview app, and hosted public
plugin for molecular structure files.
Keep this file as a dispatcher; load the focused doc for the surface you are
changing.

## Project Contracts

- Product name: `Burette`
- Package name: `burette`
- Tauri app identifier: `com.local.BuretteV10`
- Package manager: `bun@1.4.2`
- Stable agent CLIs: `scripts/burette-agent.mjs` and
  `scripts/agent-preview.mjs`
- Packaged agent plugin root: `plugins/burette-agent`
- Quick Look base bundle identifiers:
  `com.local.BuretteV10.Preview` and `com.local.BuretteV10.Thumbnail`
- Development installs must use `BURETTE_DEV_FLAVOR` so local app, extension,
  container, and forced-content-type namespaces do not collide.

## Documentation Graph

- User-facing overview: [README.md](README.md)
- Changelog pointer: [CHANGELOG.md](CHANGELOG.md)
- Documentation map: [docs/README.md](docs/README.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Product direction: [docs/product.md](docs/product.md)
- Design direction: [docs/design-system.md](docs/design-system.md)
- Before UI or workflow changes, read [docs/interaction-principles.md](docs/interaction-principles.md)
  and use its acceptance checklist for the changed flow.
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
- iOS mobile app: [ios/BuretteMobile/AGENTS.md](ios/BuretteMobile/AGENTS.md)
- Agent plugin: [plugins/burette-agent/AGENTS.md](plugins/burette-agent/AGENTS.md)
- Repository scripts: [scripts/README.md](scripts/README.md)

## Runtime Boundaries

| Boundary | Primary paths | First doc to read |
| --- | --- | --- |
| Desktop app shell | `apps/desktop/src`, `apps/desktop/src-tauri` | `docs/architecture.md` |
| Browser-dev runtime | `apps/desktop/vite`, `apps/desktop/src/hooks` | `docs/tools/testing-surfaces.md` |
| Finder Quick Look | `PreviewExtension`, `PreviewExtension/Web` | `PreviewExtension/AGENTS.md` |
| iPhone source app | `ios/BuretteMobile` | `ios/BuretteMobile/AGENTS.md` |
| Agent CLI and sessions | `scripts/burette-agent.mjs`, `scripts/agent-preview.mjs` | `docs/agent-platform.md` |
| Packaged MCP plugin | `plugins/burette-agent` | `plugins/burette-agent/AGENTS.md` |
| Hosted public plugin and MCP | `apps/burette-public-plugin` | `docs/agent-platform.md` |
| Native compute layer | `crates/burette-compute-*`, `compute/`, `apps/desktop/src-tauri/src/compute` | `docs/gpu-compute-status.md` |
| Shared workspace packages | `packages/burette`, `packages/ketcher-agent-contract` | `docs/repository-layout.md` |
| Release and repository tooling | `scripts`, `.codex/skills` | `docs/tools/index.md` |

## Common Routing

- For frontend development and JavaScript validation, use Vite+ through `vp`;
  see [docs/vite-plus.md](docs/vite-plus.md) and [scripts/README.md](scripts/README.md).
- Refresh lightweight repository tools when the workflow requires them (e.g.
  `vp install` for Vite+ native bindings) instead of working around a missing toolchain.
- Do not open the desktop app as a substitute for a browser preview. Use
  `desktop-app` only for packaged app, native app, Quick Look, or other
  desktop-specific verification.
- For packaged local testing, always use a unique `BURETTE_DEV_FLAVOR` unless
  the task is explicitly release-bundle work.
- For Apple-platform builds/tests invoke `@build-ios-apps` or `@build-macos-apps`;
  a requested native build or update verification authorizes its necessary local
  build and focused native tests without re-asking for build size.
- For Apple UI/SF Symbols/SwiftUI/AppKit polish invoke `$apple-design`; invoke
  `@product-design` for product flow or prototype design before implementation.
- For repo maintenance, PR body, release readiness, or final review work, use
  the repo-local skills under [.codex/skills](.codex/skills). Keep those
  separate from packaged product skills under `plugins/burette-agent/skills`.

## Interface Icons

- Use the shared, reviewed icons from `apps/desktop/src/components/ui/app-icons`
  for React controls, including search arrows, close buttons, menus, and toolbars.
  Existing Hugeicons renderers use `components/ui/app-icon-data`.
- Do not add direct Lucide/Hugeicons imports or hand-drawn SVG replacements for
  common actions. Reuse the shared icon with the matching meaning. Preserve
  scientific glyphs, application logos, and established animations as described
  in [Shared Icon Geometry](docs/design-system.md#shared-icon-geometry).
- The source of truth is `config/icons/apps-sdk.json`; update it through the
  documented icon workflow when a shared glyph is missing. Do not edit generated
  icon data or exports by hand.

## Contract Surfaces

Before changing any contract surface, identify the consumer, update the paired
metadata, and run the focused contract check.

- Treat `apps/desktop/src/App.tsx`, `apps/desktop/vite.config.ts`,
  `PreviewExtension/Web/viewer.js`, and `PreviewExtension/Web/viewer-shell.js`
  as high-touch boundaries; place new behavior in focused modules, hooks, or adapters.
- Quick Look bundle identifiers, content types, document types, Launch Services
  behavior, and native preview registration are stable release contracts.
- Keep `config/preview-formats.json`,
  `apps/desktop/src-tauri/AppMetadata.plist`, `PreviewExtension/Info.plist`,
  `PreviewExtension/ThumbnailInfo.plist`, and related format tests in sync.
- Browser-dev, browser Quick Look, tokenized preview, and packaged Quick Look
  are separate runtime surfaces. Passing one does not prove the others.
- CLI, MCP, and plugin tool contracts are defined by
  `scripts/burette-agent.mjs`, `scripts/agent-preview.mjs`,
  `docs/agent-platform.md`, and `plugins/burette-agent/**`. Do not change JSON
  shapes, action names, session files, or widget artifact shapes without tests
  and docs.
- Tauri commands, event payloads, menu actions, and frontend bridge messages are
  app contracts. Prefer typed payloads and explicit discriminants over ambiguous
  booleans or positional literals.
- Release, installer, updater, Homebrew cask, and versioning changes must keep
  package metadata, release checks, and documentation aligned.
- Preserve the supported desktop (macOS, Linux, Windows), Quick Look,
  browser-dev, and iPhone source-app surfaces unless explicitly scoped to one.

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
- Keep agent-visible payloads bounded and path-based for large molecular files
  (see [docs/agent-platform.md](docs/agent-platform.md)); preserve session
  history unless explicitly asked to reset it.

## User-Facing Features

A feature is finished when its user documentation, landing copy and media are
updated with it, not later.

- Save the acceptance screenshots (light and dark) outside the repository in
  `~/Documents/Projects/Burette-media/<project>/<stage-or-feature>/<theme>-<state>.png`
  and keep that folder's `README.md` index current.
- Update the user docs in the landing repository (`burette-landing/content`)
  and the Features catalog (`components/features/catalog.json`) on a landing
  branch; follow [docs/avogadro-showcase-plan.md](docs/avogadro-showcase-plan.md)
  for placement and copy rules. Do not push the landing `main` or deploy
  without the maintainer's go.
- Draft a short LinkedIn post for each feature a user would notice, next to the
  landing copy. Drafts only; publishing needs the maintainer's go.
