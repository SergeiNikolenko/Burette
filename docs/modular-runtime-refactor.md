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

## Stage 3: App Composition Refactor

Move `App.tsx` logic in dependency order:

1. pure helpers with no React state;
2. update/platform actions;
3. document opening as `useDocumentOpening`;
4. dock/sidebar interaction wrappers;
5. Ketcher, grid, descriptors, docking, conformer, and xTB controllers;
6. viewer/grid message bus as the final high-risk extraction.

Keep `ShellActions` stable while internal slices are introduced.

## Verification Discipline

Every refactor slice must run the smallest targeted contract tests first. If a
slice touches runtime routing or UI workflow wiring, verify browser-dev behavior
on the intended surface before continuing.
