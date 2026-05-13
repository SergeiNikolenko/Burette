# Full Writer Transplant Spec

## Summary

Burrete will adopt Writer Computer as the primary application skeleton, package
layout, desktop shell, workflow, and engineering convention set. This is a
transplant, not a visual reskin. The migrated app should feel structurally like
Writer from repository root to desktop UI, while Burrete remains authoritative
for molecular preview behavior, Quick Look integration, renderer runtimes,
native bundle identity, file associations, samples, and release validation.

The author has granted permission to use Writer Computer as the basis for this
migration, so the migration may copy Writer source where useful. License and
attribution still need to be recorded in repository metadata and release notes.

## Product Decision

Use a Writer-first branch/worktree:

1. Start from the existing Burrete repository identity.
2. Import Writer root layout, workspace tooling, app shell, desktop frontend,
   Tauri backend organization, docs structure, and specs.
3. Move Burrete molecular functionality into that skeleton.
4. Delete the old Burrete shell and duplicated architecture after parity is
   proven.

The end state must not contain two competing app structures. There should be
one Writer-style desktop app with Burrete molecular capabilities.

## Non-Negotiables

- Keep the product name `Burrete`.
- Keep the Tauri app identifier `com.local.BurreteV10`.
- Keep the Quick Look extension bundle identifier
  `com.local.BurreteV10.Preview`.
- Keep forced preview content types:
  - `com.local.burrete10.pdb`
  - `com.local.burrete10.cif`
- Preserve Finder Quick Look previews independent of the Tauri window.
- Preserve Mol* 3D, fast XYZ, external `xyzrender`, RDKit grids, molecular file
  detection, cache/runtime generation, logs, and sample coverage.
- Do not make the Quick Look extension depend on Vite, the Tauri dev server, or
  a running desktop app.
- Do not leave old root-level `src` / `src-tauri` app code after the transplant
  is complete.

## Target Repository Shape

```text
Burrete/
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  tsconfig.json
  vite.config.ts
  AGENTS.md
  DESIGN.md
  README.md
  CHANGELOG.md
  LICENSE
  THIRD_PARTY_NOTICES.md
  SPECs/
  docs/
    workflows/
  apps/
    desktop/
      package.json
      index.html
      vite.config.ts
      tsconfig.json
      src/
      shared/
      tests/
      e2e/
      src-tauri/
    website/
  native/
    App/
    PreviewExtension/
    Burrete.xcodeproj/
  scripts/
  samples/
  tests/
```

If moving `App/`, `PreviewExtension/`, or `Burrete.xcodeproj/` into `native/`
causes too much Xcode project churn in the first migration pass, keep them at
the repository root temporarily. The final architecture should still separate
the Writer-style desktop app from the native Quick Look layer.

## Writer Code To Bring Over

Bring the Writer implementation across as the default unless a Burrete
non-negotiable directly conflicts with it:

- root `pnpm` workspace and `vp` workflow
- `apps/desktop` structure
- `apps/website` structure if the product website is retained
- `docs/` and `docs/workflows/`
- `SPECs/`
- desktop `App.tsx` composition
- `App.css` shell tokens and window chrome
- app layout, window title, welcome, settings panel, sidebar, command palette
- editor tab shell, page kinds, search UI, context menu patterns, drag/drop
- hooks for workspaces, tabs, sidebar, theme, menu events, keyboard shortcuts,
  file watcher, command palette, open drop, and scroll behavior
- Zustand stores and settings schema pattern
- shared themes
- Tauri `state`, `watcher`, `open_target`, `updater`, `commands`, `config`,
  `error`, CLI, shell install, startup, settings, filesystem and search module
  organization
- tests and e2e smoke structure
- release, worktree, and agent workflow docs

Markdown-specific code should be transformed into molecule-specific behavior,
not left as dead markdown functionality.

## Burrete Code To Preserve And Move

Preserve these as domain authority:

- `App/` Swift menu bar and native app behavior
- `PreviewExtension/` Swift Quick Look extension
- `PreviewExtension/Web/` runtime assets and renderer HTML/JS/CSS
- `Burrete.xcodeproj/`
- `apps/desktop/src-tauri/src/lib.rs` molecular commands and runtime generation logic
- Tauri capabilities and permissions that permit Burrete resource/cache access
- vendoring scripts for Mol* and RDKit
- build/install/diagnostic/Quick Look force-preview scripts
- samples and web/agent tests
- `THIRD_PARTY_NOTICES.md`

During transplant, split the current domain-heavy Tauri code into Writer-style
modules under `apps/desktop/src-tauri/src/molecule/`.

## Feature Translation

| Writer feature | Burrete target |
| --- | --- |
| Markdown workspace | Molecular workspace or recent molecular folder |
| Markdown document | Molecular document: path, format, renderer, runtime URL, metadata |
| Editor pane | Molecule viewer area |
| Editor tabs | Molecule tabs |
| New tab recent files | Recent structures and folders |
| Sidebar file tree | Molecular file browser with format badges |
| Command palette | Molecular commands and app commands |
| `Cmd+F` editor search | Grid/search-in-current-viewer where applicable |
| Fuzzy search grep | Molecular path search first, optional metadata/text search later |
| Tags | Molecule labels, dataset tags, or file-derived annotations |
| Inline media preview | Inline molecule/asset preview where relevant |
| Mermaid widgets | Disabled until Burrete has a molecular notebook/document surface |
| Frontmatter/date/wiki links | Disabled unless a notes/specs workspace surface is added |
| External file watcher | Re-render and cache invalidation watcher |
| Workspace snapshot | Molecular snapshot keyed by path and stable file identity |
| Multi-window | Multiple molecule workspaces/windows if safe with Quick Look |
| Writer CLI | `burrete` CLI for opening, validating, previewing, and diagnosing molecules |
| Install CLI menu item | Install `burrete` CLI menu item |
| Updater/release flow | Burrete identity and release artifacts using Writer structure |

## Migration Phases

### Phase 0: Capture Baseline

Create or update the migration specs before moving code.

Verification:

```bash
pnpm run check:js
pnpm run check:release
pnpm run test:agent
pnpm run test:web
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
./scripts/doctor.sh
./scripts/build.sh
```

### Phase 1: Import Writer Root Skeleton

Copy/adapt Writer root files:

- `package.json`
- `pnpm-workspace.yaml`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `vite.config.ts`
- `docs/`
- `docs/workflows/`
- `SPECs/`
- `scripts/worktree.sh`

Keep Burrete identity and notices. Update scripts to operate on the new layout.

### Phase 2: Move Burrete Into Writer Layout

Move:

```text
src/       -> apps/desktop/src/
src-tauri/ -> apps/desktop/src-tauri/
index.html -> apps/desktop/index.html
```

Create `apps/desktop/package.json` and update Tauri paths. Keep app behavior
unchanged in this phase.

### Phase 3: Replace Shell With Writer Shell

Copy/adapt Writer desktop shell:

- `apps/desktop/src/App.tsx`
- `apps/desktop/src/App.css`
- `components/app-layout.tsx`
- `components/window-title/`
- `components/welcome/`
- `components/settings-panel/`
- `components/sidebar/`
- `components/command-palette/`
- `components/editor-area/` shell pieces that become molecule tabs/viewer area
- hooks and stores needed by the shell

The center pane becomes Burrete's molecule viewer. Markdown editor internals
must not remain user-facing unless explicitly repurposed.

### Phase 4: Port Writer Backend Features

Bring Writer backend structure and adapt commands:

- `state.rs`
- `watcher.rs`
- `open_target.rs`
- `updater.rs`
- `writer_cli.rs` renamed or replaced by `burrete_cli.rs`
- `commands/*`
- `config.rs`
- `error.rs`

Add:

```text
apps/desktop/src-tauri/src/molecule/
  formats.rs
  runtime.rs
  grid.rs
  molstar.rs
  xyz.rs
  xyzrender.rs
  quicklook.rs
```

### Phase 5: Port All Relevant Writer Specs And Features

Every Writer spec must be copied into `SPECs/` or represented by a Burrete
adaptation. Specs that are not useful for molecular preview must be explicitly
marked disabled/deferred, not silently omitted.

### Phase 6: Native Quick Look Reconciliation

Keep native code authoritative. Update Xcode/build paths only after the desktop
layout is stable. Validate:

- extension embedded in the final app
- app and extension bundle identifiers
- content types
- codesigning
- vendored web assets
- Finder Quick Look behavior

### Phase 7: Delete Legacy Architecture

Remove:

- old root `src/`
- old root `src-tauri/`
- duplicated CSS/components
- obsolete npm-only lockfile if `pnpm` is the source of truth
- old docs/specs that conflict with the full Writer transplant
- any dead markdown-editor user surface that is not intentionally retained

## Acceptance Criteria

- Repository shape matches Writer conventions.
- Desktop UI shell visually matches Writer.
- Command palette, sidebar, tabs, settings, themes, watcher, recent files,
  workspace model, CLI, updater structure, docs, specs, and tests are carried
  over or explicitly adapted.
- Burrete molecular previews still work in desktop and Finder Quick Look.
- The Quick Look extension works without the desktop app running.
- `com.local.BurreteV10` and `com.local.BurreteV10.Preview` are unchanged.
- All migration specs are present in `SPECs/`.
- Old Burrete shell code is removed after parity.
