# Clean scientific source attachments

The browser agent shell keeps explicit MCD companions for unchanged imported
scientific sources in `scientific-attachments`, separately from dirty source
checkpoints. IndexedDB schema version 3 adds that store without rewriting
Originals or existing drafts. Both stores share one transaction and the existing
64-record, 16 MiB-per-record and 32 MiB-total limits. Blob bytes and dense numeric
arrays count toward the same budget; old records are not evicted.

A clean attachment retains the browser-tab scope, durable Original path, name,
size and SHA-256, exact registered materialized XYZ text and scientific data,
and selected companion bytes with exact scientific frame/revision bindings.
It stores no dirty flag, source-editing session, renderer lease or Undo history.

`captureBrowserMcdAdmission` belongs at the scene-spectra owner before any picker
or file read. It captures the actual document, scientific revision and Original,
source-editing operation and session snapshot. The caller releases it in `finally`,
including when the picker is cancelled. `prepare(file)` reads only the explicitly
selected file, retaining compression wrapper bytes, and returns bounded source
block summaries. `apply(blockIndex)` attaches the explicitly chosen block after
checking the same source lifetime and a compare-and-swap write. It does not infer
frame correspondence from equal atom counts, geometry, file names or nearby files.

An edit, close, replacement or competing attachment makes the captured operation
stale. Existing unsaved or persisted source drafts must be recovered or discarded
before using this clean-admission route; dirty paired sources use their separate
checkpoint integration. Attaching metadata never makes a fake XYZ comment edit
or creates an editing session merely to trigger persistence.

Ordinary close/reopen and same-tab startup restore verify the unchanged Original
and restore the exact saved materialization before document adoption. Its original
import token and MCD source receipt remain unchanged; reopening does not reinterpret
an older receipt against newly generated XYZ. Another browser tab's scope does not
borrow the attachment. Closing a document leaves the clean attachment available
for its next open in the same browser-tab session.

The source prerequisite is tested with actual ordinary import/startup hooks,
source controllers, IndexedDB, compressed-file decoding and native MolStar CPU
MOLX serialization. Original and companion bytes survive export and reopen, and
late file reads or staged reopen results cannot replace a newer document. This
source validation does not establish actual Browser, packaged macOS,
Quick Look or iPhone acceptance. The sidecar fixtures are authored
format cases; no real producer MCD dataset is claimed.

## Explicit MCD selection

In the browser agent shell, Show spectra is available for a clean scientific XYZ
import with a retained Original even when the file has no built-in spectrum. The
Spectra owner offers Add MCD. The real file chooser accepts an explicitly selected
`.mcd` or `.mcd.gz`; it never searches for adjacent files. Source ownership is
captured synchronously before the chooser opens. One parsed block is admitted
directly; multiple blocks require an explicit range/row-count choice and Add.
Cancel releases the pending operation and does not create a dirty source session.

After admission, a one-shot request selects the separate companion dataset for
that exact scientific revision. Subsequent user choices belong to the existing
bounded Spectra display memory; returning from Settings does not replay the
attachment selection over them. Close/reopen restores the exact registered XYZ,
science and paired Originals through the clean-attachment store.

Malformed files, changed Originals, stale sources and storage failures are not
reported as successful additions. Source/provider changes retire the pending UI.
Native documents, logical MOLX sources, dirty sources, Chemical JSON/MOL and
non-session browser surfaces are not eligible for this clean XYZ picker. Those
routes remain separate MCD parity work; their existing spectra stay viewable.

`test:mcd-companion-picker` checks real chooser ordering, explicit blocks, gzip,
cancellation and failure preservation. `test:mcd-companion-activation` exercises
ordinary import and Compute routing, source-owned plotting, native MolStar CPU
MOLX serialization with exact Original bytes, close/reopen and display-choice
remount. These authored sidecar tests do not replace actual Browser acceptance
or a retained real-producer MCD dataset.
