# Peptide reference fixtures

## `references.json`

Absolute configurations and formulas of L-Ala, L-Cys, L-Thr and L-Ile from PubChem
(public domain), used by `tests/test-peptide.test.ts`. Source URL is inside the file.

## Independent builder acceptance

`reference-results.json` holds measurements of the exact mmCIF bytes the peptide
builder writes, and of Mol*'s full-structure re-export of two of them, made only
with external tools. `tests/test-peptide-reference.test.ts` first checks that every
SHA-256 matches the current output, then checks the measurements against the
references below. Burette code never supplies an expected value.

- `reference-cases.json`: the requests. Six backbones (Avogadro's five presets and
  a polyproline-like custom −80°/150°) × Ala16 (L and D), ACDEFGHIKL and MNPQRSTVWY,
  plus D side chains in an α helix, mixed L/D chirality with chain Z, and all four
  terminal states. D chains use the mirrored preset angles, as the dialog sends them.
- `write-reference-cases.ts`: writes those cases and the Mol* re-exports.
- `measure-reference.py`: measures them.

| Check | Tool | Reference |
| --- | --- | --- |
| phi, psi | Biopython 1.88 `Polypeptide.get_phi_psi_list` | Request; Pro −65 ± 15° (MacArthur & Thornton 1991, JMB 218, 397) |
| omega | gemmi 0.7.5 `calculate_omega` | trans, 180° |
| Residues per turn, rise | MDAnalysis 2.11.0 HELANAL on CA | IUPAC-IUB 1970, Biochemistry 9, 3471, Table 1 |
| Secondary structure | DSSP 4.6.1 (`mkdssp`) | H, G, I, P per preset |
| CIP labels from 3D | RDKit 2026.09.1 `rdCIPLabeler` | CCD `pdbx_stereo_config` of each component |
| Formula, net charge | RDKit | CCD formulas − (n−1) H2O, ± terminal H; CCD charges |
| Atom names, row order | gemmi | CCD `_chem_comp_atom` |
| Bond lengths, angles | gemmi | CCD ideal coordinates (D components use their L partner) |
| Peptide link | gemmi | Engh & Huber 1991, Acta Cryst. A47, 392 |
| Connectivity | RDKit `DetermineConnectivity` from coordinates only | The file's `struct_conn` bonds |
| Clashes | numpy | Bondi radii, pairs more than 3 bonds apart, N/O polar pairs exempt, 0.4 Å overlap (MolProbity) |
| Re-export identity | gemmi | The original file's atoms, charges, coordinates and bonds |

wwPDB CCD files (CC0 1.0, `files.wwpdb.org/pub/pdb/refdata/chem_comp`) were downloaded
on 2026-11-01; their SHA-256 values are recorded in the results. They are not committed.

### Known reference differences

- The CCD describes free amino acids, so angles centred on backbone N are excluded
  from the CCD comparison. Those angles are checked as a planar peptide N instead,
  and as a tetrahedral terminal N.
- CCD `DLY` is neutral lysine, while `LYS` is the ammonium. D residues are compared
  with their L partner's formula, charge, names and ideal geometry, because the
  builder keeps the same protonation for both enantiomers.
- With Avogadro's angles, HELANAL measures α 3.48 residues/turn and 1.58 Å rise,
  and π 4.20 residues/turn and 0.96 Å rise. The IUPAC values for these helices
  are 3.6/1.5 and 4.4/1.15. On Pauling–Corey geometry the IUPAC angles themselves
  give 3.58/1.52 for α (−57°, −47°) and 4.22/0.98 for π (−57°, −70°). So the α gap
  comes from Avogadro's (−60°, −40°), and the tabulated π rise is not reproduced by
  its own angles; neither gap comes from placement. The test tolerances cover both.
- π-helix backbones and Pro inside a helix overlap by construction: O(i)–CB(i+4) in
  the π helix, and the Pro CD against the preceding turn. These cases are recorded
  but not asserted to be clash-free.

## Regenerate

```sh
bun tests/fixtures/peptide/write-reference-cases.ts /tmp/peptide-ref/cases
micromamba create -y -p /tmp/peptide-ref/dssp -c conda-forge dssp=4.6.1
uv run --python 3.12 --with gemmi==0.7.5 --with biopython==1.88 --with rdkit==2026.09.1 \
  --with MDAnalysis==2.11.0 --with numpy==2.5.4 python tests/fixtures/peptide/measure-reference.py \
  /tmp/peptide-ref/cases /tmp/peptide-ref/ccd /tmp/peptide-ref/dssp/bin/mkdssp \
  > tests/fixtures/peptide/reference-results.json
```

Then review the diff of `reference-results.json` before committing it.
