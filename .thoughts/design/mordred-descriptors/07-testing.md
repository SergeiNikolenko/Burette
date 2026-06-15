# Testing

## Unit Tests

Rust:

- source eligibility for supported and unsupported formats,
- source hash invalidation,
- descriptor result parsing,
- descriptor cache lookup,
- descriptor filter SQL generation,
- descriptor sort SQL generation,
- SQL whitelist rejection for unknown fields.

Frontend:

- right-dock descriptor tab visibility,
- disabled state for unsupported documents,
- single-molecule descriptor summary rendering,
- collection filter state rendering,
- cards/table view switch,
- descriptor filter payload serialization.

## Integration Tests

- `.mol` single-molecule calculation returns a summary.
- single-record `.sdf` calculation returns a summary.
- multi-record `.sdf` descriptor run populates collection values.
- `.smi`/`.smiles` calculation works through the grid route, including a
  one-row file.
- Ketcher sketch descriptor run invalidates after sketch edit.
- Ketcher sketch descriptor run sends an explicit molfile or SMILES payload.
- descriptor range filter changes `grid_fetch_page` results.
- descriptor sort is stable across pagination.
- export includes selected descriptor columns.

## Packaging Checks

Development:

- runtime status detects missing descriptor runtime,
- user-initiated install succeeds or reports actionable failure,
- descriptor runner can import RDKit and Mordred.

Release:

- bundled descriptor runtime exists under app resources,
- native libraries are signed,
- runner imports RDKit and Mordred from bundled runtime,
- release app does not require global Python,
- packaged app smoke calculates descriptors for a small `.mol` file.

## Manual QA

- Open a supported `.mol` and use the `Descriptors` tab.
- Open a single-record `.sdf` and confirm single-molecule behavior.
- Open a multi-record SDF collection and compute `basic-2d`.
- Switch between cards and table.
- Filter by a numeric descriptor range.
- Sort by a descriptor column.
- Select a grid row and inspect its descriptors in the right dock.
- Open Ketcher, draw or import a molecule, and calculate descriptors.
- Open PDB/mmCIF and confirm descriptors are disabled with a clear reason.
