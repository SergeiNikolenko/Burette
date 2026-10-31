# Peptide graph prerequisite

`apps/desktop/src/lib/molecular-workbench/peptide.ts` builds a bounded neutral
peptide graph as isomeric SMILES. It has no runtime imports and does not choose
coordinates. Consumers must keep graph construction separate from 3D placement.

## Current contract

- Sequences run from N to C and contain standard amino-acid one-letter codes.
  ASCII lowercase and whitespace are normalized; Unicode letter substitutions
  are rejected. Length is 1–64 residues, with the
  stricter total budget of 256 atoms including implicit hydrogen and caps.
- Chirality is L, D, or a complete per-residue L/D array. D mirrors all residue
  stereocenters, including the side-chain centers in Ile and Thr. Gly is achiral.
- N-terminal groups are neutral amine or acetyl. C-terminal groups are neutral
  carboxylic acid or amide. These choices do not model physiological protonation.
- Side chains use fixed neutral tautomers. A sequence does not create disulfides,
  salt bridges, nonstandard residues, atom/residue identifiers or chain records.
- Invalid, incomplete or oversized requests fail before a graph is returned.
  Missing entries in sparse chirality arrays are invalid rather than default L.

PubChem primary records anchor the exceptional absolute configurations:
[L-Ala, CID 5950](https://pubchem.ncbi.nlm.nih.gov/compound/5950),
[L-Cys, CID 5862](https://pubchem.ncbi.nlm.nih.gov/compound/5862),
[L-Thr, CID 6288](https://pubchem.ncbi.nlm.nih.gov/compound/6288), and
[L-Ile, CID 6306](https://pubchem.ncbi.nlm.nih.gov/compound/6306).
They are respectively 2S, 2R, 2S/3R and 2S/3S. The compact reviewed structures
and formulas are retained in `tests/fixtures/peptide/references.json`.

## Upstream behavior and remaining work

The reference is OpenChemistry/avogadrolibs commit
`d250eb3c62a61470b1e0cdf205dcfe26b06f991f`,
[`insertpeptide.cpp`](https://github.com/OpenChemistry/avogadrolibs/blob/d250eb3c62a61470b1e0cdf205dcfe26b06f991f/avogadro/qtplugins/insertpeptide/insertpeptide.cpp)
and its adjacent `insertpeptidedialog.ui`. That builder places atoms from
internal coordinates, exposes phi/psi and secondary-structure presets, uses
trans omega, and records residue/chain identity. Its terminal choices include
NH2/NH3+ and CO2H/CO2−, which differ from this helper's neutral capped graphs.
This is an interface/behavior reference, not a port of its coordinate algorithm.

A later coherent stage must place a reviewed 3D backbone, honor phi/psi/omega
and handedness without moving a requested source pose, define charged termini
and residue identity, and connect the existing builder/worker/open-document flow.
It needs stale/cancel and actual Browser build/export/reopen acceptance. A generic
SMILES conformer or a D/L control does not prove those requirements or complete
Avogadro stage 7.

## Validation

`vp run test:peptide-graph` uses actual OCL and RDKit to check all 20 neutral L/D
graphs, formulas, valence, connectivity, absolute stereo, N-to-C peptide bonds,
Pro nitrogen and caps, explicit atom budgets and MOL stereo roundtrips. The
original peptide test bodies are retained. `vp run check:peptide-graph` checks
this helper and its focused tests without the general builders/chemistry stack.
No embedding, relaxation, quantum calculation or native UI is exercised.
