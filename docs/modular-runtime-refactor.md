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
- FEP setup/network preview action callbacks and the current FEP setup request
  derivation now live in `apps/desktop/src/hooks/use-app-fep-workflows.ts`;
- drop action menu selection and dropped project-root callbacks now live in
  `apps/desktop/src/hooks/use-app-drop-actions.ts`;
- shared text/base64 download, export filename, temporary text id, and save
  dialog filter helpers now live in `apps/desktop/src/lib/file-export.ts`;
- `App.tsx` still owns Ketcher viewer/grid message routing that calls Ketcher
  and docking actions, xTB/conformer controller state, Mol* in-place
  replacement, grid save/export wiring, and the viewer/grid message bus. These
  are the remaining high-risk slices and should move only after each boundary
  has contract coverage for the exact message/action names.

## Current Epic Status

The original refactor epic is not complete yet. This branch has completed the
safe extraction baseline and part of the app-shell extraction, while keeping
the high-risk runtime boundaries intact.

| Epic area | Status | Notes |
| --- | --- | --- |
| Contract safety net | Partial | Existing contract tests were strengthened as modules moved, but the full named test matrix from the epic is not complete yet. |
| Dev-server extraction | Complete | Browser-dev endpoint modules now live under `apps/desktop/vite/browser-dev/`, with `vite.config.ts` acting as registration/composition. |
| App shell extraction | Partial | Several app hooks, pure chemistry libs, file-routing helpers, shared file-export helpers, the core file-open hook, the dock payload-open hook, browser-dev startup URL helpers/effects, pure Ketcher workflow helpers, Ketcher action callbacks, docking/collection action callbacks, grid append/xyzrender sheet callbacks, FEP setup/network callbacks, and drop action callbacks are extracted, but grid save/export wiring, xTB/conformer controllers, and message handling still live in `App.tsx`. |
| Opening workflow | Partial | `openDocuments`, `openPaths`, text/spectrum opening, path classification, pasted-structure opening, dock payload opening, browser-dev startup URL parsing, and browser-dev startup orchestration effects are in dedicated modules/hooks. |
| Ketcher workflow | Partial | Ketcher import queueing, draft/source helpers, import state, and import/export/sketch/grid-row action callbacks are extracted; viewer/grid message handlers that route `openInKetcher` and Ketcher sketch requests remain in `App.tsx`. |
| Grid workflow | Partial | Dirty-grid state, descriptor workflows, grid append, delimited append fallback, xyzrender sheet drops, and pose-review selection refresh are extracted; grid save/export and message handling remain in `App.tsx`. |
| Docking/collections/dock payloads | Partial | Dock payload opening plus docking document construction, dropped-structure docking, collection merge/save, and pose-review workspace action callbacks are extracted; message handlers that invoke these actions remain in `App.tsx`. |
| Viewer bridge | Not started | `window.message` handling remains in `App.tsx`; typed dispatch is still pending. |
| ShellActions/ShellViewState slicing | Not started | The compatibility surface is unchanged; slicing has not started. |
| Update flow | Complete | Update state/actions are in `use-app-updates.ts`. |
| Hardening pass | Not started | Trusted shell vs preview capability split, diagnostics privacy redaction, cache contract, scanner limits, renderer policy matrix, and doctor flow remain pending. |
| Runtime cache contract | Not started | No dedicated cache contract extraction yet. |
| Folder scanner job | Not started | No cancellable/limited scanner refactor yet. |
| Renderer policy contract | Not started | Desktop/Quick Look renderer-policy matrix remains pending. |
| External runtime doctor | Not started | No doctor flow has been added. |
| Diagnostics privacy | Partial | Diagnostics export action is extracted; privacy/redaction tests from the epic remain pending. |
| Viewer runtime decomposition | Not started | `PreviewExtension/Web/viewer.js` remains untouched as planned until stronger contracts exist. |
| CSS split | Not started | No CSS mechanical split has been attempted. |

## Verification Discipline

Every refactor slice must run the smallest targeted contract tests first. If a
slice touches runtime routing or UI workflow wiring, verify browser-dev behavior
on the intended surface before continuing.
