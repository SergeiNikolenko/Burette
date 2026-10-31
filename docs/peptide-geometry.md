# Peptide geometry

`peptide-geometry.ts` constructs a new, named peptide from pinned amino-acid
internal-coordinate templates. `peptide-mmcif.ts` writes its physical geometry,
chain and residue identity, atom names, formal charges and bond orders. Neither
module embeds or relaxes a SMILES graph, changes an existing source pose, starts
an editing session or opens a document.

## Geometry and chemistry

- The 20 standard amino-acid codes are accepted, with ASCII case/whitespace
  normalization. A complete L/D array can select chirality per residue; D mirrors
  the residue template, including the Ile and Thr side-chain stereocenters.
- Phi and psi are degrees in [-180, 180]. The five presets match the pinned
  Avogadro dialog: extended (180, 180), alpha (-60, -40), beta (-135, 135),
  3-10 helix (-74, -4), and pi helix (-57, -70). Peptide omega is trans (180).
  Phi is defined from the second residue onward and psi through the penultimate
  residue; undefined terminal backbone torsions are not fabricated.
- Peptide C–N bonds are 1.329 Å. CA–C–N and C–N–CA angles are 116.2° and
  121.7°. Other lengths, angles and side-chain torsions come from the templates.
  Existing `atomsFromZmatrixRows` performs the numerical coordinate conversion.
- N termini are amine or ammonium; C termini are acid or carboxylate. Proline
  retains its closed N–CD ring and has no N–H in internal residues. Unlike the
  separate neutral `peptide.ts` graph API, the native template dictionary uses
  positively charged Arg, Lys and His side chains. This is fixed template
  protonation, not a pH calculation. Acetyl and amide caps are not this API's
  terminal choices.
- The template-based structure is unrelaxed. Long chains or arbitrary torsions
  may cause nonlocal steric clashes; the builder does not claim a minimum-energy
  conformation. It accepts at most 64 residues and 256 explicit atoms.
- Atom order is deterministic. Chain is one ASCII letter or digit, residues are
  numbered from 1, and atom names are preserved when terminal atoms are removed.
  References use an explicit surviving-template map, including internal Pro.

The literal upstream ammonium placement can overlap N-terminal hydrogens:
L-Ala H/H3 is about 0.048 Å apart, and D-Pro H/H2 about 0.512 Å. Burette instead
completes a tetrahedral proton geometry around the unchanged N–heavy-atom bonds.
For Pro, its fixed ring angle remains unchanged while each N–H/N–C angle has
cosine -1/3. No heavy atom, peptide torsion or side-chain coordinate moves.

mmCIF uses explicit `chem_comp_bond`, complete `struct_conn` records and per-atom
formal charges. It also writes the complete native `molstar_bond_site` table,
keyed by the emitted atom-site IDs. That exact bond table prevents close nonbonded
contacts between residues from becoming distance-perceived covalent bonds. Native
residue names are retained; generic peptide component types avoid imposing an
L assignment on D coordinates. All-L/all-D chains use their matching entity
polymer type; mixed chains use `other`, with each residue's 3D stereochemistry
retained. Actual Mol* reopening verifies every atom, charge and bond, including
inter-residue peptide bonds. Ten decimal places preserve the exported geometry;
Mol*'s stored Float32 positions are compared within 1e-5 Å. Full-structure native
mmCIF re-export/reopen also preserves every graph edge and identity; that existing
exporter rounds coordinates to three decimal places (tested within 0.00051 Å).
Filtered/modified structure export must be checked when this builder is wired
into the document workflow; this producer stage does not change those paths.

## Sources and regeneration

`config/peptide-residue-sources.json` pins every source byte count and SHA-256:

- OpenChemistry/fragments `7d842f435aec4729a308b23ad7f9501bdd44aa02`,
  `amino/*.zmat`, BSD-3-Clause, Copyright 2022 Open Chemistry.
- OpenChemistry/avogadrolibs `d250eb3c62a61470b1e0cdf205dcfe26b06f991f`,
  `avogadro/core/residuedata.h`, BSD-3-Clause. The geometry assembly follows
  `avogadro/qtplugins/insertpeptide/insertpeptide.cpp` at that same revision.

`vp exec bun scripts/generate-peptide-residues.mjs` downloads only those pinned
sources, verifies their hashes, and mechanically extracts the JSON templates and
copies the fragment license. `--check` compares without writing. For offline
reproduction, `--source-dir <directory>` reads the identical hashed files under
`fragments/` and `avogadrolibs/`. The existing Avogadro license and the fragment
license are retained under `docs/third-party/` and the desktop public licenses.

## Validation and remaining integration

`test:peptide-geometry` measures the actual Cartesian backbone torsions and
geometry, verifies all 20 L/D residue configurations with OCL and independent
RDKit MOL parsing, checks Pro/charged termini, and opens mmCIF in actual Mol* to
compare the complete structure. `check:peptide-geometry` checks source and tests.
These are deterministic source/runtime checks, not interactive Browser proof.

Builder UI, worker/cancellation, insertion ownership, saved workspace metadata,
secondary-structure assignment, native macOS/Quick Look/iPhone and actual Browser
build/export/reopen scenarios remain separate integration work. This stage does
not complete Avogadro peptide or broader builder parity.
