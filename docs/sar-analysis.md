# Scaffold and R-group analysis

Analyse Scaffolds writes the stereo-free Bemis–Murcko framework and its
frequency across the collection. It is a structural grouping, not proof of a
shared binding mode or activity relationship. Acyclic molecules have no Murcko
framework.

Decompose R-Groups runs in the desktop app using the managed Python RDKit
runtime. An empty core processes every Murcko family independently, rather than
selecting only the most frequent one. An explicit SMILES/SMARTS core processes
its matching series. R labels are comparable **within a Series**, not across
unrelated families. Sorting source rows does not drive symmetry assignment:
the engine orders molecules by canonical SMILES before alignment.

Constant substituents are incorporated into the output core. Only variable
positions remain as R columns. Hydrogen at a variable position is represented
explicitly, while a missing cell outside a matching series is not hydrogen.
The largest connected component (heavy atom count, then canonical SMILES)
is decomposed; other components are retained in `Components`. No tautomer,
protonation, or stereochemistry normalization is applied to input molecules.
Murcko family keys omit stereo, but the decomposition retains molecular stereo.

`Series`, `Status`, `Core`, and R columns form the result. Excluded rows have a
specific Status: invalid structure, no ring scaffold, or core not found. Errors
in alignment fail the calculation instead of publishing incomplete assignments.
Up to 5,000 molecules and 8 MiB of input are accepted; each family's alignment
has a 30-second timeout and the subprocess has a 600-second outer timeout.

All R-group columns are replaced together in one SQLite transaction. A failed
write leaves the previous result intact. Applying results checks source IDs and
structures under the transaction and rejects a stale calculation. Other derived
columns are preserved. The storage command accepts at most 64 result columns
and 16 MiB; its window-scoped document ID cannot target another window's grid.

Verification: `tests/test-rgroup-runner.mjs` executes the shipped Python source
against real RDKit, tests multiple families, constants, symmetry ordering and
reconstruction including stereo, hydrogen, bridging substituents and salts.
`commands::rgroup_results::tests` exercises replacement, rollback and changed
source rejection against SQLite. `tests/test-sar-analysis-compute.mjs` covers the
scaffold implementation used by Analyse Scaffolds.

The desktop dialog separates Preview from Apply columns. Preview shows actual
coverage, exclusion reasons, a family selector, the labelled core, and
substituent frequencies for each R position. It does not write to the collection.
Changing the query invalidates the preview; Apply commits exactly the inspected
result. A failed application keeps the dialog open and requests a fresh preview.
Substituent frequencies describe composition, not effects on activity.

SAR text columns support table filtering and sorting. CSV and SDF exports carry
`RGroup_*`, `Scaffold`, and `ScaffoldCount` values as properties. Reopening such
an export restores data columns, not a live calculation. Invalid molecular
records remain available in the table and exclusion report; the card view omits
unparsable structures and the inspector suppresses their molecular preview.
