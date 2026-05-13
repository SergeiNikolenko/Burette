# Writer Computer Migration Roadmap

## Goal

Migrate Burette so Writer Computer is the product skeleton and default
interface baseline, while Burette remains a molecular preview app with a working
macOS Quick Look extension.

## Source Plan

- `docs/orchestration/writer-computer-migration-orchestrator-goal.md`
- `docs/orchestration/migration-completion-audit.md`
- `docs/pro-reviews/burette-writer-computer-pro-review-2026-05-09.raw.md`
- `SPECs/writer-originals/`
- `docs/writer-originals/`

## Phases

1. Baseline specs and invariants.
2. Writer-like default shell.
3. Writer-like tabs, sidebar, stage, and command palette.
4. Store and hook restructure.
5. Rust/Tauri modularization.
6. Specs, docs, and test hardening.
7. Repository skeleton migration toward `apps/desktop`.
8. Packaging, release, and update alignment.
9. End-to-end product validation.

## Current Status

- Phase 1/2 shell slice is in progress: Burette now has Writer-like top tabs,
  sidebar chrome, welcome actions, and a command palette scaffold.
- Phase 4 has started in a narrow way: command palette open/search state lives
  in a Writer-style `ui-store` with a `use-command-palette` hook, and sidebar
  width is persisted in the shell store. Molecule documents and active tab state
  now live in a separate `molecule-store` behind Writer-style `use-tabs`
  selectors. Viewer preferences now live in `settings-store` behind
  `use-settings`; sidebar/chrome state lives in `shell-store` behind
  `use-sidebar`.
- A focused `test:ui` migration guard checks the Writer-like shell contracts and
  is wired into `scripts/ci.sh`.
- A focused `test:tauri-structure` migration guard checks the modular Tauri
  command boundary and is wired into `scripts/ci.sh`.
- Component organization now mirrors Writer's desktop surface more closely:
  `components/editor-area`, `components/sidebar`, `components/settings-panel`,
  and `components/command-palette`.
- The shell now includes Writer-style skeleton pieces for
  `components/welcome`, `components/error-boundary.tsx`,
  `components/scroll-fade.tsx`, and `components/editor-area/page-kinds`.
  Active stage rendering is dispatched through launcher, settings, and
  file/molecule page kinds instead of inline viewer branching.
- Visual parity has moved closer to Writer's shell tokens: Hugeicons are used
  for Writer-matching sidebar/search iconography, Writer-style text controls
  are used in tab history/new/close chrome, heavy Burette-specific dark panels
  were replaced with Writer-style translucent overlays, and the extra topbar
  `Open` button plus bottom statusbar chrome were removed from the default
  shell view.
- The molecule shell store now has a Writer-like tab/session layer:
  launcher/settings/file tabs are modeled as `id + location + back + forward`,
  active stage rendering comes from the active tab, and session snapshots are
  serialized through the page-kind registry.
- Persisted file tabs now trigger startup regeneration through Tauri
  `open_documents` by source path, reducing dependence on stale preview cache
  runtime paths.
- Writer-like tab history controls are now present in the top chrome and wired
  to each tab's `back`/`forward` location stacks.
- Frontend files now live under `apps/desktop`, with root npm wrappers delegating
  to the desktop package.
- A Writer-compatible `pnpm-workspace.yaml` now records the target workspace
  shape (`apps/*`, `packages/*`, and `tools/*`) while the verified build path
  remains npm-based until package-manager migration is deliberate.
- Tauri now lives under `apps/desktop/src-tauri` and consumes
  `apps/desktop/dist`; `scripts/build.sh` embeds the Quick Look extension from
  the root Xcode project into the moved Tauri app bundle.
- Rust/Tauri has been split into a small `lib.rs` entrypoint plus focused
  `commands/`, `menu.rs`, `startup.rs`, and `preview/` runtime boundaries.
  Stable IPC command names are preserved while implementations live in
  `commands/startup.rs`, `commands/documents.rs`,
  `commands/preview_cache.rs`, `commands/shell.rs`, and
  `commands/quicklook.rs`. Preview generation is now split into
  `preview/runtime.rs` as the API coordinator, `preview/runtime_grid.rs` for
  grid parsing/runtime generation, `preview/runtime_viewer.rs` for normal
  viewer runtime/assets, and `preview/runtime_utils.rs` for shared helpers.
  Format resolution, XYZ parsing, and external xyzrender execution remain in
  dedicated preview modules.
- Migration documentation now includes `docs/architecture.md`,
  `docs/renderer-support.md`, `docs/quicklook-debugging.md`, and
  `docs/releasing.md`.
- Writer Computer's original specs and docs are vendored as local reference
  snapshots under `SPECs/writer-originals/` and `docs/writer-originals/`; active
  Burette specs remain adapted files outside those reference directories.
- The shell now has Writer-style frontend decomposition for menu events,
  startup/open events, drag/drop, and window title handling. Recent structures
  are persisted in the molecule session store and exposed through the sidebar
  and command palette.
- Sidebar bottom chrome now matches Writer's single compact switcher row and
  switcher glyph while Settings, Logs, and Quick Look reset remain available
  from Settings and the command palette. The command palette also exposes
  explicit `Open Recent:` and `Open Structure:` dynamic entries in addition to
  the required molecular commands.
- The command palette now groups empty-query actions into Writer-like
  `Suggested`, `Renderer`, `Recent`, and `Open` sections; filtered results use a
  single `Results` section.
- Development builds now show a worktree-specific `Burette Dev 8a18` label in
  the window title and sidebar footer, while production builds keep the product
  name `Burette`. The suffix can be overridden with
  `VITE_BURETTE_DEV_INSTANCE` for parallel test instances. The label is kept out
  of the top chrome so Writer Computer's tab strip geometry remains unchanged.
- Molecular viewer pages now reserve the Writer-like top chrome area before
  rendering the iframe, so Mol* controls do not stack under the tabs/titlebar.
  The generated in-app Mol* toolbar CSS now uses the same compact translucent
  control pattern as the shell. The Mol* toolbar now defaults to a collapsed
  icon-only state, expands on hover/focus, and no longer exposes old text-only
  `L/R/Seq/Log/Light/VESTA` controls.
- Settings controls now follow the Writer pattern more closely: automatic
  update checks use a compact switch, selects use the shared translucent input
  surface, and action buttons share a single visual class.
- The active stage now renders through a Writer-like page stack and honors
  `pageKind.keepAlive`, keeping molecular file iframes mounted across tab
  switches instead of recreating the renderer on every activation.
- The latest Mol* shell/runtime slice has passed the full local bundle gate:
  `./scripts/build.sh`, `codesign --verify --deep --strict build/Burrete.app`,
  and embedded `BurretePreview.appex` presence. `scripts/build.sh` now also
  checks the final bundled `Resources/Web/index.html` so legacy text toolbar
  controls cannot silently re-enter the packaged app.
- The current migration audit is recorded in
  `docs/orchestration/migration-completion-audit.md`. It marks the repo layout,
  shell, stores, command palette, Mol* inset, and bundle build as covered, but
  keeps the overall goal open until installed Finder Quick Look preview can be
  run in a coordinated single-instance pass and stronger visual parity checks
  are completed.
- Swift, Quick Look, package manager, Xcode project, install scripts, and
  vendored preview assets remain root-owned Burette boundaries.

## Next Slice

The next implementation slice should deepen Writer parity without moving Quick
Look or Xcode assets:

- Continue sidebar and settings visual parity.
- Install the built app and run forced Finder Quick Look previews against
  representative fixtures after the current migration changes.
- Compare the running shell against Writer reference screenshots/running Writer
  to close visual parity evidence beyond static contract tests.
- Add stronger browser/e2e coverage for restored molecular sessions and tab
  history once sample-file automation is stable.
- Add deeper interaction tests once the shell layout stabilizes.
- Add real browser/e2e tests around recent structures once a stable browser
  harness is available for local URLs.
- Add stronger behavior coverage for grid runtime parsing and viewer runtime
  artifact generation after the Rust module split.

## Verification Bias

Frontend-only phases use lightweight JS/build checks. Any phase that touches
Tauri config, Rust runtime, Swift extension, vendored assets, build scripts, or
bundle layout must include macOS build/install and Quick Look checks.
