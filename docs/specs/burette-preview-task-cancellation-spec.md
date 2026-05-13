# Burrete Preview Task Cancellation Spec

## Summary

Prevent stale preview generation from mutating current UI state. Burrete's
workspace-switch hang spec uses epochs and cancellation flags for background
work; Burrete needs the same idea for preview generation, renderer preference
changes, and multi-file opens.

## Goals

- A stale open task cannot activate a closed or superseded document.
- Preference changes cancel or supersede older runtime generations.
- Multi-open failures do not poison successful documents.
- Cache cleanup cannot delete a runtime currently being loaded.
- Background work reports clear final states.

## Non-Goals

- Cancelling kernel-blocked file reads.
- Rewriting the renderer runtime around a worker pool in v1.
- Persisting task state across app restarts.

## Model

Each preview task has:

- `taskId`: unique per generation request.
- `documentId`: stable per canonical file path.
- `generation`: incremented whenever the document is reopened or preferences
  change.
- `cancelled`: cooperative flag checked between phases.

Before committing a generated runtime to UI state, the task verifies that:

- its document still exists in the store;
- its generation is still current;
- it has not been cancelled.

## Cancellation Points

- Before file read.
- After file read.
- After renderer routing.
- After writing generated runtime files.
- Before adding or replacing a document in the UI store.
- Before cache cleanup removes old directories.

## Expected Files

- `apps/desktop/src/stores/molecule-store.ts`
- `apps/desktop/src/stores/settings-store.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src-tauri/src/preview/runtime.rs`
- future runtime/task modules if split from `preview/runtime.rs`

## Acceptance Criteria

- Closing a document while it is opening does not reactivate it.
- Rapid renderer preference changes settle on the final selected preference.
- Opening the same file repeatedly leaves one active tab for the canonical path.
- Cache cleanup never removes the active runtime path.
- Logs identify cancelled and superseded tasks.
