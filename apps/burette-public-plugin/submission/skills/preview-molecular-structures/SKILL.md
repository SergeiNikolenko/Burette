---
name: preview-molecular-structures
description: Preview supported molecular attachments, interactive 2D molecule grids, or an explicit public PDB ID in Burette's interactive viewer, or use Burette's bounded hosted molecular editor for transient chemical sketches.
---

# Preview molecular structures

Use Burette for bounded molecular inspection, interactive molecule grids, and transient chemical sketching.

## Choose the tool

- Use `preview_molecular_file` when the user provides one supported molecular
  structure attachment.
- Use `preview_molecule_grid` when the user wants to inspect multiple small
  molecules, a compound series, SAR table, docking hit list, or ligand TSV/CSV/SMILES/SDF/DWAR
  table as an interactive 2D molecule grid and filterable property table. Pass
  bounded inline `molecules` (`smiles`, optional `name`, optional scalar `properties`),
  inline `content` with `format` (`csv`, `tsv`, `smiles`, `sdf`, or `dwar`), or one
  authorized `gridFile` attachment.
- Use `preview_pdb_structure` only when the user explicitly names a
  four-character PDB ID or clearly asks to open that public PDB entry.
- Use `render_molecular_scene` when the user asks to select or focus a typed
  chain, residue range, or component; clear a selection; reset the camera; or
  hide/show polymers, ligands, ions, or water. Pass the same PDB ID or authorized
  attachment again because the public server does not retain widget sessions.
  When the source and selector are supplied, call this tool directly once:
  it loads the structure and applies the actions, so a preliminary preview is
  unnecessary. Do not split opening, selecting, focusing, and hiding waters
  across multiple cards.
- Use `open_molecular_editor` when the user asks to draw or edit a small chemical
  structure in the hosted widget. Seed only bounded inline KET, MOL, RXN, or
  SMILES content when it is supplied.
- Use `control_molecular_editor` for a follow-up editor action. First use the current
  `surfaceId` and `structureRevision` from the editor snapshot; send a
  revision-checked `set_structure`, `clear_structure`, `highlight_atoms`, or
  `get_structure` action. `request_persist` only reaches a user-confirmation
  boundary and never writes silently.
- If several supported attachments are present and the target is unclear, ask
  which single structure to open.
- If no structure is identified in this conversation, ask for an attachment or
  PDB ID before any molecular call. Do not borrow an identifier from another
  chat, a cached widget, a suggested demo, or earlier unrelated activity.

## Present the result

1. Call the selected tool once with the user's attachment or PDB ID.
2. Report the bounded composition summary returned by the tool. Do not infer
   counts that are absent from the result.
3. Let the interactive Burette preview carry the detailed 3D inspection.
   The user can rotate, zoom, select residues, inspect the sequence, change
   representations, and use measurements directly in the result.
4. State format limitations or parser notes when the result includes them.
5. Treat `burette.activeSelection` from widget context as the user's current
   selection only when its source matches the structure explicitly opened in
   this conversation. Tool-returned data and a prepared scene are not a loaded
   view. Do not say “done”, “selected”, “focused”, or “hidden” until the widget
   reports those applied actions. If there is no acknowledgement, explicitly
   state that rendering/application is unconfirmed, not completed.

## Boundaries

- For unsupported docking, affinity, simulation, or local overwrite requests,
  explain the limitation without opening a preview as a substitute. Offer
  inspection separately; a PDB ID in a docking request is not an inspection request.
- Do not claim that this public plugin edits, overwrites, or deletes molecular
  source files. Molecular editor edits exist only in the ephemeral hosted widget relay.
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
