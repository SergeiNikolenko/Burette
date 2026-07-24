# Performance Architecture

Burette optimizes the normal desktop app and Finder Quick Look as separate
runtime paths. The desktop shell remains a visible macOS app. Quick Look remains
the fast Finder preview path. Shared web assets are reused where possible, but
runtime generation, caches, and diagnostics are scoped to the caller.

## Runtime Boundaries

- Desktop runtimes are created by the Tauri preview service under the app cache
  directory, below `viewer/`.
- Quick Look runtimes are created by the Swift extension in its own extension
  cache container.
- The desktop path may use Tauri IPC and SQLite-backed stores.
- The Quick Look path cannot depend on desktop process state and keeps Swift
  fallbacks for bundled helper failures.

Do not make normal app launch hidden to improve cold-start numbers. Registration
or maintenance launches can opt into `BURETTE_LAUNCH_MODE=register`, but user
launch, file-open launch, tray click, and menu activation must show the app.

## Asset Profiles

The profile manifest lives at `config/web-runtime-profiles.json`. It is the
source of truth for which web assets belong to each runtime family.

Current profiles:

- `desktop-molstar`: Mol* viewer shell assets for desktop structure previews.
- `desktop-grid`: grid viewer, grid CSS, and RDKit JS/WASM for desktop
  collection previews.
- `quicklook-molstar`: Mol* viewer shell assets for Finder previews.
- `quicklook-grid`: grid viewer, grid CSS, and RDKit JS/WASM for Finder grid
  previews.
- `external-artifact`: minimal viewer shell assets for already-rendered
  external SVG artifacts.

`scripts/check-vendor-assets.mjs` validates vendored assets and the profile
manifest. `scripts/size-report.sh` prints profile sizes and asset membership so
large duplicated files have an explicit explanation.

## Runtime Cache Layout

Desktop generated preview runtimes use the app cache directory:

```text
<app-cache>/viewer/
  assets/
  <runtime-id>/
    index.html
    manifest.json
    preview-config.js
    preview-data.bin
    xyzrender.svg
    xyzrender.log
  xyzrender-cache/
```

The `assets/` directory is shared across generated desktop runtimes. Runtime
directories are pruned by the preview service. The external `xyzrender` cache is
keyed by document identity or content, file metadata, renderer preset, controls,
the executable path, and available renderer version information.

Each generated runtime writes a `manifest.json` with schema version, completion
flag, document id, source extension, renderer, byte counts, and asset profile.
The manifest is written atomically after runtime files are staged so diagnostic
tools can distinguish complete runtimes from partial writes.

Quick Look keeps analogous generated files and `xyzrender-cache/` under the
extension cache container. Finder previews must not require the desktop app to
be running.

## Binary Payload Path

Desktop structure previews write the primary payload as `preview-data.bin` and
set `window.BuretteDataURL` in `preview-config.js`. `PreviewExtension/Web/viewer.js`
loads the binary data from that URL and falls back only when the runtime
configuration requires it.

This avoids duplicating large structures as both a binary file and base64
JavaScript. Keep `preview-data.js` as a compatibility fallback rather than the
default desktop path.

## RDKit WASM Loading

Grid runtimes load RDKit from shared assets:

```text
../assets/rdkit/RDKit_minimal.js
../assets/rdkit/RDKit_minimal.wasm
```

The runtime config exposes `rdkitWasmPath`, and `grid-viewer.js` passes it
through RDKit's `locateFile`. Do not inline `RDKit_minimal.wasm` into generated
per-document JavaScript. RDKit assets belong to grid profiles only.

## Grid Ingest And Search

Desktop collection previews use `apps/desktop/src-tauri/src/preview/grid_store.rs`
to parse SDF, SD, SMILES, SMI, CSV, and TSV inputs into SQLite. The initial grid
runtime is created after an early page-sized batch, and the UI receives:

- `indexing`
- `recordsIndexed`
- `recordsTotal`
- `indexReady`

Search semantics are defined by the shared, parameterized `LIKE` predicate.
SQLite FTS5 through `molecules_fts` is used only as a candidate-page fast path
after an exact count proves that the FTS candidates cover the complete `LIKE`
result inside the same read transaction. Substring queries that FTS cannot
cover, and runtimes without FTS, stay on the exact `LIKE` path. Pagination and
sort stay in the desktop grid command path so the web runtime does not need to
hold the entire collection in memory.

Grid bridge page sizes are intentionally split by host. Desktop Tauri and
browser-dev runtimes request 72 rows per page to keep scrolling responsive
without the earlier aggressive 144-row batches. Quick Look requests 48 rows per
page to keep Finder extension memory lower.

`scripts/perf-smoke.sh` includes an opt-in FTS perf smoke:

```bash
BURETTE_PERF_RUN_GRID_FTS=1 ./scripts/perf-smoke.sh
```

## Performance Budgets

Use these budgets as guardrails for future changes:

- Normal app launch remains a visible full-window app launch.
- Opening a regular non-grid PDB must not copy RDKit assets.
- Grid previews may load RDKit, but RDKit JS/WASM must be shared from the
  profile assets directory.
- Generated desktop structure runtimes should prefer `preview-data.bin` and
  avoid base64 JavaScript for large payloads.
- Reopening the same external-renderer preview with unchanged settings should
  hit the `xyzrender` cache.
- Large grid files should show the first page before complete indexing when the
  streaming store can parse the format.
- Quick Look smoke remains separate from desktop launch smoke.
- Preview runtime changes should preserve `manifest.json` and
  `preview-trace.jsonl` diagnostics.

## Do Not Regress

- Do not restore removed renderer paths as a performance shortcut.
- Do not make Burette a background-only helper to improve launch metrics.
- Do not inline RDKit WASM or molecule payloads into per-document JavaScript by
  default.
- Do not make Quick Look depend on a running desktop process.
- Do not bypass `config/web-runtime-profiles.json` when adding or removing web
  assets.
- Do not remove diagnostics, cache metadata, or perf smoke hooks when changing
  runtime generation.

## Checks

Lightweight checks:

```bash
bun tests/test-tauri-structure.mjs
bun tests/test-ui-shell-contract.mjs
bun tests/test-bun-installer-behavior.mjs
```

Measurement scripts:

```bash
./scripts/size-report.sh
./scripts/perf-smoke.sh
```

Full macOS runtime verification still requires building and installing the app,
then running forced Quick Look previews as described in
`docs/quicklook-debugging.md`.

The scheduled GitHub workflow `.github/workflows/nightly-smoke.yml` keeps the
full packaged-app and Quick Look smoke path out of fast PR validation while
still exercising the build, install, forced preview, and perf report scripts on
`main`.
