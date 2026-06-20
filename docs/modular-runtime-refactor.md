# Modular Runtime Refactor

This document tracks the staged refactor that moves Burrete runtime logic out of
large composition files without changing observable behavior.

## Goal

Keep the current app, Quick Look, browser-dev, and chemistry workflows working
while turning the largest files into composition roots:

- `apps/desktop/vite.config.ts` should become a thin Vite config plus dev-server
  plugin registration.
- `apps/desktop/src/App.tsx` should become a React composition root that wires
  existing hooks, controllers, state, and shell actions.
- `PreviewExtension/Web/viewer.js` should stay stable until the desktop
  extraction is covered by contract tests.

## Non-Negotiable Compatibility

Do not change these contracts during extraction:

- browser-dev endpoint paths, methods, status codes, and response shapes;
- Quick Look bundle identifiers and content types;
- `ShellActions` and `ShellViewState` public names consumed by layout code;
- viewer bridge message types and local storage keys;
- generated app, extension, and preview asset paths.

## Stage 1: Contract-Safe Vite Extraction

First move only low-risk Vite helpers:

- `apps/desktop/vite/build-plugins.ts` for Ketcher CSS/Raphael shims, manual
  chunks, and module preload filtering.
- `apps/desktop/vite/browser-dev/http.ts` for shared JSON request parsing and
  JSON responses.

The endpoint handlers can keep their current location until the tests verify
behavior rather than physical placement.

Checks:

```bash
bun tests/test-ui-shell-contract.mjs
bun tests/test-text-file-viewer-contract.mjs
bun tests/test-dev-namespace.mjs
```

## Stage 2: Browser-Dev Endpoint Modules

After Stage 1 is green, split browser-dev handlers by endpoint group:

- `files.ts`: `/__burette/dev-files`, `/read-file`, `/read-text-file`,
  `/file-bundle`;
- `assets.ts`: `/__burette/rdkit-wasm`, `/app-icon/`;
- `desmond.ts`: `/__burette/desmond-preview`;
- `xyzrender.ts`: `/__burette/xyzrender`;
- `descriptors.ts`: `/__burette/descriptors`;
- `msbuddy.ts`: `/__burette/msbuddy`;
- `conformer-inline.ts`: `/__burette/generate-3d-conformer`;
- `conformer-jobs.ts`: conformer status, prepare, run, and cancel endpoints;
- `xtb.ts`: xTB status, install, run, and cancel endpoints;
- `agent-session.ts`: `/__burette/agent-session/`.

Keep xTB and conformer job lifecycle logic in one slice each so process
registration, cancellation, and cleanup stay auditable.

Current Stage 2 progress:

- browser-dev route registration has been split out of `vite.config.ts` by
  endpoint group under `apps/desktop/vite/browser-dev/`;
- file discovery/content, assets, Desmond, xyzrender, descriptors, MSBuddy,
  inline conformer generation, conformer job lifecycle, xTB job lifecycle, and
  agent-session endpoints now live in dedicated modules;
- `vite.config.ts` is now the composition point for these route modules instead
  of the owner of the endpoint bodies.

## Stage 3: App Composition Refactor

Move `App.tsx` logic in dependency order:

1. pure helpers with no React state;
2. update/platform actions;
3. document opening as `useDocumentOpening`;
4. dock/sidebar interaction wrappers;
5. Ketcher, grid, descriptors, docking, conformer, and xTB controllers;
6. viewer/grid message bus as the final high-risk extraction.

Keep `ShellActions` stable while internal slices are introduced.

Current Stage 3 progress:

- app status, bootstrap, resize, sidebar project derivation, update actions,
  Quick Look startup, maintenance actions, file/path actions, descriptor
  workflows, dirty-grid state, diagnostics export, and clipboard opening now
  live in dedicated hooks;
- chemistry settings, chemistry job request wrappers, direct chemistry job
  guards, and conformer-generation text helpers now live under
  `apps/desktop/src/lib/`;
- file-routing helpers now live in `apps/desktop/src/lib/file-routing.ts`;
- core file opening, text opening, spectrum opening, path classification, and
  pasted structure opening now live in `apps/desktop/src/hooks/use-app-file-open.ts`;
- file picker and recent-structure open action callbacks now live in
  `apps/desktop/src/hooks/use-app-open-actions.ts`;
- dock payload opening now lives in
  `apps/desktop/src/hooks/use-app-dock-payload-open.ts`;
- browser-dev startup URL parsing helpers now live in
  `apps/desktop/src/lib/browser-dev-startup.ts`;
- browser-dev startup orchestration, persisted-session refresh, and persisted
  tab reopen effects now live in
  `apps/desktop/src/hooks/use-app-startup-effects.ts`;
- Ketcher import queueing, 3D-source detection, and draft molfile detection
  helpers now live in `apps/desktop/src/lib/ketcher-workflow.ts`;
- Ketcher import state and import/export/sketch/grid-row action callbacks now
  live in `apps/desktop/src/hooks/use-app-ketcher-actions.ts`;
- docking document opening, dropped-structure docking, molecule collection
  merge/save, and pose-review workspace action callbacks now live in
  `apps/desktop/src/hooks/use-app-docking-workflows.ts`;
- grid record append, delimited append fallback, xyzrender sheet drop, and
  pose-review selection refresh callbacks now live in
  `apps/desktop/src/hooks/use-app-grid-workflows.ts`;
- grid export, molecule export, Save, and Save As message handling now lives in
  `apps/desktop/src/hooks/use-app-grid-file-actions.ts`;
- grid paging, desktop structure-text reads, and xyzrender card render message
  handling now live in `apps/desktop/src/hooks/use-app-grid-runtime-messages.ts`;
- grid control message routing for Ketcher handoff, descriptor runs, perf
  metrics, clipboard copy, and dirty-state updates now lives in
  `apps/desktop/src/hooks/use-app-grid-control-messages.ts`;
- viewer text and binary export message handling now lives in
  `apps/desktop/src/hooks/use-app-viewer-file-actions.ts`;
- shared viewer/grid xyzrender sheet-item rendering message handling now lives
  in `apps/desktop/src/hooks/use-app-xyzrender-sheet-messages.ts`;
- viewer first-render metric, error status, and xyzrender orientation/preset/
  controls message handling now live in
  `apps/desktop/src/hooks/use-app-viewer-runtime-messages.ts`;
- viewer runtime-file and preview-data request message handling now lives in
  `apps/desktop/src/hooks/use-app-viewer-runtime-file-messages.ts`;
- SDF Molstar, pose-review, and grid open message handling now lives in
  `apps/desktop/src/hooks/use-app-sdf-viewer-messages.ts`;
- docking pose-change message handling now lives in
  `apps/desktop/src/hooks/use-app-docking-pose-messages.ts`;
- viewer shell/state message handling for command palette, sidebar toggle,
  ligand selection, and renderer-state updates now lives in
  `apps/desktop/src/hooks/use-app-viewer-state-messages.ts`;
- viewer renderer-switch message handling now lives in
  `apps/desktop/src/hooks/use-app-renderer-message.ts`;
- viewer-origin Ketcher handoff message handling now lives in
  `apps/desktop/src/hooks/use-app-ketcher-viewer-messages.ts`;
- host-level viewer acknowledgement and agent action-result message handling now
  lives in `apps/desktop/src/hooks/use-app-viewer-host-messages.ts`;
- viewer-origin Generate 3D conformer message handling now lives in
  `apps/desktop/src/hooks/use-app-viewer-conformer-messages.ts`;
- viewer-origin Molstar context/open-separate-view message handling now lives
  in `apps/desktop/src/hooks/use-app-molstar-context-messages.ts`;
- grid-origin Generate 3D selection message handling now lives in
  `apps/desktop/src/hooks/use-app-grid-conformer-messages.ts`;
- top-level viewer/grid message listener dispatch now lives in
  `apps/desktop/src/hooks/use-app-viewer-bridge-messages.ts`;
- viewer iframe lookup, known-source gating, and source/fallback
  `postMessage` transport helpers now live in
  `apps/desktop/src/lib/viewer-bridge.ts`;
- ShellViewState compatibility assembly now lives in
  `apps/desktop/src/hooks/use-app-shell-view-state.ts`;
- ShellActions compatibility assembly now lives in
  `apps/desktop/src/hooks/use-app-shell-actions.ts`: `App.tsx` wires the
  `useAppShellActions` adapter while job-history, project, dock-drop,
  close/dirty-cleanup, recent, and update action groups stay behind the same
  compatibility boundary;
- FEP setup/network preview action callbacks and the current FEP setup request
  derivation now live in `apps/desktop/src/hooks/use-app-fep-workflows.ts`;
- drop action menu selection and dropped project-root callbacks now live in
  `apps/desktop/src/hooks/use-app-drop-actions.ts`;
- workspace/project folder action callbacks now live in
  `apps/desktop/src/hooks/use-app-workspace-actions.ts`;
- xTB/CREST job status, persisted settings, job lists, startup status refresh,
  and cancel callbacks now live in
  `apps/desktop/src/hooks/use-app-chemistry-jobs.ts`;
- CREST/PRISM job runners, active-operation routing, selected-ligand input
  extraction, and Molstar context input helpers now live in
  `apps/desktop/src/hooks/use-app-conformer-workflows.ts`;
- 3D conformer generation and the Molstar in-place replacement sender now live
  in `apps/desktop/src/hooks/use-app-generate-3d-conformer.ts`, while the
  existing host-message acknowledgement still resolves the shared pending
  replacement ref;
- Molstar text-selection and structure-action senders now live in
  `apps/desktop/src/hooks/use-app-molstar-action-senders.ts`;
- Molstar xTB context request/response listener lifecycle now lives in
  `apps/desktop/src/hooks/use-app-molstar-xtb-context.ts`;
- xTB job runners, active-operation routing, Ketcher sketch optimization,
  grid scoring, pose refinement, and FEP preflight callbacks now live in
  `apps/desktop/src/hooks/use-app-xtb-workflows.ts`;
- shared text/base64 download, export filename, temporary text id, and save
  dialog filter helpers now live in `apps/desktop/src/lib/file-export.ts`;
- browser-dev structure bundle expansion and `xtbopt.log` companion filtering
  now live in `apps/desktop/src/lib/browser-dev-structure-bundles.ts`;
- content-based spectrum path detection now lives in
  `apps/desktop/src/lib/content-spectrum-detection.ts`;
- preview SVG-to-PNG/base64 helpers now live in
  `apps/desktop/src/lib/preview-image-export.ts`;
- clipboard write and selection fallback helpers now live in
  `apps/desktop/src/lib/clipboard.ts`;
- diagnostics bundle export now redacts local filesystem paths from copied app
  logs, preview traces, Quick Look logs, and manifest `recentErrors` entries;
- preview cache clearing now has a Rust contract for preserving packaged viewer
  assets while removing volatile preview/render/cache entries;
- core renderer selection now has an explicit matrix contract for Molstar,
  external xyzrender, grid requests, MD trajectories, and converted
  external-only formats;
- project folder structure scanning now uses a bounded backend traversal for
  sidebar/project roots, with file-count and directory-count contracts;
- trusted shell capability boundaries now have a structural contract: Tauri
  command permissions remain limited to shell windows and bundled preview
  runtime artifacts do not call Tauri IPC directly;
- external runtime doctor now has a read-only backend aggregate for xyzrender,
  descriptor Python/RDKit, Datamol/RDKit conformer Python, CREST, PRISM, xTB,
  and Schrodinger status sources, exposed through trusted shell
  maintenance/settings actions and a browser-dev parity endpoint;
- `App.tsx` still owns the top-level shell composition and remaining runtime
  hardening boundaries. These are the remaining high-risk slices and should
  move only after each boundary has contract coverage for the exact
  message/action names.

## Current Epic Status

The original refactor epic is not complete yet. This branch has completed the
safe extraction baseline and part of the app-shell extraction, while keeping
the high-risk runtime boundaries intact.

| Epic area | Status | Notes |
| --- | --- | --- |
| Contract safety net | Partial | Existing contract tests were strengthened as modules moved, but the full named test matrix from the epic is not complete yet. |
| Dev-server extraction | Complete | Browser-dev endpoint modules now live under `apps/desktop/vite/browser-dev/`, with `vite.config.ts` acting as registration/composition. |
| App shell extraction | Partial | Several app hooks, pure chemistry libs, file-routing helpers, shared file-export/clipboard/preview-image helpers, browser-dev bundle helpers, content spectrum detection, the core file-open hook, file picker/recent-open actions, the dock payload-open hook, browser-dev startup URL helpers/effects, pure Ketcher workflow helpers, Ketcher action callbacks, docking/collection action callbacks, grid append/xyzrender sheet callbacks, grid save/export/runtime/control/conformer message handling, viewer export/runtime/runtime-file/state/renderer/Ketcher/host/conformer/Molstar-context message handling, top-level viewer/grid dispatch, xTB/CREST status/settings/cancel state, CREST/PRISM workflow runners, 3D conformer generation/Molstar replacement sender, Molstar text-selection/action senders, Molstar xTB context request handling, xTB workflow runners, shared xyzrender sheet message handling, SDF open message handling, docking pose-change message handling, FEP setup/network callbacks, drop action callbacks, workspace/project-folder callbacks, ShellViewState assembly, and ShellActions assembly are extracted. Remaining app-shell work is smaller composition cleanup plus runtime hardening boundaries. |
| Opening workflow | Partial | `openDocuments`, `openPaths`, text/spectrum opening, path classification, pasted-structure opening, file picker/recent-open actions, dock payload opening, browser-dev startup URL parsing, and browser-dev startup orchestration effects are in dedicated modules/hooks. |
| Ketcher workflow | Partial | Ketcher import queueing, draft/source helpers, import state, import/export/sketch/grid-row action callbacks, grid-origin `openInKetcher` message routing, and viewer-origin Ketcher handoff messages are extracted; broader Ketcher sketch state still flows through `App.tsx`. |
| Grid workflow | Partial | Dirty-grid state, descriptor workflows, grid append, delimited append fallback, xyzrender sheet drops, pose-review selection refresh, grid save/export message handling, grid paging/read/xyzrender-card runtime messages, grid control/conformer message routing, SDF grid open message handling, and shared viewer/grid dispatch are extracted. |
| Docking/collections/dock payloads | Partial | Dock payload opening plus docking document construction, dropped-structure docking, collection merge/save, pose-review workspace action callbacks, SDF pose-review message handling, Molstar context handoff, docking pose-change synchronization, and shell-action wiring are extracted; deeper domain-specific docking runtime boundaries remain in the app composition. |
| Viewer bridge | Partial | Grid-origin file/runtime/control/conformer messages, viewer-origin export/runtime/runtime-file/state/renderer/Ketcher/host/conformer/Molstar-context messages, shared viewer/grid xyzrender sheet rendering, SDF open messages, docking pose-change messages, the top-level `window.message` dispatch, viewer source/transport helpers, and Molstar xTB context response listener now delegate to dedicated hooks/libs. |
| ShellActions/ShellViewState slicing | Complete for compatibility assembly | `ShellViewState` derived-field assembly is behind `createAppShellViewState`; `ShellActions` now flows through `useAppShellActions` and `createAppShellActions`, with job-history, project, dock-drop, close/dirty-cleanup, recent, and update action groups behind the same compatibility adapter. |
| Update flow | Complete | Update state/actions are in `use-app-updates.ts`. |
| Hardening pass | Partial | Trusted shell capability boundaries, diagnostics privacy redaction, cache clearing, scanner limits, renderer policy matrix, and doctor flow now have narrow contracts; full preview capability review, runtime storage inventory, cancellable scanner UX, and remaining Quick Look/browser-dev parity checks remain pending. |
| Runtime cache contract | Partial | `clear_preview_cache` now delegates to a tested cache-directory helper that preserves `viewer/assets` and removes volatile preview/render/cache entries; broader runtime storage/cache inventory remains pending. |
| Folder scanner job | Partial | Project/sidebar folder scanning now has backend file and directory limits with Rust tests; a fully cancellable/background scanner with user-visible truncation status remains pending. |
| Renderer policy contract | Partial | Core renderer selection now has an explicit matrix test for Molstar/external xyzrender/grid-request/trajectory/external-only routing; browser-dev and Quick Look parity checks still need a higher-level surface test. |
| External runtime doctor | Complete for current scope | A read-only Tauri/browser-dev doctor report now aggregates xyzrender, descriptor Python/RDKit, Datamol/RDKit conformer Python, CREST, PRISM, xTB, and Schrodinger status sources and is surfaced through trusted shell settings/command-palette actions. |
| Diagnostics privacy | Partial | Diagnostics export action is extracted and diagnostics bundle local-path redaction is covered by Rust tests; broader privacy review for every copied artifact remains pending. |
| Viewer runtime decomposition | Not started | `PreviewExtension/Web/viewer.js` remains untouched as planned until stronger contracts exist. |
| CSS split | Not started | No CSS mechanical split has been attempted. |

## Verification Discipline

Every refactor slice must run the smallest targeted contract tests first. If a
slice touches runtime routing or UI workflow wiring, verify browser-dev behavior
on the intended surface before continuing.
