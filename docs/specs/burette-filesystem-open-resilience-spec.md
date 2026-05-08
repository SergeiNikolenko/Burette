# Burrete Filesystem Open Resilience Spec

## Summary

Make file opening resilient to slow or unreliable storage: iCloud, Dropbox,
Google Drive, SMB/NFS mounts, external drives, and large molecular files. A
single slow path must not freeze the app shell, block other open documents, or
leave stale generated runtimes behind.

## Goals

- Keep the main UI responsive when a selected file is slow to read.
- Prevent one blocked file read from delaying other files in a multi-open.
- Bound preview generation time and surface clear errors.
- Avoid stale results when the user closes a document or opens another version
  while an older task is still running.
- Keep the implementation storage-agnostic.

## Non-Goals

- Provider-specific cloud integration.
- Forcing cloud materialization.
- A persistent metadata index.
- Kernel-level cancellation of blocked filesystem syscalls.

## Approach

### Bounded concurrent opens

Open multiple selected documents through a bounded worker queue instead of a
single sequential operation. Each document reports success or failure
independently.

### Per-document timeout

Wrap file read and runtime generation in a timeout suitable for local preview
work. On timeout:

- return an error for that document;
- keep other documents processing;
- leave no partial runtime directory except logs needed for diagnosis.

### Generation staging

Write runtime files into a temporary directory and atomically promote the
directory only after all required files are present. This prevents the web view
from loading incomplete generated HTML/data.

### Logging

Log these phases with path, extension, renderer, bytes, and elapsed time:

- canonicalize path;
- read file;
- choose renderer;
- copy shared assets;
- write runtime;
- first web load signal when available.

## Expected Files

- `src-tauri/src/lib.rs`
- future `src-tauri/src/preview_runtime.rs` if runtime generation is split
- `src/App.tsx`
- tests and fixtures under `tests/`

## Acceptance Criteria

- Opening one slow/unavailable file does not block other selected files.
- Timeout produces a deterministic user-visible error.
- No incomplete runtime directories are selected as active documents.
- Closing a document while it is opening prevents stale activation.
- Logs identify the phase that consumed time.

