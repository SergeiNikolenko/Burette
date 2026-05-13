# Writer Full Transplant Migration Plan

## Goal

Replace Burrete's current app skeleton with Writer Computer's skeleton while
preserving Burrete's molecular preview product behavior. The result should be a
single Writer-style Tauri/React/Rust/macOS application, not a hybrid of two app
architectures.

## Initial Branch

Use a dedicated migration worktree or branch:

```bash
git switch -c migrate/writer-skeleton
```

The migration should be developed as a large transplant branch, then split into
reviewable commits after the app builds and the old architecture is removed.

## Implementation Order

1. Import Writer root workspace files and docs.
2. Move Burrete into `apps/desktop`.
3. Make build scripts work with the new paths.
4. Copy Writer desktop shell and replace Burrete shell.
5. Mount Burrete molecule viewer in the Writer center pane.
6. Copy Writer stores/hooks/backend structure.
7. Move molecular Rust code into `apps/desktop/src-tauri/src/molecule`.
8. Copy/adapt every Writer spec into `SPECs/`.
9. Reconcile Quick Look/Xcode paths.
10. Delete legacy root-level app code.
11. Run full validation.

## Current Audit Status

- `pnpm-lock.yaml` is the authoritative workspace lockfile. The release check
  validates root package metadata, `apps/desktop/package.json`,
  `apps/desktop/src-tauri/tauri.conf.json`, and required desktop Rust crates.
- There are no legacy root-level `src` or `src-tauri` app directories left in
  the working tree. Remaining `src-tauri` references are expected path
  references to `apps/desktop/src-tauri`, copied Writer originals, migration
  specs, or historical notes.
- Development previews must not compete with other agents' app instances. Use
  worktree-specific Vite ports and visible instance names, and only launch a
  native app through `./scripts/open-dev-app.sh` when native verification is
  required.

## Current Ported Backbone

- The frontend shell, sidebar, tabs, command palette, settings surface, and
  welcome screen now follow Writer's compact macOS workspace structure while
  routing actions into Burrete molecular files and viewers.
- The Tauri command layer now follows Writer's
  `apps/desktop/src-tauri/src/commands/*` layout without changing existing IPC
  command names.
- OS-level file opening now flows through
  `apps/desktop/src-tauri/src/open_target.rs`, which accepts molecular
  structure files and folders while rejecting unsupported files before they
  reach the viewer.
- Renderer and shell settings now use Writer's shared schema shape at
  `apps/desktop/shared/settings.schema.json` with Burrete-specific defaults.
- Writer's Markdown-specific ProseMirror, frontmatter, Mermaid, wiki-link,
  image paste, and editor watcher internals remain disabled unless a future
  Burrete spec defines a molecular equivalent. This is an explicit product
  decision, not an untracked omission.

## Validation Commands

```bash
pnpm install
pnpm run check:js
pnpm run check:release
pnpm run test:agent
pnpm run test:web
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
./scripts/doctor.sh
./scripts/build.sh
# Run only when native Quick Look validation is required:
./scripts/install.sh
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif
./scripts/force-preview.sh samples/mini.xyz
```

Latest non-native validation completed in this worktree:

- `pnpm exec tsc -p apps/desktop/tsconfig.json --noEmit`
- `pnpm run check:release`
- `pnpm --filter @burrete/desktop build:web`
- `cargo test` in `apps/desktop/src-tauri`
- `./scripts/doctor.sh`
- `./scripts/build.sh`
- `codesign --verify --deep --strict build/Burrete.app`

Quick Look validation after the latest UTI/export changes still requires an
install-time run. Do not count the full migration complete until PDB, CIF, XYZ,
and SDF forced previews have been rechecked after install.

## Completion Criteria

- The repository root follows Writer's workspace structure.
- `apps/desktop` is the only desktop Tauri app source.
- The desktop shell is Writer's shell.
- Burrete molecular viewer, renderer policy, Quick Look runtime, and sample
  previews still work.
- Old root `src` and `src-tauri` directories are gone.
- `docs/specs/writer-computer-spec-adaptation.md` is no longer the planning
  source of truth.
- `SPECs/full-writer-transplant-spec.md` and
  `SPECs/writer-feature-port-map.md` define the migration contract.
