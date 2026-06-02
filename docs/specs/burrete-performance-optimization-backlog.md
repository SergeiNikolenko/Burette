# Burrete Performance Optimization Backlog

## Execution Protocol

This document captures the user-provided optimization backlog for Burrete.

Work must proceed in important stages. After each important stage, stop, report:

- what was inspected or changed;
- what evidence was collected;
- which files changed;
- which checks passed or could not be run;
- the recommended next stage.

Then wait for explicit user confirmation before continuing.

User-facing progress reports must be in Russian. File content remains in English
unless the user explicitly requests another language.

## Product Boundary

- Do not restore or touch `xyz-fast`; treat it as removed.
- Burrete is a full macOS app plus a Quick Look Preview Extension.
- Cold-start optimization must not turn Burrete back into an invisible tray or
  background-only helper.
- Optimize normal app launch as a real application launch.
- Keep Quick Look as a separate fast path.

## First Execution Stages

### Stage 0: Intake And Planning

Goal: preserve the backlog in the repository and set up staged execution.

Acceptance:

- This backlog exists in the repo.
- A running goal exists for staged execution.
- The agent stops after this stage and waits for user confirmation.

### Stage 1: P0 Size And Performance Baseline

Agent: Size & Performance Baseline

Goal: create measurable baseline reports before optimizing runtime behavior.

Relevant paths:

- `scripts/`
- `vendor-assets.lock.json`
- `apps/desktop/src-tauri/`
- `PreviewExtension/`

Tasks:

1. Add `scripts/size-report.sh`.
2. Report:
   - `build/Burrete.app` size;
   - zip or dmg size when present;
   - top 100 largest files;
   - exact duplicate files by SHA256;
   - separate sections for Molstar, RDKit, Ketcher, Tauri binary, Quick Look
     appex, and web assets.
3. Add `scripts/perf-smoke.sh`.
4. Cover minimal scenarios:
   - app cold launch to first paint where automation is practical;
   - opening a small PDB;
   - opening an SDF grid;
   - Quick Look preview smoke through the existing workflow.
5. Do not optimize in this stage.

Acceptance:

- `./scripts/size-report.sh` works locally on macOS.
- `./scripts/perf-smoke.sh` works locally on macOS.
- Reports are saved to:
  - `build/reports/size-report.txt`
  - `build/reports/perf-smoke.txt`

Do not:

- change runtime logic;
- remove assets;
- change renderer policy.

### Stage 2: P0 Desktop Runtime Asset Cache

Agent: Desktop Runtime Asset Cache

Goal: stop copying the full web runtime on every document open.

Relevant paths:

- `apps/desktop/src-tauri/src/preview/runtime_viewer.rs`
- `apps/desktop/src-tauri/src/preview/runtime_grid.rs`
- `apps/desktop/src-tauri/src/preview/runtime_utils.rs`
- `vendor-assets.lock.json`
- `tests/`

Tasks:

1. Replace broad `copy_web_assets(app, assets)` usage with profile-driven calls:
   - `AssetProfile::Molstar`
   - `AssetProfile::Grid`
   - `AssetProfile::ExternalXyzrender`
   - `AssetProfile::MinimalShell`
2. Copy only the files required by each profile.
3. Add `copy_if_needed` behavior based on size and mtime, or lockfile hashes
   if that fits the current code cleanly.
4. Do not touch destination files when assets already match.
5. Copy the RDKit directory only for grid.
6. Copy Molstar assets only for Molstar paths.
7. Add diagnostics for copied and skipped assets.

Acceptance:

- Opening a regular PDB does not copy `rdkit/`.
- Opening grid SDF or SMILES copies RDKit once and skips on later opens.
- `scripts/size-report.sh` shows reduced runtime-copy churn.
- Existing tests pass.
- Unit tests cover asset profile mapping.

Do not:

- change vendored asset contents;
- change UI;
- rewrite the renderer.

### Stage 3: P0 Binary Preview Data Path

Agent: Binary Preview Data Path

Goal: stop writing structure payload twice as both `preview-data.bin` and
base64 JavaScript.

Relevant paths:

- `apps/desktop/src-tauri/src/preview/runtime_viewer.rs`
- `PreviewExtension/Web/viewer.js`
- `PreviewExtension/Web/burette-agent.js`
- `PreviewExtension/Web/viewer-shell.js`
- `tests/`

Tasks:

1. Make `preview-data.bin` the primary data source.
2. Let the web runtime read binary data through a config or global URL:
   `window.BurreteDataURL`.
3. Keep `preview-data.js` only as a fallback when needed.
4. Stop writing base64 JavaScript by default in the desktop path.
5. Verify Molstar, external renderer artifact, grid, and docking paths.
6. Add a contract test confirming default desktop runtime does not create
   `preview-data.js`.

Acceptance:

- Small PDB, MOL, and SDF files open.
- Binary formats open.
- `preview-data.bin` exists.
- `preview-data.js` is not created in the default desktop runtime.
- The web viewer can read `BurreteDataURL`.
- Quick Look has no regressions if it still uses its own path.

Do not:

- change RDKit WASM in this stage;
- implement streaming fetch yet.

### Stage 4: P0 RDKit WASM URL Loading

Agent: RDKit WASM URL Loading

Goal: load RDKit WASM as a `.wasm` asset rather than as a large base64 string
inside generated JavaScript.

Context: older grid runtimes encoded `RDKit_minimal.wasm` into generated
JavaScript. At roughly 6.9 MB, that turns into about 9+ MB of JavaScript text
per runtime.

Relevant paths:

- `apps/desktop/src-tauri/src/preview/runtime_grid.rs`
- `PreviewExtension/Platform/PreviewViewController.swift`
- `PreviewExtension/Web/grid-viewer.js`
- `PreviewExtension/Web/rdkit/`

Tasks:

1. Use the existing `rdkitWasmPath` idea in runtime config.
2. Initialize RDKit in `grid-viewer.js` through URL or path loading.
3. Remove `preview-rdkit-wasm.js` from the default runtime.
4. Verify Quick Look `loadFileURL(... allowingReadAccessTo:)` allows WASM from
   the assets directory.
5. Adjust CSP minimally if WebKit requires it.
6. Add any base64 fallback only behind an explicit flag if a local platform
   issue appears.

Acceptance:

- Grid SDF, SMILES, CSV, and TSV work in the desktop app.
- Grid works in Quick Look.
- Runtime directories do not create `preview-rdkit-wasm.js` by default.
- RDKit WASM is not duplicated as a base64 string.
- `scripts/size-report.sh` shows reduced runtime artifacts.

Do not:

- update the RDKit version;
- change grid UI.

### Stage 5: P0 Bundle Duplication Audit And Split Plan

Agent: Bundle Duplication Audit

Goal: determine how many times `PreviewExtension/Web` lands in the final app
bundle and prepare a safe split plan.

Context: Tauri resources include `../../../PreviewExtension/Web`; the Xcode
Quick Look target also includes `Web` resources; the `.appex` is then embedded
under `Burrete.app/Contents/PlugIns`. Heavy web assets may therefore appear in
multiple bundle locations.

Relevant paths:

- `apps/desktop/src-tauri/tauri.conf.json`
- `Burrete.xcodeproj/project.pbxproj`
- `scripts/build.sh`
- `PreviewExtension/Web/`

Tasks:

1. Extend `scripts/size-report.sh` so it explicitly finds:
   - `Contents/Resources/Web`;
   - `Contents/PlugIns/BurretePreview.appex/**/Web`;
   - duplicate heavy files such as `molstar.js` and `RDKit_minimal.wasm`.
2. Create `docs/reports/web-bundle-duplication.md`.
3. Propose a safe split:
   - `PreviewExtension/Web/shared`;
   - `PreviewExtension/Web/quicklook`;
   - `apps/desktop/public/Web` or generated desktop web assets;
   - or keep one physical source with separate bundle target manifests.
4. Avoid a large refactor in this stage.

Acceptance:

- A report exists with actual paths and sizes.
- Duplicated files are clear.
- The report identifies what can be removed from app resources, what cannot be
  removed, and what must be tested.
- Build behavior does not change functionally.

Do not:

- remove assets immediately;
- break the Xcode project.

### Stage 6: P1 Desktop App First Paint Optimization

Agent: Desktop App First Paint Optimization

Goal: speed up normal launch of the full application without turning Burrete
into a hidden background helper.

Context: the desktop app is a full shell with sidebar, tabs, command palette,
settings, and project roots. Initial imports can accidentally pull heavy tools
into the first paint path.

Relevant paths:

- `apps/desktop/src/main.tsx`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/components/`
- `apps/desktop/src/hooks/`
- `apps/desktop/vite.config.ts`

Tasks:

1. Introduce performance marks:
   - `app:script-start`;
   - `app:react-mounted`;
   - `app:shell-visible`;
   - `app:first-document-opened`;
   - `viewer:first-render`.
2. Split the initial shell from lazy tools:
   - Settings lazy;
   - Command Palette lazy or preload after idle;
   - Ketcher lazy;
   - docking tools lazy;
   - update UI lazy.
3. Keep the first screen light:
   - titlebar;
   - sidebar;
   - tabs;
   - empty state;
   - recent files.
4. Configure Vite chunking:
   - Mol* must not land in the main app chunk;
   - `ketcher-*` must not land in the main app chunk;
   - icons should remain tree-shaken or subset where practical.
5. Add `scripts/bundle-report.mjs` or a Vite visualizer-compatible JSON report.

Acceptance:

- `bun run build:web` creates a chunk report.
- Main JS chunk is smaller or explicitly measured.
- Ketcher is in a separate lazy chunk.
- Settings, docking, and update UI do not block first paint.
- The app still opens as a normal window on ordinary launch.

Do not:

- set `visible: false` without a separate product decision;
- remove functionality;
- change Quick Look.

## Remaining Backlog Summary

The full user-provided backlog continues with these stages:

- P1: Launch Mode Semantics.
- P1: External Renderer Artifact Cache.
- P1: SQLite FTS Grid Search.
- P1: Streaming Grid Ingest.
- P1: Web Runtime Profiles.
- P1: Ketcher Lazy Boundary.
- P2: `burrete-core` Crate Skeleton.
- P2: Quick Look Core Bridge.
- P2: Finder Thumbnail Extension Spike.
- P2: Distribution Hardening.
- P2: CSP Per Runtime Profile.
- P2: Observability Layer.
- P2: Native Workflow Polish.
- P2: Accessibility Contract.
- P2: Installer Reliability.
- P3: Performance Docs.

Before starting any later stage, inspect the relevant source files directly and
expand this document with the detailed requirements for that stage.

### Stage 7: P1 Launch Mode Semantics

Agent: Launch Mode Semantics

Goal: separate normal app launch, file-open launch, update or install
registration launch, and Quick Look-related maintenance without regressing
Burrete into a background-only utility.

Relevant paths:

- `apps/desktop/src-tauri/src/startup.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/tray.rs`
- `apps/desktop/src-tauri/tauri.conf.json`
- `scripts/install.sh`
- `packages/burrete/bin/burrete.mjs`

Tasks:

1. Document launch modes:
   - normal user launch shows the full app;
   - file open event shows the full app and opens files;
   - menu or tray click shows the full app;
   - post-install registration or maintenance avoids heavy UI when possible;
   - update check or install remains user-visible when launched from the app.
2. Add an explicit CLI or environment flag, for example:
   - `BURRETE_LAUNCH_MODE=register`
   - `BURRETE_LAUNCH_MODE=normal`
3. Do not change the default user launch to hidden.
4. If `visible: false` is proposed, pair it with Rust-side immediate show for
   normal launch so the user does not see delay or blankness.
5. Update docs.

Acceptance:

- Double-clicking `Burrete.app` opens a full window.
- Open With or file association opens the window and documents.
- Installer or maintenance path does not have to create heavy UI.
- Behavior is described in docs.
- Startup argument parsing tests are updated.

Do not:

- remove tray or menu behavior;
- turn the product into a background-only utility.

### Stage 8: P1 External Renderer Artifact Cache

Agent: External Renderer Artifact Cache

Goal: avoid recomputing the same `xyzrender` SVG when the same preview or
document is opened repeatedly.

Relevant paths:

- `apps/desktop/src-tauri/src/preview/xyzrender.rs`
- `apps/desktop/src-tauri/src/preview/runtime_viewer.rs`
- `PreviewExtension/Platform/PreviewViewController.swift`

Tasks:

1. Add a cache key derived from:
   - canonical file path when available;
   - file size;
   - file mtime;
   - input content hash for virtual or inline data;
   - renderer preset;
   - controls JSON;
   - `xyzrender` executable path;
   - `xyzrender` version when available.
2. Add a desktop cache under:

   ```text
   ~/Library/Caches/.../Burrete/xyzrender-cache/<key>/
     xyzrender.svg
     meta.json
     log.txt
   ```

3. Add an analogous Quick Look cache in the extension cache container.
4. On cache hit, do not invoke the external process.
5. Add prune behavior:
   - max age;
   - max total size;
   - max entries.
6. Add diagnostics:
   - `cacheHit`;
   - `cacheMiss`;
   - `elapsedMs`.

Acceptance:

- Reopening the same file with the same settings does not invoke the external
  process.
- File changes invalidate the cache.
- Preset or controls changes invalidate the cache.
- Cache cleanup works.
- Unit tests cover the cache key.

Do not:

- change `xyzrender`;
- change renderer settings UI.

### Stage 9: P1 SQLite FTS Grid Search

Agent: SQLite FTS Grid Search

Goal: speed up search across large SDF, SMILES, CSV, and TSV molecule
collections.

Relevant paths:

- `apps/desktop/src-tauri/src/preview/grid_store.rs`
- `apps/desktop/src-tauri/src/commands/grid.rs`
- `PreviewExtension/Web/grid-viewer.js`
- `tests/`

Context:

The desktop grid store keeps a normalized `search_text` column and currently
filters with `LIKE`. The schema has ordinary indexes, but no full-text index.

Tasks:

1. Add an FTS5 virtual table:

   ```sql
   create virtual table molecules_fts using fts5(
     name,
     smiles,
     props_text,
     content='molecules',
     content_rowid='id'
   );
   ```

2. Write ingested records to the FTS table.
3. Use FTS for simple text queries.
4. Keep a fallback to `LIKE` when FTS is unavailable.
5. Add query normalization.
6. Preserve sort and pagination behavior.
7. Add tests for:
   - name search;
   - smiles search;
   - property search;
   - empty query;
   - fallback query.

Acceptance:

- Search works as before on fixture collections.
- On synthetic 50k or 100k row collections, FTS is faster than `LIKE` in the
  perf smoke path.
- Pagination and sort behavior do not regress.
- Existing UI does not change.

Do not:

- add SMARTS or substructure search in this stage;
- change RDKit.

### Stage 10: P1 Streaming Grid Ingest

Agent: Streaming Grid Ingest

Goal: large molecule collections should show the first grid page before the
whole collection has been indexed.

Relevant paths:

- `apps/desktop/src-tauri/src/preview/grid_store.rs`
- `apps/desktop/src-tauri/src/preview/runtime_grid.rs`
- `apps/desktop/src-tauri/src/commands/grid.rs`
- `apps/desktop/src/App.tsx`
- `PreviewExtension/Web/grid-viewer.js`

Tasks:

1. Introduce a streaming parser for:
   - `.smi` and `.smiles`;
   - `.sdf` and `.sd`;
   - `.csv`;
   - `.tsv`.
2. Ingest into SQLite in batches.
3. Create the grid runtime after the first page batch, for example 96-240 rows.
4. Expose indexing state to the UI:
   - `indexing`;
   - `recordsIndexed`;
   - `recordsTotal` unknown or known;
   - `indexReady`.
5. Continue background indexing after the runtime has been created.
6. Choose search behavior before indexing completes explicitly. The desktop
   runtime may search only the indexed subset while reporting `indexReady:
   false`.
7. Closing a tab must cancel or clean up the background indexing job.

Acceptance:

- Synthetic 10k or 100k SMILES collections show the first page before full
  indexing completes.
- The UI shows indexing state.
- After indexing completes, search and sort operate on the full dataset.
- Closing a tab cancels or cleans up the background job.

Do not:

- change the visual design of grid cards;
- update RDKit.

### Stage 11: P1 Web Runtime Profiles

Agent: Web Runtime Profiles

Goal: avoid treating one complete web runtime bundle as an implicit dependency
for every desktop and Quick Look scenario.

Relevant paths:

- `PreviewExtension/Web/`
- `apps/desktop/src-tauri/tauri.conf.json`
- `Burrete.xcodeproj/project.pbxproj`
- `scripts/vendor-molstar.mjs`
- `scripts/vendor-rdkit.mjs`
- `scripts/check-vendor-assets.mjs`
- `vendor-assets.lock.json`

Tasks:

1. Introduce manifest profiles:

   ```json
   {
     "profiles": {
       "desktop-molstar": [],
       "desktop-grid": [],
       "quicklook-molstar": [],
       "quicklook-grid": [],
       "external-artifact": []
     }
   }
   ```

2. Build checks must validate assets by profile.
3. Tauri resources must include the desktop-needed profile.
4. Xcode resources must include the Quick Look-needed profile.
5. Do not rename source files unless required.
6. Update `check-vendor-assets`.

Acceptance:

- `bun run check:vendor-assets` validates profiles.
- The app build path still works.
- The Quick Look extension build path still works.
- `scripts/size-report.sh` shows which profiles include each web asset.
- Exact duplicate heavy files have an explicit profile-based explanation.

Do not:

- update Molstar or RDKit versions;
- rewrite the viewer.

### Stage 12: P1 Ketcher Lazy Boundary

Agent: Ketcher Lazy Boundary

Goal: keep Ketcher out of the initial desktop app bundle.

Context: the desktop package depends on `ketcher-core`, `ketcher-react`, and
`ketcher-standalone`. Ketcher edit mode is limited to small MOL/SDF inputs, so
it is not part of the core launch path.

Relevant paths:

- `apps/desktop/src/`
- `apps/desktop/src/components/`
- `apps/desktop/src/lib/`
- `apps/desktop/vite.config.ts`
- `scripts/bundle-report.mjs`

Tasks:

1. Find all imports from `ketcher-*`.
2. Keep Ketcher behind a lazy-loaded route or component boundary.
3. Preload Ketcher only from explicit edit affordances or after idle.
4. Check the bundle report.
5. Add a test or contract that the main bundle does not contain obvious
   Ketcher runtime dependencies.

Acceptance:

- The app starts without loading the Ketcher chunk.
- Ketcher still opens for eligible MOL/SDF files.
- Ineligible files still show a disabled state or explanation.
- The bundle report shows a separate Ketcher chunk.

Do not:

- deeply change Ketcher UX;
- change eligibility limits.

### Stage 13: P2 `burrete-core` Crate Skeleton

Agent: `burrete-core` Crate Skeleton

Goal: start removing duplicated renderer, format, and limit policy between the
Swift Quick Look extension and the Rust desktop runtime by introducing a shared
Rust crate.

Context: Rust currently owns a registry-backed implementation in
`apps/desktop/src-tauri/src/preview/formats.rs`, while Swift has a separate
renderer policy in `PreviewExtension/RendererPolicy.swift` and a separate
supported-extension list in
`PreviewExtension/Platform/PreviewViewController.swift`. This stage creates the
shared Rust home first; Swift FFI is intentionally deferred.

Relevant paths:

- `Cargo.toml`
- `crates/burrete-core/`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/src/preview/formats.rs`
- `PreviewExtension/RendererPolicy.swift`
- `PreviewExtension/Platform/PreviewViewController.swift`

Tasks:

1. Create a root Cargo workspace that includes the existing Tauri crate and the
   new `crates/burrete-core` crate.
2. Move the existing Rust supported-extension, format-detection, renderer-mode
   normalization, and renderer-policy logic into `burrete-core`.
3. Keep the Tauri module as a thin compatibility re-export so existing call
   sites do not change.
4. Preserve the existing `config/preview-formats.json` source of truth.
5. Add unit tests in `burrete-core` that cover the renderer policy behavior
   already expected by the desktop runtime and Swift policy.
6. Add a lightweight repository contract that the desktop crate depends on
   `burrete-core`.

Acceptance:

- `cargo test --workspace` passes.
- The desktop runtime uses `burrete-core` for extensions, format detection, and
  renderer policy.
- Existing Rust tests still pass.
- No Swift FFI is introduced.
- No functional behavior changes are made to parsing or renderer selection.

Do not:

- connect Swift to the Rust crate in this stage;
- rewrite parsers;
- change file size, atom, grid, or Ketcher eligibility limits;
- change the preview format registry schema.

### Stage 14: P2 Quick Look Core Bridge

Agent: Quick Look Core Bridge

Goal: let the Quick Look extension consult the same Rust core used by the
desktop runtime for safe format, renderer policy, and size-limit decisions.

Context: `burrete-core` now owns the Rust registry-backed format and renderer
policy. Quick Look still has Swift fallbacks for renderer policy, supported
extensions, format detection, and size limits. Direct Swift FFI would make the
Xcode app-extension build and signing path more fragile, so this stage uses a
small helper executable built from `burrete-core` and bundled into the `.appex`.

Relevant paths:

- `crates/burrete-core/`
- `PreviewExtension/RendererPolicy.swift`
- `PreviewExtension/Platform/PreviewViewController.swift`
- `scripts/build.sh`
- `tests/test-tauri-structure.mjs`

Tasks:

1. Add a small `burrete-core-bridge` helper binary with commands for:
   - supported extension checks;
   - Quick Look size limits;
   - format lookup;
   - renderer policy resolution.
2. Add a thin Swift wrapper that invokes the helper with a short timeout.
3. Keep Swift fallback logic for every bridge call.
4. Build and embed the helper into the Quick Look extension before signing.
5. Add contracts that the bridge path remains wired.

Acceptance:

- `cargo test --workspace` passes.
- The bridge helper returns the same policy data as `burrete-core`.
- Quick Look uses the bridge for supported extensions, size limits, format
  lookup, and renderer policy when the helper is available.
- Quick Look keeps its existing Swift fallback if the helper is missing or
  fails.
- `bun tests/test-tauri-structure.mjs` passes.

Do not:

- convert Quick Look to a Rust runtime;
- remove Swift fallback logic;
- touch `WKWebView` lifecycle;
- add Swift FFI or static library linking in this stage.

### Stage 15: P2 Finder Thumbnail Extension Spike

Agent: Finder Thumbnail Extension Spike

Goal: add a Finder-native thumbnail path as a separate Apple-style feature
without reviving the old `xyz-fast` renderer or loading web runtime assets.

Context: Burrete already ships a Quick Look preview extension for full previews.
Finder thumbnails use a separate Quick Look thumbnail extension point, so the
spike should add a second `.appex` next to `BurretePreview.appex` rather than
mix thumbnail code into the preview controller.

Relevant paths:

- `PreviewExtension/ThumbnailProvider.swift`
- `PreviewExtension/ThumbnailInfo.plist`
- `Burrete.xcodeproj/project.pbxproj`
- `scripts/build.sh`
- `docs/reports/finder-thumbnail-extension-spike.md`
- `tests/test-tauri-structure.mjs`

Tasks:

1. Add a `QLThumbnailProvider` app extension target named `BurreteThumbnail`.
2. Support only small/simple native thumbnails initially:
   - PDB-like files through `ATOM` and `HETATM` records;
   - MOL/SDF single-molecule V2000 atom blocks;
   - XYZ first-frame files.
3. Render thumbnails with native Swift/AppKit drawing.
4. Return a generic molecule document glyph for complex, large, unsupported, or
   unparsable files.
5. Build, sign, and embed the thumbnail `.appex` next to the preview `.appex`.
6. Add contracts and a spike report that document scope and follow-up work.

Acceptance:

- `xcodebuild -project Burrete.xcodeproj -target BurreteThumbnail ... build`
  passes.
- `scripts/build.sh` embeds both `BurretePreview.appex` and
  `BurreteThumbnail.appex`.
- The thumbnail path imports no WebKit and references no Molstar, RDKit, or web
  runtime assets.
- `samples/mini.pdb`, `samples/mini.sdf`, and `samples/mini.xyz` are covered by
  the native parser path.
- Existing Quick Look preview contracts still pass.

Do not:

- bring back `xyz-fast`;
- load Molstar, RDKit, or WebKit in the thumbnail extension;
- expand the thumbnail parser to large trajectories or grid files in this
  spike;
- remove the existing preview extension.

### Stage 16: P2 Distribution Hardening

Agent: Distribution Hardening

Goal: prepare the public macOS distribution path with explicit Developer ID
signing, hardened runtime, notarization, stapling, and release artifacts without
breaking local ad-hoc debug builds.

Context: Tauri config keeps `hardenedRuntime: false` for the default macOS
bundle path. Quick Look Xcode targets already use hardened runtime. The build
script signs the app and extensions.

Relevant paths:

- `apps/desktop/src-tauri/tauri.conf.json`
- `PreviewExtension/BurretePreview.entitlements`
- `Burrete.xcodeproj/project.pbxproj`
- `scripts/build.sh`
- `scripts/release.sh`
- `scripts/check-release-signature.sh`
- `.github/workflows/release.yml`
- `docs/releasing.md`
- `docs/reports/distribution-hardening.md`

Tasks:

1. Check whether hardened runtime can be enabled for the Tauri app.
2. Compare app entitlements with app extension entitlements.
3. Add a release-mode build path for:
   - Developer ID signing;
   - notarization;
   - stapling;
   - zip and dmg artifacts.
4. Add a CI-friendly dry-run mode.
5. Update release docs and document any blocker.

Acceptance:

- Local ad-hoc debug build works as before.
- Release build path is documented.
- Hardened runtime does not break the app or Quick Look.
- If a hardening change cannot be proven safe, the blocker is documented.

Do not:

- change bundle identifiers without a separate migration task;
- publish a release automatically.

### Stage 17: P2 CSP Per Runtime Profile

Agent: CSP Per Runtime Profile

Goal: narrow Content Security Policy by renderer/runtime path.

Context: the Tauri app shell CSP allows `unsafe-eval` and `wasm-unsafe-eval`
for the app-level runtime because Molstar/RDKit/WASM paths need broader
capabilities. Grid runtime HTML also has a broad CSP. The per-preview HTML
paths can be more specific.

Relevant paths:

- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src-tauri/src/preview/runtime_viewer.rs`
- `apps/desktop/src-tauri/src/preview/runtime_grid.rs`
- `PreviewExtension/Platform/PreviewViewController.swift`
- `PreviewExtension/Web/`
- `docs/reports/csp-runtime-profiles.md`
- `tests/test-tauri-structure.mjs`

Tasks:

1. Document CSP needs by profile:
   - Molstar;
   - Grid/RDKit;
   - external artifact SVG;
   - app shell.
2. Remove unnecessary CSP capabilities where safe.
3. Ensure the RDKit WASM URL path keeps the minimum required CSP.
4. Add contract coverage so the profile-specific CSP does not regress.

Acceptance:

- CSP is documented by profile.
- External artifact path does not get unnecessary WASM or eval access.
- Grid and Molstar runtime paths keep their required capabilities.
- Smoke or contract checks cover the CSP profile strings.

Do not:

- do a broad security rewrite;
- break WASM loading.

### Stage 18: P2 Observability Layer

Agent: Observability Layer

Goal: make user problems diagnosable without guessing.

Context: Quick Look already has diagnostic log lines in
`PreviewViewController`, file diagnostics, asset diagnostics, render timeout,
and JS status messages. Desktop Rust commands return errors but do not yet have
a centralized performance trace layer.

Relevant paths:

- `apps/desktop/src-tauri/src/`
- `apps/desktop/src/`
- `PreviewExtension/Platform/PreviewViewController.swift`
- `PreviewExtension/Web/viewer.js`
- `docs/quicklook-debugging.md`

Tasks:

1. Introduce a unified log format:
   `timestamp level subsystem documentId event elapsedMs message`.
2. Add desktop diagnostics:
   - lightweight Rust logging;
   - JS performance marks;
   - IPC event timings.
3. Keep current Quick Look diagnostics and add elapsed markers for:
   - file read;
   - asset validation;
   - runtime write;
   - WK load start;
   - JS ready;
   - render complete.
4. Add Export Diagnostics Bundle.
5. Include app logs, Quick Look logs, size report, environment info, and recent
   render errors in the diagnostics bundle.

Acceptance:

- User can export diagnostics.
- Logs do not contain file content.
- Perf smoke can use the recorded marks.
- Docs are updated.

Do not:

- add external telemetry;
- include private molecule structures.

### Stage 19: P2 Native Workflow Polish

Agent: Native Workflow Polish

Goal: strengthen the feeling of a real macOS application without turning the UI
into decorative glassmorphism.

Context: product documentation describes Burrete as practical, native, and
restrained. The shell should not draw attention away from the molecule. The
design system north star is "The Native Lab Utility": native macOS chrome,
restrained color, compact spacing, and visible focus.

Relevant paths:

- `apps/desktop/src/`
- `apps/desktop/src-tauri/src/menu.rs`
- `apps/desktop/src-tauri/src/tray.rs`
- `apps/desktop/src-tauri/src/commands/`
- `docs/keyboard-shortcuts.md`
- `PRODUCT.md`
- `DESIGN.md`

Tasks:

1. Add or verify menu commands:
   - Open;
   - Open Recent;
   - Reveal in Finder;
   - Copy Path;
   - Export Preview as PNG/SVG;
   - Clear Preview Cache;
   - Reset Quick Look;
   - Open Logs;
   - Check Updates.
2. Ensure commands are available from the menu, command palette, and suitable
   shortcuts.
3. Add proxy/file affordances:
   - document title context menu;
   - reveal in Finder;
   - copy path;
   - show metadata.
4. Keep the existing visual language.

Acceptance:

- Commands are available without the mouse.
- `docs/keyboard-shortcuts.md` is updated.
- No visual shift toward a SaaS dashboard.
- Menu event emitter tests are updated.

Do not:

- do a decorative redesign;
- break the current layout.

### Stage 20: P2 Accessibility Contract

Agent: Accessibility Contract

Goal: bring the shell to a practical WCAG AA level.

Context: product documentation requires keyboard reachability, visible focus
indicators, accessible names for icon-only controls, and command palette or
launcher operation without a pointer.

Relevant paths:

- `apps/desktop/src/components/`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/hooks/use-keyboard-shortcuts.ts`
- `tests/`

Tasks:

1. Check icon-only buttons for `aria-label`.
2. Check tab order:
   - sidebar;
   - tabs;
   - viewer controls;
   - settings;
   - command palette.
3. Add visible focus rings.
4. Command palette:
   - dialog semantics;
   - Escape closes;
   - arrow navigation;
   - active descendant.
5. Add basic automated checks:
   - DOM contract tests;
   - `axe-core` if convenient.

Acceptance:

- Keyboard-only smoke scenario passes.
- Icon-only controls have accessible names.
- Focus is visible.
- Command palette is usable without a mouse.

Do not:

- attempt screen-reader-perfect Molstar canvas behavior;
- deeply change molecular canvas semantics.

### Stage 21: P2 Installer Reliability

Agent: Installer Reliability

Goal: make the npm and CLI installer more reliable and friendly for public use.

Context: the CLI installer already downloads the latest release from GitHub,
selects a zip asset, verifies the digest, installs the app to `~/Applications`
or `/Applications`, and resets the Quick Look cache.

Relevant paths:

- `packages/burrete/bin/burrete.mjs`
- `packages/burrete/package.json`
- `tests/test-bun-installer-*.mjs`
- `docs/releasing.md`
- `README.md`

Tasks:

1. Improve install UX:
   - progress output;
   - clearer errors;
   - explain system vs user install;
   - post-install next steps.
2. Check checksum behavior for GitHub assets.
3. Add `burrete doctor`:
   - app installed;
   - Quick Look extension present;
   - `qlmanage` reset available;
   - app version.
4. Add `burrete uninstall` only if it is safe and explicitly confirmed.
5. Add tests for version compare, release selection, and install staging
   rollback.

Acceptance:

- Existing installer tests pass.
- `burrete doctor` works.
- Install errors are understandable.
- Rollback on failed replace preserves the previous app.

Do not:

- add background auto-update;
- delete user data.

### Stage 22: P3 Performance Docs

Agent: Performance Docs

Goal: document the new optimization architecture so future agents do not
accidentally revert the improvements.

Relevant paths:

- `docs/architecture.md`
- `docs/renderer-support.md`
- `docs/releasing.md`
- `docs/quicklook-debugging.md`
- `docs/specs/`

Tasks:

1. Add `docs/performance.md`.
2. Describe:
   - asset profiles;
   - runtime cache layout;
   - binary payload path;
   - RDKit WASM loading;
   - grid ingest and search;
   - Quick Look vs desktop boundaries;
   - performance budgets.
3. Update architecture docs.
4. Remove stale `xyz-fast` references if any remain in active docs or code
   comments after removal, except changelog or migration notes where needed.
5. Add a "do not regress" section.

Acceptance:

- Docs match the current code.
- No stale `xyz-fast` references remain in active docs, except changelog or
  migration notes if needed.
- New agents can understand the runtime model from docs.
