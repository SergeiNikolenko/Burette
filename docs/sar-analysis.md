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

Core, R-group, component and scaffold cells display 2D structures in the table,
including imported SAR property columns. Copy Cell Value and filters use their
original SMILES. Identical visible fragments share a cached depiction.
CSV Save and Export use the same marked encoding so provenance columns cannot
be mistaken for additional structures on reopen. The native Save output in
`tests/fixtures/sar/two-series-saved.csv` is a regression fixture for this path.
The browser importer and Swift preview parser also honour that primary SMILES
column (`test-collection-documents.mjs`, `test-sar-preview-import.mjs`).

## Matched pairs

Analyze > Matched Pairs… (command palette: Matched pairs) fragments every
molecule of the collection by single cuts, the way Hussain and Rea describe
and mmpdb implements: each acyclic single bond matching mmpdb's default cut
pattern splits the molecule into a constant and a variable part, molecules
that share a constant part form pairs, and a pair is a transformation from one
variable part to the other. A molecule that equals a constant part capped with
hydrogen pairs through `[*:1][H]`. Only variable parts of up to 10 heavy atoms
are indexed. Molecules with several components, a wildcard atom, fewer than 2
or more than 100 heavy atoms, or more than 10 rotatable bonds are left out, as
mmpdb leaves them out with `--salt-remover '<none>'`; the dialog says how many.

The dialog lists the transformations with their pair count and, for a chosen
numeric column, the mean and sample standard deviation of the change (To minus
From) over the pairs in which both molecules have a value. Selecting a
transformation shows its pairs; Select in grid replaces the grid selection with
their molecules. Nothing is written to the collection.

The work runs in a worker (`lib/matched-pairs`). It reads at most 2,000
molecules and stops at 200,000 fragmentations or 200,000 pairs; the dialog
reports each limit it hit. On the desktop the molecules come from the
collection database, the values from the grid's column channel.

A cut can turn an atom with two equal branches into a stereocentre. mmpdb
writes such a fragment with the centre undefined and in both configurations,
so that it meets the same fragment of a molecule in which the centre is
defined; the module does the same, with mmpdb's restriction to the fragment
that holds the first atom of the canonical SMILES. Symmetry classes come from
a refinement over the molecular graph rather than from RDKit's canonical ranks,
which the WASM build does not expose.

Verification: `tests/test-matched-pairs.test.ts` compares every fragmentation,
pair and statistic of two ChEMBL series with mmpdb 3.1.6
(`tests/fixtures/matched-pairs/README.md` has the commands and the one known
difference: next to a stereo double bond mmpdb can invert the geometry of a
fragment, the module keeps it).

## SAR table

Analyze > SAR Table… (command palette: SAR table) lays the R-group columns of
a collection out as a matrix: one R position down, another across, each cell
holding the molecules with that pair of substituents. A cell shows the value
of a chosen numeric column, or the mean when it holds several molecules, and
is tinted from the lowest cell mean to the highest. Hovering or focusing a
cell shows its molecules; clicking pins it for Select in grid.

The table reads the `RGroup_*` columns, whether Decompose R-Groups wrote them
in this session or they came with the file. It shows one Series at a time,
largest first, and starts with the two positions that vary most. Past 40
different substituents on an axis the rarest are left out and the dialog says
so. In a collection that is paged from the database the grid's column channel
answers for the rows it has loaded.

Verification: `tests/test-sar-analysis-dialogs.test.tsx` drives both dialogs
through the grid channel on the factor Xa fixture.
