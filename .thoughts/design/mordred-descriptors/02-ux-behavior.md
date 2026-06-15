# UX Behavior

## Right Dock Tab

Add a new right-dock tab:

- tab kind: `descriptors`
- label: `Descriptors`
- default placement: right dock

The tab should be visible next to the inspector, not hidden behind the Ketcher
tool. It is a data panel, not a Ketcher subpage.

## Supported Single Molecule

For `.mol`, single-record `.sdf`/`.sd`, and a selected or only row from a
SMILES grid, show:

- source label and format,
- runtime status,
- descriptor preset selector,
- calculate/recalculate button,
- cancellation for active runs,
- key descriptor summary,
- searchable descriptor list,
- missing/error count,
- copy/export actions.

The default preset should be a small 2D summary group, not all 1,613 2D
descriptors on first view.

## Collection

For collection sources, the right dock should show:

- collection size,
- descriptor coverage,
- active descriptor run status,
- preset selector,
- selected descriptor columns,
- numeric range filters,
- missing-value filters,
- selected-row descriptor detail when a row is selected.

Collection data should be visible in the main surface:

- `Cards` remains useful for visual browsing.
- `Table` is required for descriptor-heavy comparison, sorting, and scanning.

Descriptor filters are configured in the right dock and applied to both `Cards`
and `Table`.

SMILES files should stay in the existing grid route in the first version. A
single-line SMILES file can still feel like a single molecule in the
`Descriptors` tab by auto-selecting or summarizing the only grid row, without
adding a competing SMILES document preview path.

## Ketcher Sketch

For the current Ketcher sketch:

- calculate descriptors from the current exported molfile or SMILES,
- mark the source as transient,
- invalidate results when the sketch changes,
- show the same single-molecule descriptor summary shape.

The first version should not automatically write descriptors back to files.

## Unsupported Context

Unsupported contexts should render a compact disabled state:

- proteins and biopolymers,
- PDB/mmCIF structures,
- trajectories,
- volumetric data,
- empty Ketcher sketch,
- multi-record documents without stable record selection outside the grid.

The copy should say that descriptors are currently available for small-molecule
MOL, SDF, and SMILES sources.

## Table Requirements

The collection table should support:

- stable row identity,
- molecule name and structure preview,
- SMILES,
- selected descriptor columns,
- numeric sorting,
- text sorting for categorical properties,
- range filters,
- missing/error value indicators,
- column visibility controls,
- CSV export of visible rows and selected descriptor columns.

The table does not need spreadsheet editing in the first version.
