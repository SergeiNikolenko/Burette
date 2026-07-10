---
name: preview-molecular-structures
description: Preview supported molecular attachments or an explicit public PDB ID in Burrete's interactive 3D viewer. Use when the user asks to inspect a molecular structure visually.
---

# Preview molecular structures

Use Burrete for read-only molecular structure inspection.

## Choose the tool

- Use `preview_molecular_file` when the user provides one supported molecular
  structure attachment.
- Use `preview_pdb_structure` only when the user explicitly names a
  four-character PDB ID or clearly asks to open that public PDB entry.
- If several supported attachments are present and the target is unclear, ask
  which single structure to open.

## Present the result

1. Call the selected tool once with the user's attachment or PDB ID.
2. Report the bounded composition summary returned by the tool. Do not infer
   counts that are absent from the result.
3. Let the interactive Burrete Mol* viewer carry the detailed 3D inspection.
   The user can rotate, zoom, select residues, inspect the sequence, change
   representations, use measurements, and open the full viewer.
4. State format limitations or parser notes when the result includes them.

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
