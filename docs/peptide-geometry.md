# Peptide geometry

`peptide-geometry.ts` builds a new, named peptide from pinned amino-acid
internal-coordinate templates. `peptide-mmcif.ts` writes its physical geometry,
chain and residue identity, atom names, formal charges and bond orders. Neither
module embeds or relaxes a SMILES graph, changes an existing source pose, starts
an editing session or opens a document.

## Avogadro parity

The reference is OpenChemistry/avogadrolibs `avogadro/qtplugins/insertpeptide`
(`insertpeptide.cpp` and `insertpeptidedialog.ui`; master on 2026-11-01 differs from
the pinned revision below only in `const` references). Avogadro offers:

- a sequence in one- or three-letter codes, with a residue button palette;
- a global L/D choice;
- the presets straight chain (180, 180), α helix (−60, −40), β sheet (−135, 135),
  3-10 helix (−74, −4), π helix (−57, −70), or custom phi/psi;
- NH2/NH3+ and CO2H/CO2− termini;
- a chain identifier.

Omega is fixed at trans, and there is no per-residue chirality.

Burette's dialog offers the same inputs. One-letter and three-letter modes are
explicit, and three-letter codes may be separated by spaces or hyphens; there is no
residue palette. The geometry API, and therefore the worker request, also accepts a
complete per-residue L/D array. Avogadro applies the preset angles to D residues
unchanged, which turns a D chain into a strained right-handed helix. Burette's
dialog instead applies the mirror image (−φ, −ψ; 180 stays 180) while D is
selected, and switching L/D mirrors the current angles. The geometry API applies
the angles it is given.

## Geometry and chemistry

- **Sequence.** The 20 standard amino-acid codes are accepted, with ASCII case and
  whitespace normalization. D mirrors every template dihedral, including the Ile and
  Thr side-chain stereocenters.
- **Backbone.** Phi and psi are degrees in [−180, 180]. Phi is defined from the
  second residue onward and psi through the penultimate residue; omega is 180°.
  Peptide C–N is 1.329 Å, and CA–C–N and C–N–CA are 116.2° and 121.7° (Engh &
  Huber 1991). Other lengths and angles are the CCD ideal values carried by the
  templates. `atomsFromZmatrixRows` performs the numerical conversion.
- **Proline.** The fragment Pro is the free amino acid: CA–N–CD is 104°, and its N
  cannot be planar in a peptide at any useful phi. Upstream therefore produced an N
  angle sum of 252° in the extended preset. Burette keeps the template lengths and
  angles, but uses a Cγ-endo or Cγ-exo ring: chi1/chi2 of ±23.94°/∓29.50°, solved
  to close N–CD at its CCD 1.4866 Å with CA–N–CD 112°. The ring fixes Pro phi at
  −70.67° (endo) or −51.65° (exo), mirrored for D-Pro. The builder takes the pucker
  nearest the requested phi, which keeps every Pro N planar. A 0.48 Å crambin
  structure (PDB 3NIR) shows phi −77° with an endo ring and −49° with an exo ring.
  Internal Pro has no N–H.
- **Hydrogens.** The amide H bisects the exterior C–N–CA angle in the peptide plane.
  Upstream added a 5·sin(ψ) out-of-plane offset, which Burette drops. The N terminus
  is tetrahedral (1.009 Å). A neutral amine leaves its lone pair on the most crowded
  tetrahedral site. Upstream's fixed terminal torsions could put two protons
  0.05 Å apart.
- **Side chains.** A template rotamer is kept unless it overlaps the chain by more
  than 0.4 Å. Overlap uses Bondi radii, counts only pairs more than three bonds
  apart, and exempts N/O polar pairs. On overlap, the staggered chi1 alternatives
  (±120°) and chi2 alternatives (±120°, or 180° for a planar γ group) are tried, and
  the one with the least overlap is kept. Backbone overlaps are weighted ×10, and
  there are two greedy N→C passes. Side-chain torsions never move other atoms.
- **Termini and protonation.** N termini are amine or ammonium, and C termini are
  acid or carboxylate. Arg, Lys and His are the positively charged CCD forms, as in
  the templates. This is fixed template protonation, not a pH calculation.
- **Identity.** Atom names are CCD names. Rows follow CCD order within each residue:
  heavy atoms, then H/H2/H3, then the other hydrogens. D residues use the CCD D
  identifiers (DAL, DAR, DSG, DAS, DCY, DGN, DGL, DHI, DIL, DLE, DLY, MED, DPN, DPR,
  DSN, DTH, DTR, DTY, DVA) and keep their L partner's names and order. Gly is GLY.
  The chain is one ASCII letter or digit, and residues are numbered from 1.
- **Limits.** The structure is unrelaxed. A π helix and a Pro inside a helix
  overlap by construction: O(i)–CB(i+4) in the π helix, and the Pro CD against the
  preceding turn. The builder does not claim a minimum-energy conformation. It
  accepts at most 64 residues and 256 explicit atoms.

mmCIF writes `chem_comp` types from the CCD: `L-peptide linking`,
`D-peptide linking`, or `peptide linking` for GLY. The entity is `polypeptide(L)`,
`polypeptide(D)`, or `other` when L and D residues are mixed. `nstd_monomer` is `yes`
only when D residues are present. The file also writes explicit `chem_comp_bond`,
complete `struct_conn` records, per-atom formal charges, and the native
`molstar_bond_site` table keyed by atom-site IDs. That exact bond table keeps close
nonbonded contacts from becoming distance-perceived bonds. Ten decimal places
preserve the geometry.

## Sources and regeneration

`config/peptide-residue-sources.json` pins every source byte count and SHA-256:

- OpenChemistry/fragments `7d842f435aec4729a308b23ad7f9501bdd44aa02`,
  `amino/*.zmat`, BSD-3-Clause, Copyright 2022 Open Chemistry.
- OpenChemistry/avogadrolibs `d250eb3c62a61470b1e0cdf205dcfe26b06f991f`,
  `avogadro/core/residuedata.h`, BSD-3-Clause. The geometry assembly follows
  `avogadro/qtplugins/insertpeptide/insertpeptide.cpp` at that same revision.

`vp exec bun scripts/generate-peptide-residues.mjs` downloads only those pinned
sources, verifies their hashes, mechanically extracts the JSON templates, and
copies the fragment license. `--check` compares without writing. For offline
reproduction, `--source-dir <directory>` reads the identical hashed files under
`fragments/` and `avogadrolibs/`. The Pro ring torsions and D identifiers are
reviewed constants in `peptide-geometry.ts`, not template data.

## Validation

`tests/test-peptide-reference.test.ts` is the independent acceptance. Its fixture,
`tests/fixtures/peptide/README.md`, records measurements of the exact builder bytes
and of Mol*'s full re-export. The tools are gemmi, Biopython, RDKit, MDAnalysis
HELANAL and DSSP 4.6.1, and the references are the wwPDB CCD, Engh & Huber (1991)
and the IUPAC-IUB (1970) helix table. With 33 cases at the current revision:

- **Torsions.** Every requested phi/psi and the trans omega are within 0.002°. Pro
  phi is −70.67° or −51.65°, and every peptide N, Pro included, sums to 360°.
- **Helices.** HELANAL gives residues/turn and rise of 3.48/1.58 Å for α, 2.99/2.01
  for 3-10, 4.20/0.96 for π, 2.98/3.10 for −80°/150° and 2.03/3.43 for β. DSSP
  assigns H, G, I and P (L only) to the interiors.
- **Chemistry.** RDKit CIP labels from 3D equal the CCD stereo of every L and D
  component, including Ile and Thr CB and mixed chains. Formulas and net charges
  equal the CCD sums.
- **Geometry.** Bond lengths are within 0.001 Å of the CCD ideal values; angles not
  centred on backbone N are within 0.06°.
- **Contacts.** Coordinate-perceived connectivity equals the declared bonds in every
  case. Ala chains have no heavy-atom clash outside the π helix.
- **Re-export.** Mol* re-export reopens with identical atoms, charges and bonds
  (within 0.0005 Å).

`test:peptide-geometry`, `test:peptide-worker`, `test:peptide-preview` and
`test:peptide-builder` cover the API bounds, actual Mol* reopening, the real
worker, the preview receiver and the dialog's Preview/Create, stale/cancel and
re-export flow. The worker result also returns `graph`: the mmCIF atoms in row
order, with formal charges and Kekulé bonds, for insertion into an editable graph.

## Save and export routes

A built peptide opens as a new `.cif` document.

- **Available.** In the browser shell it saves as mmCIF (tab menu Export ›
  Structure › mmCIF…, and the viewer's Save as mmCIF, both through Mol* `to_mmCIF`)
  and as a MOLX scene (Save scene…).
- **PDB.** The tab menu shows Export › Structure › PDB… for every protein extension,
  `.cif` included. Its producer only filters an original PDB source, so it raises
  "PDB fallback export is unavailable for this structure." for this document.
- **Missing.** No route writes SDF or MOL from an mmCIF document. The
  installed Mol* exports mmCIF/BinaryCIF only.

Insertion into existing structures with Undo, and native macOS/Quick Look/iPhone
surfaces, remain separate acceptance.
