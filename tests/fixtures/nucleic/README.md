# Nucleic-acid builder references

Independent references for `tests/test-nucleic-acid-builder.test.ts` and
`tests/test-nucleic-acid-worker.test.ts`. None of these files is read by the app.

## Files

- `ccd/*.cif`: the `_chem_comp` identity lines and the `_chem_comp_atom` and
  `_chem_comp_bond` loops, copied unchanged from the wwPDB Chemical Component
  Dictionary entries DA, DC, DG, DT, A, C, G and U
  (`https://files.rcsb.org/ligands/view/<ID>.cif`, downloaded 2026-10-26; CC0).
  They give the reference atom names, Kekulé bond orders, ideal bond lengths,
  absolute configurations and prochiral hydrogen names.
- `1bna-core.pdb`: chain A 4-9 (GAATTC) and chain B 16-21 of PDB 1BNA (B-DNA dodecamer
  CGCGAATTCGCG, 1.9 A; Drew et al., 1981).
- `1rna-core.pdb`: chain A 5-10 (AUAUAU) and chain B 19-24 of PDB 1RNA (A-RNA duplex
  UUAUAUAUAUAUAA, 2.25 A; Dock-Bregeon et al., 1989).
- `1dcg-core.pdb`: chain A 2-5 (GCGC) and chain B 8-11 of PDB 1DCG (Z-DNA d(CGCGCG)2,
  1.0 A; Gessner et al., 1989). G4pC5 of chain A is a Z-II phosphate; the others are Z-I.
- `2f8w-core.pdb`: chain A 2-5 (ACGT) and chain B 8-11 of PDB 2F8W (Z-DNA d(CACGTG)2,
  1.2 A), the CA/TG validation of the Z form.
- `fnab-b-dna.pdb`, `fnab-a-dna.pdb`, `fnab-a-rna.pdb`: Open-Source PyMOL 3.1
  (`pymol-open-source-whl` 3.1.0.4) `cmd.fnab("GATTACAGC", mode, form, dbl_helix)` for
  B-DNA and A-DNA duplexes and a single A-RNA strand (`GAUUACAGC`; fnab builds no RNA
  duplex). Heavy atoms only; O1P/O2P are renamed OP1/OP2, C5M is renamed C7, and strand B
  is numbered 1..9 from its 5' end.
- `reference-geometry.json`: for each PDB file above, MDAnalysis 2.8.0 `nuclinfo`
  torsions alpha..zeta and chi and the pseudorotation phase (`phase_as`) per nucleotide;
  Watson-Crick donor-acceptor distances and C1'-C1' per base pair; and per repeat the
  twist and rise of the least-squares (Kabsch, numpy 1.26.4) superposition of the sugar
  rings of one repeat onto the next (mononucleotides; dinucleotides for Z).
- `rdkit-references.json`: RDKit 2026.09.1 `Chem.MolFromSequence` molecules (flavors 6/7
  DNA and 2/3 RNA: 5'-OH or 5'-phosphate, 3'-OH) for GATTACA, CACGTG and GAUUACA, one or
  both strands, with every P-OH ionised as at pH 7: Hill formula, net charge, atom count
  with hydrogens and canonical isomeric SMILES.

All crystal structures were downloaded from `https://files.rcsb.org/download/`
(wwPDB data, CC0); ATOM records keep the coordinates and names of altloc A. PyMOL
outputs are derived from Open-Source PyMOL data (notice in
`docs/third-party/pymol-LICENSE`).

The 5'-terminal phosphate (a dianion) uses one free P-O length for OP1, OP2 and OP3:
1.52 A, the mean of the six free P-O bonds (1.5156-1.5236 A; ester P-O5' 1.623-1.625 A)
of disodium cytidine 5'-monophosphate hydrate, COD 2205273 (Acta Cryst. E61, m554-m556,
2005, doi:10.1107/S160053680500471X, R 0.034; COD data are public domain). The
bond-length test checks that range; no file is copied.

## Regenerating

`references.py` writes every file above except `ccd/` (run on host gauss, 2026-11-01):

```sh
uv venv -p 3.12 .venv-pymol
uv pip install --python .venv-pymol/bin/python "pymol-open-source-whl==3.1.0.4" "numpy<2" gemmi rdkit "MDAnalysis<2.9" scipy
.venv-pymol/bin/python references.py out
```

The same environment runs the two template scripts, which print the tables of
`apps/desktop/src/lib/molecular-workbench/nucleic-templates.ts`:

- `extract-pymol-templates.py`: the A and B tables from the PyMOL `fnab` fragments.
- `derive-z-template.py <4OCB.cif>`: the Z table from PDB 4OCB (d(CGCGCGCGCGCG)2,
  0.75 A), with the method in its docstring. Run summary on 2026-11-01: screw fit RMSD
  0.557 A over the rigid atoms of units 2-5 of both strands, twist -58.06 degrees and rise
  7.517 A per dinucleotide; Z-I units 2, 3 and 5 (unit 4 is Z-II), spread 0.292 A;
  regularization moves atoms by 0.075 A RMS and leaves every bond within 0.002 A and every
  angle within 0.31 degrees of the crystal means; ring fits of the PyMOL bases 0.02-0.05 A.

4OCB is the template source and is not used as a test reference; 1DCG and 2F8W are
independent crystals.
