# Mesoscale Viewer Implementation Plan

Status: **shipped** — the Mesoscale viewer landed in PR #556 (with Mol* 5.11
adopted in #551). The plan below is the historical planning record; where it
disagrees with the shipped implementation, the implementation wins.

## Shipped Reality (differences from the plan)

- Runtime source lives in `apps/desktop/src/preview-mesoscale/` (not
  `packages/mesoscale-runtime/`), built by `scripts/build-mesoscale-runtime.mjs`
  into `PreviewExtension/Web/mesoscale.js`.
- Burette pins `molstar` `5.11.0`, and `scripts/vendor-molstar.mjs` builds a
  custom self-vendored bundle from `scripts/molstar-viewer-entry.js` instead of
  copying the upstream viewer bundle.
- Document routing (`apps/desktop/src/lib/mesoscale-documents.ts`): the
  extensions `molj`, `molx`, and `mesozip` route unconditionally to the
  mesoscale runtime; `cif`/`bcif`/`mmcif`/`mcif` route to it only when the file
  path contains `cellpack`, `petworld`, or `mesoscale`. There is no
  content-based CIF classification and no ambiguity dialog.
- Packages use the dedicated `.mesozip` extension registered in
  `config/preview-formats.json` and `tauri.conf.json`, not generic `.zip`.
- The bridge contract is `burette-mesoscale/v2`
  (`apps/desktop/src/lib/mesoscale-contract.ts`) with kinds `summary`,
  `hierarchy-page`, `selection`, `export`, `failure`, `capabilities`,
  `context-menu`, and layout messages; exports are `png|molx|molj` (no MP4).
- `desktop-mesoscale` and `quicklook-mesoscale` asset profiles shipped
  together; Quick Look (`PreviewViewController.swift`) and the iPhone app
  (`ios/BuretteMobile/MobilePreviewRuntime.swift`) both route `mesozip`.
- The shipped test suite is `bun run test:mesoscale`
  (`tests/test-mesoscale-*.mjs` with the `tests/fixtures/mesoscale/` package
  fixture and oracle), not the plan's proposed test file names.
- Not shipped from the plan: agent-session/CLI mesoscale observe-act coverage
  and MP4 export.

---

Original plan (historical), validated against Burette `v2.1.9`, Mol*
`v5.10.1` in the repository, and upstream Mol* Mesoscale Explorer `v5.11.0` on
2026-07-28:

## Outcome

Burette should open and interactively inspect mesoscale molecular scenes fully
on the user's Mac, without uploading local models to a remote service. The
first production target is the packaged macOS desktop app. Browser-dev is the
development and contract-test surface; Finder Quick Look and the source-built
iPhone app are separate delivery stages with separate acceptance gates.

In this document, _mesoscale_ means cell-scale crowded molecular scenes with
large numbers of repeated molecular instances. It does not introduce a special
biological format for the historically named bacterial "mesosome"; a mesosome
model is one possible scene carried by the same runtime and file contracts.

## Verified Starting Point

- Burette pins `molstar` `5.10.1` in `package.json` and `bun.lock`.
- `scripts/vendor-molstar.mjs` currently copies only the standard Mol* viewer
  bundle (`build/viewer/molstar.js` and `molstar.css`). Updating the package
  alone therefore does not add Mesoscale Explorer.
- Burette already routes PDB, mmCIF/BCIF, MolViewSpec (`.mvsj`, `.mvsx`), and
  related structure formats through the standard Mol* preview.
- The desktop and Finder extension reuse assets under `PreviewExtension/Web/`,
  while the packaged agent plugin mirrors that directory. New runtime assets
  must remain synchronized through the existing build and mirror checks.
- Upstream Mol* `v5.11.0` implements Mesoscale Explorer as a separate
  `MesoscaleExplorer.create(...)` application with its own plugin specification,
  behaviors, state transforms, data loaders, and panels. The upstream source is
  about 5,600 lines of TypeScript/TSX/SCSS, so copying it into
  `PreviewExtension/Web/viewer.js` would create an unsafe fork.
- The upstream application supports ordinary mmCIF/BCIF, CellPack-style CIF,
  Petworld-style CIF, a generic ZIP manifest with instanced structures and PLY
  meshes, and Mol* session files (`.molx`, `.molj`). It also exposes PDB and
  PDB-IHM download routes, but remote download is not required for the local
  desktop milestone.
- The inspected generic manifest declares trajectories, but the current
  generic loader does not consume them. VTP support added elsewhere in Mol*
  `v5.11.0` is not wired into that generic mesoscale manifest loader. Neither
  capability is part of the initial acceptance claim.
- A live upstream Petworld Flagellar Motor example loaded successfully at
  approximately 0.736 million atoms. This is the first large reference case,
  not a claim that every scene of that size already meets Burette's budgets.
- The standard Burette viewer currently renders `samples/structures/proteins/1htb.pdb`.
  A separate `samples/mini.pdb` run showed an unresolved state-tree dependency;
  that regression must be baselined before the new runtime is allowed to ship.

Authoritative upstream references:

- [Mol* Mesoscale Explorer](https://molstar.org/me/)
- [Mol* `v5.11.0` Mesoscale Explorer source](https://github.com/molstar/molstar/tree/v5.11.0/src/apps/mesoscale-explorer)
- [Mol* `v5.11.0` release](https://github.com/molstar/molstar/releases/tag/v5.11.0)

## Product Scope

### Required for the first production milestone

1. Open a supported local mesoscale scene from Finder or Burette's file picker.
2. Keep all parsing, assets, scene state, and rendering local to the Mac.
3. Show the scene hierarchy by root, group, and entity with instance counts.
4. Focus, select, show/hide, isolate, recolor, change opacity/emissive state,
   and apply clipping at group or entity scope.
5. Offer named graphics profiles appropriate for large scenes and preserve the
   selected profile during the document session.
6. Save and reopen Mol* state sessions; support snapshot-based tours when the
   source session contains them.
7. Export a still image and a portable `.molx` session. MP4 export is included
   only after its local encoder and packaged-app behavior pass the export gate.
8. Expose bounded scene observations and typed group/entity actions through the
   existing Burette viewer bridge and agent session.
9. Preserve standard Mol* behavior and performance for ordinary molecular
   files.

### Explicitly outside the first milestone

- Authoring CellPack recipes or generating mesoscale models.
- Molecular simulation, docking, or remote compute inside the viewer.
- Generic-manifest trajectory playback until upstream consumption or a
  Burette-owned schema is implemented and validated.
- VTP meshes inside the generic manifest; the initial contract is PLY only.
- Global registration of `.zip` with Launch Services or Quick Look.
- Full Finder Quick Look controls or full iPhone feature parity.
- Silent fetching of remote assets referenced by a local scene.

## Architecture Decision

Add a distinct `mesoscale` viewer profile. Do not turn the existing `molstar`
renderer into a mode with scattered conditionals and do not paste the upstream
application into `PreviewExtension/Web/viewer.js`.

The target runtime shape is:

```text
local file or package
        |
        v
format classifier and safe package reader
        |
        +--------------------------+
        | standard structure       | mesoscale scene/session
        v                          v
standard Mol* profile       desktop-mesoscale profile
molstar.js/css              mesoscale.js/css + Burette adapter
        |                          |
        +------------+-------------+
                     v
        typed viewer bridge and Burette shell
                     |
                     v
       bounded observe/action/export contracts
```

The initial implementation should bundle the upstream `MesoscaleExplorer`
entry from the pinned Mol* package and add a small Burette adapter around it.
The adapter owns local URL resolution, host messages, error reporting, and
bounded observations. Upstream Mesoscale Explorer continues to own its internal
state tree, loaders, hierarchy semantics, and graphics profiles.

Recommended source ownership:

- `packages/mesoscale-runtime/`: typed Burette adapter and browser entrypoint;
- `scripts/build-mesoscale-runtime.mjs`: reproducible bundle generation;
- `PreviewExtension/Web/mesoscale.js` and `mesoscale.css`: generated assets;
- `config/web-runtime-profiles.json`: `desktop-mesoscale`, and only later
  `quicklook-mesoscale`;
- `apps/desktop/src/lib/mesoscale-documents.ts`: document classification and
  desktop-shell routing;
- `apps/desktop/src/hooks/`: dedicated bridge handlers, not new orchestration
  inside `App.tsx`;
- `apps/desktop/src-tauri/src/preview/`: safe local package staging and runtime
  manifest generation;
- `tests/fixtures/mesoscale/`: small reviewed fixtures only.

This layout keeps generated assets, desktop routing, Tauri file access, and
agent contracts independently testable. If a required upstream behavior is not
exported, adapt the smallest compiled Mol* module and record its upstream path,
tag, license, and local patch. Do not import all 5,600 upstream lines into a
Burette-owned fork.

## Contract Boundaries and Gates

| Boundary | Owner | Invariant | Gate evidence |
| --- | --- | --- | --- |
| Dependency | `package.json`, `bun.lock`, `vendor-assets.lock.json` | One exact Mol* version drives standard and mesoscale bundles. | Lockfile, asset hashes, base-viewer regression. |
| Runtime profile | `config/web-runtime-profiles.json` | Mesoscale assets load only for mesoscale documents; ordinary PDB does not pay their transfer/memory cost. | Runtime manifest and size report. |
| File classification | desktop routing plus Tauri preview service | `.cif`/`.bcif`, `.molx`/`.molj`, and `.zip` are classified by content and explicit intent, not extension alone. | Classifier fixture matrix. |
| Package security | Tauri package reader | No path traversal, remote implicit fetch, ZIP bomb, unbounded entry count, or asset escape. | Malicious archive tests and bounded diagnostics. |
| Scientific mapping | Mesoscale loader/state | Root/group/entity membership, instance transforms, and source identifiers are preserved. | Count and transform oracle report. |
| UI ownership | Mesoscale runtime plus Burette shell | Upstream scene semantics remain in the iframe; Burette owns document lifecycle and common shell actions. | Browser interaction smoke and state observation. |
| Bridge | viewer messages and agent session | All messages have a discriminant, document identity, schema version, limits, and explicit failure result. | Bridge contract tests and stale-source rejection. |
| Session/export | runtime plus host file actions | `.molx` round-trip is local and semantically stable; failed export never reports success. | Round-trip comparison and reopened visual state. |
| Performance | runtime metrics and perf smoke | Quality degrades deliberately by profile, never through silent data loss. | Device-stamped JSON/Markdown report. |
| Packaged desktop | Tauri bundle | The shipped app contains all assets and opens local files offline. | Flavored build/install and visible packaged-app smoke. |
| Finder Quick Look | Swift extension | It does not depend on a running desktop app and uses its own budget/fallback. | Native Quick Look semantic smoke and logs. |
| iPhone | `ios/BuretteMobile` | Mobile success is never inferred from macOS or browser success. | Simulator and real-device evidence in its own stage. |

## Format and Routing Contract

The file router must return a typed result such as:

```ts
type MesoscaleDocumentKind =
  | { kind: 'standard-structure'; format: 'cif' | 'bcif' }
  | { kind: 'mesoscale-cif'; dialect: 'cellpack' | 'petworld' | 'generic-mmcif' }
  | { kind: 'mesoscale-package'; manifestVersion: string }
  | { kind: 'mesoscale-session'; format: 'molx' | 'molj' }
  | { kind: 'unsupported'; reason: string };
```

Classification rules:

1. Standard PDB and existing Burette formats continue to use standard Mol*.
2. CIF/BCIF classification inspects parsed metadata: `pdbx_model` indicates
   Petworld; CellPack is identified from the frame header or
   `pdbx_struct_assembly.method_details`; otherwise the user may explicitly
   choose **Open as Mesoscale** for a large ordinary mmCIF scene.
3. `.molx` and `.molj` are ambiguous Mol* session formats. Inspect the session
   state for the mesoscale state object/version. If classification cannot be
   proven, present an explicit standard-versus-mesoscale choice and remember it
   only for that document, not globally by extension.
4. Generic packages are accepted only through **Open Mesoscale Package** or
   after detecting the expected manifest inside the archive. Never claim every
   `.zip` file or register the public ZIP type with Finder.
5. Local manifests may reference only staged package assets or explicitly
   user-approved local files. HTTP(S) assets are rejected in the offline
   milestone with a visible list of blocked references.
6. Unsupported schema versions, missing assets, non-finite transforms, and
   mismatched position/rotation lengths fail before creating a partial scene.

Proposed safety limits must be configurable only in the owning code and locked
after fixture measurement, not exposed as casual user preferences. The spike
must establish limits for archive bytes, expanded bytes, entry count, nesting,
per-asset bytes, total instances, and total decoded coordinates. The default
failure is a bounded error report; it is never a crash or a partially rendered
scene presented as complete.

## Delivery Stages

### Stage 0 — Freeze the standard-viewer baseline

Work:

- Record `v2.1.9` load, first-visible, selection, reset-camera, and memory
  behavior for `samples/mini.pdb`, `samples/mini.cif`,
  `samples/structures/proteins/1htb.pdb`, and the existing MVS samples.
- Reproduce and either fix or explicitly quarantine the `mini.pdb` unresolved
  state-tree dependency. A new renderer cannot hide an existing base failure.
- Record bundle/profile sizes and packaged desktop behavior on the target Mac.

Gate G0 — baseline accepted:

- Each fixture has a machine-readable outcome and screenshot/observe artifact.
- Known failures have an issue, minimal reproduction, and assigned status.
- No later stage may redefine the baseline after seeing its regression.

### Stage 1 — Upgrade the common Mol* dependency to `5.11.0`

Work:

- Update `package.json` and `bun.lock` together.
- Re-vendor standard `molstar.js/css` and update asset hashes.
- Review the upstream release delta, especially representation/transparency,
  size-theme updates, parsers, MVS snapshot defaults, VTP, and volume changes.
- Search for removed API usage; `getBoundary(transform)` was removed upstream
  and must not be called by Burette adapters.

Gate G1 — common dependency accepted:

- Standard fixtures match G0 semantically and visually.
- MVSJ/MVSX open and preserve existing bridge actions.
- `bun run check:vendor-assets`, focused viewer/bridge tests, and
  `bun run ci:fast` pass.
- Bundle-size delta is recorded and approved; no mesoscale code is yet loaded
  by a standard PDB runtime.

Rollback: revert the dependency/vendor commit without touching the later
mesoscale adapter. Do not develop the feature against an unpinned Mol* branch.

### Stage 2 — Prove an isolated mesoscale runtime

Work:

- Add the dedicated bundle entry and generated asset path.
- Embed the upstream `MesoscaleExplorer.create` app in a standalone Burette
  preview runtime without Burette-native controls.
- Load one small local fixture and the pinned 0.736-million-atom Petworld
  reference locally.
- Capture upstream standalone and Burette-embedded timings under the same
  viewport, graphics profile, model bytes, and device.

Gate G2 — technical spike accepted:

- Both fixtures reach a non-empty first frame with no unhandled exception.
- Hierarchy root/group/entity counts match the upstream reference.
- Standard Mol* runtime manifests do not include `mesoscale.js/css`.
- Burette median first-visible time is no worse than
  `max(upstream * 1.25, upstream + 1 s)` for the same input/profile.
- Peak renderer memory is measured, not inferred from file size.

Stop condition: if the isolated bundle needs a broad upstream source fork or
cannot meet the relative budget, stop before product UI work and decide whether
to upstream the required extension or narrow the supported formats.

### Stage 3 — Implement safe local ingest and scientific validation

Work:

- Add the typed classifier and safe archive staging.
- Support, in order: ordinary mesoscale mmCIF/BCIF, Petworld, CellPack, generic
  manifest with instanced molecular structures, PLY meshes, then `.molx/.molj`.
- Emit a bounded load report with file kind, source hash, groups, entities,
  instances, atomic/coarse element counts, mesh counts, warnings, load stages,
  and rejected assets.
- Preserve source labels and provenance in scene observations and exports.

Gate G3 — data fidelity accepted:

- Entity, group, instance, atom/coarse-element, and mesh counts exactly match
  fixture oracles.
- Sampled instance transforms match the oracle within `1e-5` per matrix value;
  sampled transformed coordinates match within `1e-3 Å`.
- Duplicate labels do not merge distinct entities; missing labels get stable
  generated identifiers without changing membership.
- Invalid archives and manifests fail atomically with bounded errors.
- A session save/reopen preserves hierarchy, visibility, styles, camera, and
  snapshot count.

### Stage 4 — Adapt the interaction model to Burette

Work:

- Keep the Burette document tab, title, dirty state, Save/Save As, diagnostics,
  and common camera actions in the host shell.
- Keep hierarchy-semantic controls close to the upstream runtime: tree search,
  group-by, recursive visibility, color, opacity, emissive state, clipping,
  focus, and entity/chain selection.
- Map upstream Ctrl entity selection and Shift range/chain selection to Mac
  keyboard semantics and expose equivalent accessible controls.
- Add graphics profiles: Ultra, Quality, Balanced, Performance, and Custom.
  Custom values must serialize into the document session.
- Add quick styles and existing upstream procedural camera/object animation
  only after selection and visibility behavior is stable.

Gate G4 — interaction accepted:

- A scripted browser smoke selects one entity, extends a selection, hides a
  group recursively, isolates another group, changes color/opacity, clips it,
  focuses the camera, undoes the action, and saves/reopens the result.
- The visible tree state and bounded agent observation agree after every step.
- Keyboard-only navigation reaches the hierarchy and all required actions.
- Loading, empty, unsupported, partial-warning, GPU-failure, and export-failure
  states are visible and actionable.
- No controls are duplicated between the Burette shell and iframe without an
  explicit ownership reason.

### Stage 5 — Complete bridge, tours, and export

Work:

- Add versioned messages for `mesoscale_ready`, `mesoscale_observe`,
  `mesoscale_select`, `mesoscale_style`, `mesoscale_visibility`,
  `mesoscale_clip`, `mesoscale_camera`, `mesoscale_snapshot`, and export
  results.
- Bound observations by count and string length; return summaries and stable
  identifiers instead of the full Mol* state tree.
- Support snapshot list/open/create/update/delete and snapshot animation.
- Sanitize snapshot Markdown and links before display.
- Export PNG and `.molx`; enable MP4 only if its encoder is local, bundled,
  cancellable, and verified in the packaged app.

Gate G5 — workflow accepted:

- Stale iframe sources and wrong document IDs are rejected.
- Every action returns success/failure with the affected stable IDs and
  warnings; timeouts never masquerade as success.
- Observation remains within the limits in `docs/agent-platform.md` for the
  largest fixture.
- PNG dimensions/content and `.molx` round-trip are verified. A cancelled or
  failed export leaves no corrupt final file.

### Stage 6 — Performance hardening and packaged macOS acceptance

Work:

- Tune sphere impostors, instance handling, unit merging/partitioning, Hi-Z,
  level of detail, pixel scale, sharpening, postprocessing, and selection
  picking per graphics profile.
- Add progressive status by load stage. Do not fake progress from elapsed time.
- Dispose assets, WebGL resources, observers, and generated runtime directories
  on document close/reload.
- Build and install a uniquely flavored app and test offline with network access
  disabled after inputs are staged.

Gate G6 — desktop production accepted:

- Standard fixture first-visible median is at most 5% slower than the G1
  baseline and does not retain mesoscale assets.
- For the 0.736-million-atom reference in Performance mode, settled p95 frame
  time is at most 33.3 ms, common control acknowledgement is at most 150 ms,
  and selection feedback is at most 250 ms on the recorded target Mac.
- After five open/close cycles, retained memory returns within 10% of the
  post-first-close level. During a five-minute idle/tour run, retained memory
  does not grow monotonically by more than 5%.
- If the device cannot meet a profile budget, the UI recommends a lower profile
  and records the fallback; it never drops entities silently.
- The flavored packaged app opens all supported local fixtures with Wi-Fi
  disabled and produces a device/OS/GPU/build-stamped report.

The absolute budgets above are provisional acceptance targets. G0/G2 must
record the device and upstream baseline; changing a target after measurement
requires a documented reason and product decision, not a silent test edit.

### Stage 7 — Finder Quick Look, view-only

Quick Look is not required to declare the desktop feature complete. Its first
scope is a view-only first frame, camera movement, and a clear **Open in
Burette** path. Full hierarchy editing, sessions, tours, and video export remain
desktop-only unless separately approved.

Work:

- Add `quicklook-mesoscale` only after desktop assets and budgets are stable.
- Register dedicated unambiguous session/package content types only if Finder
  routing can be proven. Do not register public `.zip`.
- Enforce a stricter memory/input threshold. Above it, render a bounded metadata
  summary or thumbnail plus **Open in Burette**, not a blank canvas or crash.

Gate G7 — Quick Look accepted:

- Browser Quick Look, forced native preview, and normal Finder Spacebar routing
  are reported separately.
- The extension works with the desktop process stopped.
- Native smoke checks a non-empty semantic frame or the explicit large-file
  fallback, not just lifecycle `ready`.
- Bundle identifier, content types, cache/container logs, and dev flavor are
  recorded in the report.

### Stage 8 — iPhone feasibility and product decision

Run only after G6. Measure bundle size, WebGL capability, memory pressure,
thermal behavior, touch selection, and representative scene limits on a real
iPhone. The likely mobile product is a reduced view/navigation profile with
automatic LOD and a hard local size threshold, not desktop parity. Ship no
mobile claim without Simulator and real-device evidence.

## Test Corpus

Keep small deterministic fixtures in Git and large reference models outside
Git with a manifest containing source URL, license, byte size, and SHA-256.

| Fixture | Purpose | Location policy |
| --- | --- | --- |
| `samples/mini.pdb`, `samples/mini.cif` | Standard Mol* regression and failure baseline. | Existing Git samples. |
| `samples/structures/proteins/1htb.pdb` | Ordinary protein visual/interaction regression. | Existing Git sample. |
| `samples/mvs/docking_story.mvsj/.mvsx` | Existing scene/session compatibility. | Existing Git samples. |
| Minimal generic manifest: 2 roots, 3 groups/entities, repeated instances | Hierarchy, transform, selection, and safe-package contracts. | New reviewed fixture under `tests/fixtures/mesoscale/`. |
| Minimal CellPack and Petworld CIF/BCIF | Dialect classification and hierarchy mapping. | Minimized upstream-derived fixtures with attribution. |
| Minimal PLY mesh package | Mesh path and bounds. | New reviewed fixture. |
| Two-snapshot `.molx` tour | Session round-trip and snapshot playback. | New reviewed fixture. |
| Invalid manifests, missing assets, NaN transforms, unequal rotation arrays | Atomic failure and diagnostics. | New reviewed fixtures. |
| Traversal, duplicate-entry, oversized-ratio, nested archive cases | Package security. | Generated in tests; do not store a huge bomb. |
| Upstream 0.736M Petworld reference | Large desktop performance/visual reference. | External cache, hash-pinned manifest. |

For every valid fixture, store a compact oracle: schema version, source hash,
root/group/entity IDs, counts, selected sampled transforms, expected warnings,
and allowed graphics-profile differences. Screenshots supplement these oracles;
they do not replace them.

## Validation Artifacts

Each gate that runs a live viewer writes under:

```text
build/reports/mesoscale/<commit>/<device-id>/
  environment.json
  input-manifest.json
  load-report.json
  scientific-oracle-report.json
  performance.json
  screenshots/
  browser-observe.json
  packaged-app-smoke.md
  quicklook-smoke.md
```

`environment.json` records commit, app and Mol* versions, macOS version, Mac
model, CPU/GPU, RAM, viewport, display scale, graphics profile, network mode,
and warm/cold-run status. Reports must distinguish parser time, hierarchy build,
GPU upload, first visible frame, settled frame time, peak/retained memory, and
export time.

## Focused Validation Commands

Commands are selected per touched boundary; broad/native checks run only at the
gates that require them.

```bash
# Dependency, generated assets, and profiles
bun run vendor:molstar
bun run check:vendor-assets
./scripts/size-report.sh

# Format and contract surfaces
bun scripts/check-preview-format-registry.mjs
bun tests/test-tauri-structure.mjs
bun tests/test-ui-shell-contract.mjs
bun tests/test-viewer-bridge-message-contract.mjs
bun tests/test-packaged-plugin-mirror.mjs

# Browser shell with a returned sessionDir/logPath/processId
bun scripts/burette-agent.mjs open --mode browser-dev-shell <fixture>
bun scripts/burette-agent.mjs observe --session-dir <sessionDir>

# Focused PR gate, then full frontend readiness at G6
bun run ci:fast
vp run ready

# Packaged macOS and Finder Quick Look, only with a dev flavor
BURETTE_DEV_FLAVOR=mesoscale-g6 ./scripts/build.sh
BURETTE_DEV_FLAVOR=mesoscale-g6 ./scripts/install.sh
BURETTE_DEV_FLAVOR=mesoscale-g7 ./scripts/build.sh
BURETTE_DEV_FLAVOR=mesoscale-g7 ./scripts/install.sh
BURETTE_DEV_FLAVOR=mesoscale-g7 ./scripts/quicklook-preview-smoke.sh <fixtures>
```

New focused tests should be added rather than inflating one central contract
file:

- `tests/test-mesoscale-document-classification.mjs`
- `tests/test-mesoscale-package-safety.mjs`
- `tests/test-mesoscale-runtime-contract.mjs`
- `tests/test-mesoscale-scene-oracles.mjs`
- `tests/test-mesoscale-bridge-contract.mjs`
- `tests/test-mesoscale-session-roundtrip.mjs`
- `tests/test-mesoscale-performance-contract.mjs`

## PR Sequence and Stop/Go Policy

Keep each non-mechanical change below roughly 500 changed lines and do not mix
generated bundle diffs with unrelated application logic.

1. **PR A — baseline and Mol* 5.11.0:** G0/G1 only.
2. **PR B — isolated runtime bundle:** build entry, asset profile, small adapter,
   and G2 evidence; no product UI.
3. **PR C — classifier and safe package staging:** G3 loaders, fixtures, oracles,
   and security tests.
4. **PR D — desktop routing and interaction:** Burette document integration and
   G4 UI/bridge behavior.
5. **PR E — sessions, tours, exports, and agent actions:** G5.
6. **PR F — performance and packaged desktop:** G6, full readiness, device
   report, and user-facing documentation.
7. **PR G — Finder Quick Look:** G7 only, with format metadata changes and
   native evidence kept together.
8. **PR H — iPhone:** only after a separate mobile scope decision and real
   device budget.

A PR may merge only when its gate is green or the missing case is explicitly
removed from that PR's claimed scope. A later surface cannot be used to waive a
failed earlier boundary. In particular: browser-dev does not prove packaged
desktop, packaged desktop does not prove Finder Quick Look, and macOS does not
prove iPhone.

## Definition of Done for the Desktop Feature

The macOS desktop mesoscale viewer is complete when all of the following are
true:

- supported local formats open offline in the flavored packaged app;
- scientific oracles prove hierarchy, counts, transforms, and provenance;
- required group/entity selection, styling, clipping, visibility, and camera
  workflows pass browser and packaged-app checks;
- graphics profiles meet the recorded target-device budgets or provide an
  explicit non-destructive fallback;
- `.molx` and PNG round-trips are verified and export failures are atomic;
- agent observations/actions are typed, bounded, document-scoped, and agree
  with visible state;
- standard PDB/CIF/MVS behavior remains within the G1 regression budget;
- asset hashes, runtime profiles, packaged plugin mirror, security tests,
  diagnostics, and user documentation are current;
- the final report names the exact commit, Mol* version, app bundle, device,
  fixtures, hashes, and passed gates.

Quick Look and iPhone are deliberately excluded from this desktop completion
statement until G7 and G8 pass independently.

## First Implementation Action

Start with PR A only: produce the G0 baseline, resolve or quarantine the
`mini.pdb` state-tree failure, update Mol* to `5.11.0`, regenerate standard
assets and hashes, and prove that the standard viewer is unchanged. Do not add
the mesoscale bundle until this gate is green; otherwise dependency regressions
and Mesoscale Explorer regressions cannot be attributed cleanly.
