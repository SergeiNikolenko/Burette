# Source-owned spectrum atom selection

The private `select_source_atom` viewer action addresses one atom by the native
`atomicHierarchy.atomSourceIndex` column. Its `sourceSha256` hashes the exact
rendered XYZ or MOL parser-input text; `frameIndex` and `frameCount` name the native trajectory,
not the scientific file frame count. The caller supplies the NMR source atom
ordinal directly. Matching elements, coordinates, or atom counts is insufficient.

The receiver captures the active viewer and its exact source ancestry before
lazy loading or hashing. A request-local subscription revokes that capture after
native edits (including edit/Undo), replacement, or a newer native selection.
The existing Geometry preview generation makes newer gestures win. Single-frame
XYZ uses the existing Geometry binding's effective source text; steps use the
exact original multi-frame text. Selection preserves geometry, camera and Undo.
Repeated assembly instances are rejected rather than guessed.

The action uses the existing request/ack transport and bounded retired-status
receipts. Abort and timeout send a private `agent-action-cancel` message; its request-local
receiver requires the exact request ID and sending Window. It cannot cancel a
newer row or an action from another sender. Selection receipts retain a bounded
60-second retirement window, including after the request deadline. Callers must capture the target before dispatch and preserve it through
any pending work. The MOL path requires its exact native MOL transformer and frame 0/1; it hashes
the direct parser input. SDF is not substituted. Actual Browser acceptance remains
separate from native component tests.

`test:spectrum-atom-selection` runs the real Mol* receiver, Geometry edits and
native selection state, including source/frame mismatch, replacement, edit/Undo
and competing native/row gestures. The runtime test uses the real minimized
660-byte ORCA NMR fixture; it does not substitute a fabricated producer table.

## Spectra consumer

The Spectra dock prepares the exact source digest before a row gesture. Table,
plot and keyboard choices share the NMR `atomIndices` address. The source panel
remains reusable without a molecular viewer through its optional selection
callback. The dock activates that callback only through the current source owner,
source-editing operation and captured viewer target. Unmount, source/frame change
and a newer gesture cancel the prior request. Current errors remain actionable;
retired responses cannot publish into the new panel. The exact registered revision
is a subscribed owner; a request-local source-store listener revokes a pending
request on intermediate revision replacement, including a rollback before React
commits. Unrelated documents do not cancel the current selection.

The consumer binds registered, frame-scoped NMR data to materialized XYZ and the
exact file-scoped NMR dataset of a validated CJSON graph to its materialized MOL.
`useSceneSpectra` exposes `text` and a separate `nativeFrame`: a scientific final
frame maps to native 0/1, while a steps document requires the exact reported
trajectory. A CJSON graph keeps its explicit scientific activeFrameIndex while
its native MOL address is always 0/1. Source atom ordinals come from the declared
CJSON atom table, never element or coordinate matching. Ordinary ORCA NMR is
covered by the real compiled panel/worker,
request/ack transport and native Mol* selection test; actual Browser remains a
separate acceptance lane.


The built-MOL selection lane reuses the ordinary CJSON import fixture, including
its explicitly authored seven-set variants. It executes the full vendored MolStar
IIFE with normal viewer behaviors, real request/ack and the compiled Spectra owner.
Run the existing vendor:molstar build before test:cjson-nmr-selection; no new facade
exports are introduced. The unchanged original CJSON import cases also run in
that lane. Full pinned upstream producer validation is recorded separately.
