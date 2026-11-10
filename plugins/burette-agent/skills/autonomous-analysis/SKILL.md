---
name: autonomous-analysis
description: Analyze molecular structures and export Mol* scenes without a mounted panel or an open chat.
---

# Autonomous molecular work

Use this workflow for PDB/mmCIF inspection, heavy-atom contacts, buried area,
protein-chain TM-align, and PNG publication. Jobs use immutable local source
snapshots; no visible viewer, browser tab or localhost server is needed.

1. Reuse this chat's sessionId or call `burette.open_molecular_session` with one
   authorized `file` or explicit public `pdbId`, optional `additionalFiles`, and
   a fresh UUID `openRequestId`. Retry that same ID with identical inputs.
   Retain the returned document IDs. Add comparison files with
   `burette.add_molecular_files` with `paths` or `pdbIds`, for example
   `pdbIds: ["1AKE"]`. Explicit accessions authorize their public download.
2. Call `burette.run_molecular_operation` with that sessionId, one fresh UUID
   `requestId`, and a typed action. Reuse the same requestId only for delivery
   retries of the identical operation. `inspect` returns chain inventory.
   Selections use `{documentId, chain, residues?}` with author numbering.
3. Poll `burette.molecular_job` until completed, failed, cancelled or interrupted.
   queued/running is not completion. Continue the task while the panel is
   absent or stale. Read bounded result metadata and report the actual method.
   Cancel only when requested or when abandoning a task you started.
4. For an image, pass `type: "render"`, an absolute `outputPath`, width/height
   and `scene` (layers, labels, transforms, background and camera). Every layer
   names a documentId and representation. Uncolored ball-and-stick uses element
   colors. Label GFP explicitly with chain A, residue 66, componentId CRO.
   Rendering starts an installed headless Chromium only for the export; a
   missing browser is a typed rendering prerequisite, not a reason to abandon
   available calculations or open an unrelated app.
5. Verify completed render artifacts: PNG, `.render.json` metadata and a
   self-contained `.mvsj` scene. Existing files are versioned, never overwritten.
   Present the image to the user. When an interactive view is wanted, call
   `burette.show_molecular_session` using the existing sessionId and the completed
   render requestId. Creation of this panel does not prove it is visibly ready.
   Check `nativeAttachment.supported` before attaching an exported scene: its
   embedded sources also count toward the native 8-document/16 MiB limit.

`contacts` uses a cutoff in Å (default 4), heavy-atom pairs, and returns full
count plus a bounded sample. `buried_area` uses probeRadius 1.4 Å and 240
Shrake–Rupley samples by default. Distinguish one-sided interface area from
total SASA loss, which is twice that value; neither is binding energy.
`align` uses polymer C-alpha TM-align and returns RMSD, aligned count, both
directional TM-scores, and a column-major 4×4 transform mapping target onto
selection. For a scene transform extract rotation indexes 0,1,2,4,5,6,8,9,10
and translation indexes 12,13,14; assign it to the moving documentId.

Single-model PDB/mmCIF and bounded atom selections are supported. Unsupported
elements, ambiguous chains/models, excessive work and incomplete jobs must be
reported explicitly. Never substitute expected benchmark values for results.
Closing a panel does not cancel a background job. Saved results survive MCP
restart; OS sleep delays work and powering off interrupts active computation.
