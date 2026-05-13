# Writer Computer Turnkey Migration Orchestrator Goal

## Objective

Run the full Burette migration so Writer Computer becomes the product skeleton, interface baseline, repository structure reference, documentation/spec system, and app-shell model for Burette, while Burette's molecular preview engine and macOS Quick Look extension remain functional.

The intended product outcome is not a light restyle. Burette should default to a Writer-like interface and project organization: macOS transparent shell, Writer-style sidebar, top tabs, command palette, settings, theme system, docs, specs, release/build discipline, and eventually the `apps/desktop` monorepo shape. The markdown/workspace/editor logic from Writer must be removed or replaced with Burette-specific molecule/session/viewer logic.

Use these source plans:

- `docs/pro-reviews/burette-writer-computer-pro-review-2026-05-09.raw.md`
- `docs/pro-reviews/burette-writer-computer-pro-review-2026-05-09.md`

Use these source repositories as references:

- Burette: `https://github.com/SergeiNikolenko/Burrete`
- Writer Computer: `https://github.com/joelbqz/writer-computer`

## Licensing Decision

GPL-3.0 compatibility is not a blocker for this migration. The user explicitly accepts using Writer Computer as the working baseline and will fix or change Burette's license later if needed. Do not stop or reduce the migration because of GPL-3.0 concerns. Still track copied/adapted Writer-originated areas in docs so the later license update is straightforward.

## Final Product Definition

By the end of the migration, Burette should have:

- Writer-style app chrome, sidebar, top tab strip, command palette, settings, translucent theme, keyboard flow, and interaction model.
- Writer-style tab architecture, but with molecule/viewer/settings/launcher tabs instead of markdown document tabs.
- Writer-style sidebar architecture, but with open structures, recent structures, renderer badges, file metadata, and app utility actions instead of workspace file-tree CRUD.
- Writer-style command palette, but with molecular commands: open structures, search open structures, switch renderer, settings, reset Quick Look, clear cache, open logs, check updates.
- Writer-style specs/docs organization with `SPECs/` and `docs/` as first-class planning and operational references.
- A staged path to Writer's monorepo shape: root orchestration plus `apps/desktop`.
- Preserved Burette molecular engine: Mol* 3D, fast XYZ SVG, external xyzrender, and RDKit-style grids.
- Preserved macOS Quick Look extension behavior and validated Finder preview path.

## Non-Negotiable Product Invariants

- Preserve the Swift Quick Look extension behavior through every phase.
- Preserve existing molecular preview paths: Mol* 3D, fast XYZ SVG, external xyzrender, and RDKit-style grids.
- Preserve or deliberately migrate bundle identifiers and forced Quick Look content types. Never churn them accidentally.
- Keep Quick Look extension registration and `qlmanage` verification first-class.
- Keep `open_documents`, `startup_documents`, `clear_preview_cache`, `reset_quick_look`, `open_logs_folder`, and `open_external_url` stable until a deliberate API migration exists.
- Do not replace Burette's molecule engine with Writer's markdown/workspace engine.
- Do not finish on a pretty web shell that breaks Finder previews.

## Orchestration Rules

- Work in staged phases with verification gates. Do not combine unrelated migrations into one unreviewable patch.
- Use subagents by default for scout, implementation, verification, and review tracks.
- Keep final integration decisions in the orchestrator.
- Prefer separate worktrees or branches for high-risk phases.
- Preserve current behavior before reorganizing files.
- When a phase touches build scripts, Tauri config, Swift extension, bundle paths, or file associations, run macOS-specific checks before declaring that phase done.
- Record design and operational decisions in `SPECs/` or `docs/`, not only in chat.

## Swarm Roles

### Architecture Scout

Inspect both repositories and maintain the source-to-target mapping:

- Writer `apps/desktop/src/components/app-layout.tsx`
- Writer `apps/desktop/src/App.css`
- Writer command palette, sidebar, tabs, settings, stores, hooks
- Writer `package.json`, `pnpm-workspace.yaml`, `docs/`, `SPECs/`, `scripts/distribute.sh`
- Burette `apps/desktop/src/`, `apps/desktop/src-tauri/`, `PreviewExtension/`, `App/`, `scripts/`, `docs/specs/`

Output a short phase-specific mapping before each implementation phase.

### Specs And Docs Worker

Create and maintain the migrated documentation/spec system:

- `SPECs/shell-parity-with-writer.md`
- `SPECs/molecule-session-model.md`
- `SPECs/quicklook-extension-boundary.md`
- `SPECs/renderer-runtime-contract.md`
- `SPECs/repo-layout-and-build-migration.md`
- `SPECs/command-palette.md`
- `SPECs/settings-and-theme-system.md`
- `SPECs/release-and-signing.md`
- `docs/architecture.md`
- `docs/quicklook-debugging.md`
- `docs/renderer-support.md`
- `docs/releasing.md`
- `docs/migration-roadmap.md`

These files must describe the target Writer-like behavior and the Burette-specific substitutions.

### UI Shell Worker

Implement Writer-like app chrome and default interface:

- Transparent macOS HUD-style shell.
- Writer-like drag region and traffic-light-aware layout.
- Sidebar toggle near traffic lights.
- Floating top tab strip.
- Resizable sidebar.
- Main stage.
- Writer-like CSS tokens, surfaces, text colors, scrollbars, and focus behavior.

This worker must make the default interface visually and structurally match Writer as closely as possible.

### Tabs And Stage Worker

Replace Burette's current viewer/page coordination with Writer-like tab routing:

- Molecule tabs.
- Settings tab.
- Launcher/welcome tab.
- Keep-alive viewer behavior where useful.
- Active molecule stage using the existing iframe runtime.
- Renderer/status/footer controls where appropriate.

The result should feel like Writer's tabbed editor area, but with molecular viewer semantics.

### Sidebar Worker

Replace Writer file-tree semantics with Burette molecule semantics while keeping Writer-like visual behavior:

- Search/open command affordance.
- Open structures section.
- Recent structures section.
- Renderer badges.
- File extension, renderer, byte count, and close controls.
- Settings/logs/Quick Look footer actions.

Do not implement markdown workspace CRUD as Burette product behavior.

### Command Palette Worker

Implement Writer-style command palette and keyboard flow:

- Open Structure
- Search Open Structures
- Settings
- Renderer Auto
- Renderer Mol*
- Renderer Fast XYZ
- Renderer xyzrender external
- Clear Preview Cache
- Reset Quick Look
- Open Logs Folder
- Check for Updates
- Close Active Structure
- Close All Structures

Wire commands to existing Burette actions first. Add backend commands only when necessary.

### Store And Hooks Worker

Move toward Writer-like state boundaries:

- `molecule-store`
- `tabs-store`
- `settings-store`
- `ui-store`
- `use-keyboard-shortcuts`
- `use-menu-events`
- `use-open-drop`
- `use-command-palette`

Preserve persisted preferences and current behavior during the transition.

### Rust/Tauri Worker

Refactor Burette's Rust code only after UI behavior is stable:

- `commands/documents.rs`
- `commands/preview_cache.rs`
- `commands/quicklook.rs`
- `commands/shell.rs`
- `preview/runtime.rs`
- `preview/formats.rs`
- `preview/grid.rs`
- `preview/xyz.rs`
- `preview/assets.rs`
- `menu.rs`
- `macos.rs`

Keep command names and serialized contracts stable unless a migration plan and frontend update exist in the same phase.

### Repo Skeleton Worker

Migrate toward Writer's repository skeleton after earlier phases pass:

- root `package.json` orchestration
- `pnpm-workspace.yaml`
- `apps/desktop`
- desktop package scripts
- Vite+/Tailwind conventions if adopted
- script path updates
- CI updates

This is a later phase, not the first UI patch.

### Release And Packaging Worker

Align release/build/update discipline with Writer while preserving Burette identity:

- Build Tauri app.
- Build and embed Quick Look `.appex`.
- Preserve app and extension identifiers unless deliberately migrated.
- Sign app and extension.
- Keep update checks pointed to Burette releases.
- Keep release version synchronization.
- Prepare later license alignment.

### Verification Worker

Own the verification matrix and run or request the right checks per phase:

- JS syntax/build checks.
- Tauri build checks.
- Rust checks.
- macOS build/install checks.
- Quick Look forced preview checks.
- Codesign checks.
- UI smoke checks.

### Reviewer

Review every implementation phase for:

- Broken Quick Look boundaries.
- Lost molecular preview functionality.
- Accidental markdown/workspace behavior leaking into Burette.
- Incomplete tab/sidebar/command palette parity.
- Build script path regressions.
- Tauri config identity/resource mistakes.
- Missing docs/spec updates.

## Phase Plan

### Phase 0: Baseline And Spec Import

Goal: establish the full migration contract.

Tasks:

- Read the Pro review.
- Inspect current Burette and Writer source.
- Create the `SPECs/` directory if absent.
- Port/adapt Writer-style specs into Burette-specific specs.
- Create `docs/migration-roadmap.md`.
- Record non-negotiable Quick Look and molecular runtime invariants.
- Record the license decision: Writer may be used as baseline; later license cleanup is accepted.

Verification:

```bash
npm run check:js
npm run test:agent
git status --short
```

### Phase 1: Writer-Like Default UI Shell

Goal: make the app look and feel like Writer by default without moving repo layout.

Tasks:

- Rework app shell geometry to match Writer.
- Implement Writer-like sidebar/tabs/stage layout.
- Port/adapt Writer CSS token system and translucent surfaces.
- Keep Burette actions and current store wiring.
- Do not touch Rust, Swift, Quick Look, package manager, or build scripts.

Verification:

```bash
npm run check:js
npm run build:web
npm run test:agent
```

If app runtime changed materially:

```bash
npm run build:tauri
```

### Phase 2: Writer-Style Tabs, Stage, Sidebar, And Command Palette

Goal: complete the visible Writer-like interaction model.

Tasks:

- Add Writer-like command palette.
- Add molecule/viewer/settings/launcher tabs.
- Rework sidebar to Writer-like molecule browser.
- Add renderer badges and molecule metadata.
- Add keyboard shortcuts aligned with Writer where useful.
- Ensure default app opening shows Writer-like shell, not a landing page.

Verification:

```bash
npm run check:js
npm run build:web
npm run test:agent
```

Manual smoke:

- open app
- open molecule
- switch molecule tab
- open settings tab
- run command palette actions
- drag/drop files

### Phase 3: Store And Hook Restructure

Goal: make the frontend architecture match Writer patterns.

Tasks:

- Split current store into molecule/tabs/settings/ui stores.
- Extract menu/drop/keyboard/command hooks.
- Keep persisted preferences compatible or provide explicit migration.
- Keep existing Tauri command API stable.

Verification:

```bash
npm run check:js
npm run build:web
npm run test:agent
```

### Phase 4: Rust/Tauri Modularization

Goal: turn the Burette backend into a Writer-quality module layout without behavior changes.

Tasks:

- Split `apps/desktop/src-tauri/src/lib.rs` into command and preview modules.
- Add unit tests for parsers, renderer policy, file argument handling, URL restrictions, and size limits.
- Keep command names stable.

Verification:

```bash
cd apps/desktop/src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cd ..
npm run build:tauri
```

### Phase 5: Full Docs, Specs, And Test Coverage

Goal: make the migrated product contract durable.

Tasks:

- Finish all `SPECs/`.
- Finish `docs/architecture.md`.
- Finish `docs/renderer-support.md`.
- Finish `docs/quicklook-debugging.md`.
- Expand tests for command palette/store/renderer behavior.
- Add release/version checks if missing.

Verification:

```bash
npm run check:js
npm run test:web
npm run test:agent
```

### Phase 6: Writer Repository Skeleton Migration

Goal: migrate toward Writer's monorepo structure after UI and engine behavior are stable.

Tasks:

- Create root workspace orchestration.
- Add `apps/desktop`.
- Move frontend/Tauri files under `apps/desktop`.
- Update Vite, TypeScript, Tauri, and script paths.
- Update build/install scripts for new paths.
- Keep `App/`, `PreviewExtension/`, `Burrete.xcodeproj`, `scripts/`, `samples/`, and root docs/specs reachable.
- Preserve vendored molecular asset paths or migrate them deliberately.

Verification:

```bash
npm run check:js
npm run build:web
npm run build:tauri
./scripts/build.sh
```

### Phase 7: Packaging, Release, And Update Alignment

Goal: align release discipline with Writer while preserving Burette identity.

Tasks:

- Adapt release docs.
- Adapt release scripts.
- Preserve Burette GitHub release/update endpoint.
- Preserve app and extension signing.
- Prepare license update follow-up.
- Confirm embedded Quick Look extension in final app bundle.

Verification:

```bash
./scripts/build.sh
./scripts/install.sh
codesign --verify --deep --strict build/Burrete.app
test -d build/Burrete.app/Contents/PlugIns/BurretePreview.appex
```

### Phase 8: End-To-End Product Validation

Goal: prove the migrated product works as the new default.

Verification:

```bash
npm run check:js
npm run test:web
npm run test:agent
npm run build:tauri
./scripts/build.sh
./scripts/install.sh
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif
./scripts/force-preview.sh samples/mini.xyz
```

Manual validation:

- Launch app.
- Confirm Writer-like default interface.
- Open PDB, CIF, XYZ, SDF, SMILES/CSV/TSV samples.
- Switch molecule tabs.
- Use command palette.
- Change renderer preferences.
- Clear cache.
- Reset Quick Look.
- Open logs.
- Relaunch and verify preferences persist.
- Verify Finder Quick Look previews render.

## Stop Conditions

Stop and report if:

- Quick Look extension no longer registers.
- Finder preview fails for baseline PDB/CIF/XYZ samples.
- A phase requires changing bundle identifiers or content types.
- Package-manager migration breaks build scripts in a way that cannot be fixed in the same phase.
- The migrated UI stops opening molecular files.

## Turnkey Orchestrator Prompt

You are the implementation orchestrator for the Burette Writer Computer migration. Treat Writer Computer as the desired product skeleton and default interface baseline. Read `docs/pro-reviews/burette-writer-computer-pro-review-2026-05-09.raw.md` and execute the full staged migration under `docs/orchestration/writer-computer-migration-orchestrator-goal.md`. Use subagents for scouting, implementation, verification, and review. The final product should look and behave like Writer by default, including sidebar, top tabs, command palette, settings, theme/chrome, docs/spec discipline, and eventually repo skeleton, but with Burette's molecular preview engine replacing Writer's markdown/workspace/editor engine. GPL-3.0 is not a blocker; track copied/adapted Writer-originated areas for later license cleanup. Preserve Quick Look and molecular rendering through every phase. Do not declare completion until the full verification matrix passes or a precise blocker is documented.
