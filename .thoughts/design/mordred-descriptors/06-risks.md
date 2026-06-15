# Risks

## Runtime And Distribution

- RDKit and Mordred add Python native dependency complexity.
- macOS app signing must include Python binaries, `.so`, and `.dylib` files.
- Release bundles must not accidentally rely on a developer machine's PATH.
- uv layout changes could break copying if the bundle scripts assume too much
  about the virtual environment structure.
- pixi would add a second environment model and should be avoided until needed.

## Performance

- All 2D descriptors across large SDF collections can produce millions of
  values.
- Sorting/filtering arbitrary descriptor columns can be slow without indexes.
- The existing iframe host request timeout is too short for descriptor jobs.
- Descriptor calculations must be background jobs with progress and
  cancellation.

## Data Correctness

- Mordred descriptors can produce missing values or per-descriptor errors.
- Numeric values must remain typed as numbers for filtering and sorting.
- Source invalidation is easy to get wrong after Ketcher edits, row edits, and
  collection appends.
- Ketcher sketches are transient React state; Rust cannot calculate them unless
  the Ketcher page exports and passes a molfile or SMILES payload.
- SMILES files are currently grid-routed; treating them as standalone document
  previews would be a routing change and is not part of the first version.
- Collection row identity currently relies heavily on row index in the UI; long
  lived descriptor caches require stable row ids or source record fingerprints.
- 3D descriptor semantics are unsafe unless coordinates and conformers are
  deliberately controlled.

## UX

- Showing 1,613 descriptors by default would overwhelm the right dock.
- Descriptor filters in the dock must visibly affect the main grid, otherwise
  users will not understand the relationship.
- Cards cannot carry descriptor-heavy comparison alone; table support is
  required.
- Single-molecule descriptor panels and collection descriptor tables have
  different interaction models and should not be forced into one layout.

## Security

- Molecule content and file paths must not be shell-interpolated.
- Runtime install must be explicit and auditable.
- SQL sort/filter fields require strict whitelisting.
- External Python output must be parsed as structured data with bounded size.

## Scope Control

The risky expansion is to treat descriptors as a general chemistry analytics
platform in the first PR. The first implementation should stay limited to:

- desktop app only,
- small molecules only,
- 2D descriptors only,
- explicit supported formats,
- one descriptor tab,
- one collection table mode,
- one runtime path.
