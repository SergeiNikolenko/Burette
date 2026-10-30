# Desktop Library Helpers

This directory contains reusable helpers and narrow adapters used by the React
desktop shell. Prefer pure, deterministic functions here. Hooks own React state
and side effects; `src/lib` should make those hooks smaller and easier to test.

## What Belongs Here

- Pure parsing, routing, formatting, and selection helpers.
- Small contract adapters such as file routing, viewer bridge envelopes,
  browser-dev document parsing, and runtime storage helpers.
- Shared type-oriented helpers for chemistry settings, docking documents,
  collection documents, spectrum selection, and structure summaries.
- Narrow platform wrappers such as `tauri.ts` and `window-scope.ts` when direct
  platform access must be centralized.

## What Does Not Belong Here

- React hooks, component state, layout decisions, or UI copy changes.
- New `invoke`, `listen`, `fetch`, `EventSource`, or `postMessage` side effects
  outside an explicit platform/transport adapter.
- Long-lived mutable globals unless the module is the existing owner of that
  runtime boundary.
- Test-specific shortcuts or hard-coded sample paths.

## Contract Rules

- Keep helper APIs domain-shaped and small. Avoid generic abstractions that only
  have one caller.
- Preserve existing file-routing, renderer-selection, and viewer-message
  contracts when extracting from hooks or `App.tsx`.
- If a helper encodes a public runtime contract, add or update a focused test
  near `tests/test-*-contract.mjs`.
- If a helper is pure, test it directly instead of validating it only through a
  full app smoke.

## Queued Viewer Requests

Capture `captureViewerActionTarget(documentId, sourceIsCurrent)` before queuing work.
For acknowledged `geometry_binding`/`update_geometry` actions, pass its result in
`runStructureViewerAction`'s third options argument, or in
`requestViewerAction`'s fifth options argument; the fourth argument remains AbortSignal.
Sender options may include `signal`, forwarded only through that existing fourth argument.
The target's read-only `isCurrent()` checks the original frame/window, source attributes,
read-only status and optional source-owner predicate before dispatch and acknowledgement.
Explicit `target: null` must fail rather than acquire a later frame. This target does not
identify internal Mol* Undo/restore: geometry writes also require a runtime owner receipt.
`geometry_binding` returns one `{ lease, text }` pair before a model is built; every
`update_geometry` carries that retained lease. Never acquire a new lease for an edit
computed from an older baseline. Legacy fire-and-forget actions keep their existing path.

## Validation

Pick the narrow test that covers the helper boundary:

```bash
bun tests/test-viewer-bridge-message-contract.mjs
bun tests/test-runtime-storage-contract.mjs
bun tests/test-text-structure-selection.mjs
bun tests/test-collection-documents.mjs
bun tests/test-docking-documents.mjs
bun tests/test-structure-brief.mjs
```

For broad shell helper changes, finish with:

```bash
bun run test:ui
```
