# Browser Source Checkpoints

The browser agent shell's source checkpoints share `burette-browser-imports`
IndexedDB with immutable imported files. Version 2 adds a `source-checkpoints`
store without rewriting the existing `files` store. A sessionStorage identifier
scopes drafts to the current browser tab; native, MCP, hosted widgets, web demo
and explicit server workspaces do not enter this persistence lane.

Each checkpoint contains exact base/current text and an optional matching
ScientificDocument, including internal coordinates. The scientific validator
checks its geometry against the current XYZ. The immutable Original stays in
`files`; its SHA-256, name and byte count bind the checkpoint to that import.
No renderer leases, native Undo, or serialized source-editing session are stored.

Records use compare-and-swap IDs. A delayed write or discard cannot replace a
successor. Limits are 3,000,000 bytes per source text, 16 MiB per checkpoint,
64 checkpoints and 32 MiB total. Capacity or validation failures preserve the
previous records; nothing is automatically evicted. A replaced Original fails
validation instead of adopting an unrelated draft.

The storage prerequisite is tested with `test:browser-source-checkpoint` and
`check:browser-source-checkpoint`. Source admission and startup recovery are a
separate dependent integration stage.

## Source Admission And Recovery

After normal browser import reopening, the source controller admits a matching
checkpoint as a new dirty session. The selected dock stays selected. The normal
preview adapter stages the edited text; it is never described as the saved
Original. Matching scientific data, including named Z-matrix coordinates and
dummy references, belongs to the restored text. No older edit history is replayed.

Close waits for pending source admission before checking dirty state. Cancel keeps
the draft; confirmed Discard waits for its conditional checkpoint deletion. Source
replacement invalidates old queued writes. Retired drafts keep the existing
Save copy / Discard / Cancel recovery flow. Read or write failures preserve stored
bytes and are reported; they do not authorize an unrelated filesystem path.

`test:browser-source-recovery` runs the real compiled startup/source-controller,
scientific import, IndexedDB, and preview-adapter handshake with reload, pending
close, source replacement and Original checks. The renderer ready receipt in that
fixture is explicit; actual browser/renderer acceptance remains separate.
