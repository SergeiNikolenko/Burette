---
name: preview-molecular-structures
description: Preview and inspect supported molecular attachments or an explicit public PDB ID in Burrete's interactive 3D viewer. Use when the user asks to view, select, focus, hide, or show molecular structure components.
---

# Preview molecular structures

Use Burrete for read-only molecular structure inspection.

## Choose the tool

- Use `preview_molecular_file` when the user provides one supported molecular
  structure attachment.
- Use `preview_pdb_structure` only when the user explicitly names a
  four-character PDB ID or clearly asks to open that public PDB entry.
- Use `render_molecular_scene` when the user asks to select or focus a typed
  chain, residue range, or component; clear a selection; reset the camera; or
  hide/show polymers, ligands, ions, or water. Pass the same PDB ID or authorized
  attachment again because the public server does not retain widget sessions.
- If several supported attachments are present and the target is unclear, ask
  which single structure to open.

## Present the result

1. Call the selected tool once with the user's attachment or PDB ID.
2. Report the bounded composition summary returned by the tool. Do not infer
   counts that are absent from the result.
3. Let the interactive Burrete preview carry the detailed 3D inspection.
   The user can rotate, zoom, select residues, inspect the sequence, change
   representations, and use measurements directly in the result.
4. State format limitations or parser notes when the result includes them.
5. Treat `burrete.activeSelection` from widget context as the user's current
   selection. Do not claim an action succeeded until the widget reports its
   bounded scene result.

## Boundaries

- Do not claim that this public plugin edits, overwrites, or deletes molecular
  files.
- Do not claim local macOS app control, docking, simulation, structure
  prediction, or remote job execution. Those are outside this hosted plugin.
- Do not treat a molecular preview as medical diagnosis, clinical advice, or
  proof of biological function.
- Do not request credentials, private URLs, local paths, health records, or
  other sensitive identifiers.
- Files larger than 3 MiB or unsupported formats need a smaller supported
  structure file.
- Arbitrary residue isolation and persistent representation overpaint are not
  available in the hosted action allowlist.
