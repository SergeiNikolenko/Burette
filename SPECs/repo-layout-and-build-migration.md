# Repository Layout And Build Migration

## Summary

Burette should eventually adopt Writer's repository organization while preserving
macOS packaging and Quick Look.

## Target Shape

- Root orchestration files.
- `apps/desktop/` owns the React desktop frontend.
- `apps/desktop/src-tauri/` owns the Tauri desktop shell.
- Root `App/`, `PreviewExtension/`, `Burrete.xcodeproj`, `scripts/`, `samples/`,
  `docs/`, and `SPECs/` remain accessible.
- Build and install scripts understand the moved Tauri paths.

## Phasing

1. Keep root Tauri/Quick Look/macOS layout for shell and interaction migration.
2. Stabilize frontend stores and command boundaries.
3. Move frontend files to `apps/desktop` with root npm wrappers.
4. Modularize Rust/Tauri code into command, menu, startup, and preview runtime
   modules.
5. Move Tauri to `apps/desktop/src-tauri` with build script updates in the
   same phase.
6. Align package manager and release scripts.

The repository now includes a Writer-compatible `pnpm-workspace.yaml` as the
target workspace manifest. Current verified build and CI commands still use npm
until a later package-manager phase can switch installers without weakening
Quick Look packaging checks.

## Acceptance Criteria

- No layout phase is complete until `./scripts/build.sh` passes.
- The app bundle still includes `Contents/PlugIns/BurretePreview.appex`.
- CI and release paths point to Burette artifacts, not Writer artifacts.
- Tauri builds from `apps/desktop/src-tauri` and consumes
  `apps/desktop/dist`.
- `pnpm-workspace.yaml` describes the intended Writer-style workspace shape
  (`apps/*`, `packages/*`, and `tools/*`) without changing the current npm
  verification path.
- Tauri entrypoint stays thin; IPC commands live under `commands/`, native menu
  routing in `menu.rs`, startup/open routing in `startup.rs`, and molecular
  preview generation stays under `preview/`.
- Command modules stay grouped by shell responsibility:
  `commands/startup.rs`, `commands/documents.rs`,
  `commands/preview_cache.rs`, `commands/shell.rs`, and
  `commands/quicklook.rs`.
- `preview/runtime.rs` stays the stable document-open API coordinator while
  grid runtime generation, normal viewer runtime generation, shared helpers,
  format resolution, XYZ parsing, and external xyzrender execution live in
  focused sibling modules.
