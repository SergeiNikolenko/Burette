# Protonation and hydrogen references

Independent reference results for `tests/test-protonation.test.ts` and
`tests/test-hydrogen-references.test.ts`. Burette's implementation is described
in [docs/hydrogen-protonation.md](../../../docs/hydrogen-protonation.md).

| File | Content |
| --- | --- |
| `generate.py` | The panels (SMILES) and the script that produced both JSON files. |
| `protonation-references.json` | 44 molecules at pH 2, 7.4 and 12: Open Babel and Dimorphite-DL net charge, per-heavy-atom H count and formal charge. |
| `hydrogen-references.json` | 20 molecules: RDKit `AddHs` per-heavy-atom H count, formula, net charge and atom counts before/after `RemoveHs`. |
| `disagreements.json` | Every reviewed difference between Burette and a reference, with its reason. |

## Tools and command

| Tool | Version | License | Use |
| --- | --- | --- | --- |
| Open Babel (`openbabel-wheel`) | 3.1.1.23 | GPL-2.0 | `OBMol.AddHydrogens(false, true, pH)`, the call behind `obabel -p <pH>` |
| Dimorphite-DL | 2.1.0 | Apache-2.0 | `protonate_smiles(smiles, ph_min=pH, ph_max=pH, precision=0, max_variants=1)` |
| RDKit | 2026.09.1 | BSD-3-Clause | graph, symmetry classes, Dimorphite-DL result mapping, `AddHs`/`RemoveHs` |

```bash
uv run --no-project --with openbabel-wheel==3.1.1.23 --with dimorphite_dl==2.1.0 \
  --with rdkit==2026.9.1 python tests/fixtures/protonation/generate.py
```

The tools run only to produce these results. No Open Babel or Dimorphite-DL
code or data (`phmodel.txt`, `site_substructures.smarts`) is part of Burette;
the JSON files hold measured outputs of the tools on the public SMILES above.

## How results are compared

Heavy atoms keep SMILES order in Open Babel, RDKit and OpenChemLib; the tests
assert the element list and bond list before comparing. Dimorphite-DL returns
canonical SMILES, which are mapped back by an element/connectivity substructure
match. `symmetry` is the RDKit canonical rank of the element graph without bond
orders or charges: equivalent atoms in one class (the two carboxylate O, the four
phosphate O, the guanidinium N) may exchange H or charge between equally valid
drawings, so each state is compared as net charge plus the sorted multiset of
`class:H:charge` per heavy atom.

`test-protonation` computes that state for every molecule and pH and collects
every mismatch with each tool. The list must equal the keys of
`disagreements.json` exactly: a new difference fails, and so does a documented
one that no longer occurs.

## Intentional disagreements

Burette agrees with Dimorphite-DL in 126 of 132 molecule/pH cases and with
Open Babel in 105. Most Open Babel differences are groups its `phmodel.txt`
does not cover. Each row is one entry of `disagreements.json`.

| Case | Tool | Reason |
| --- | --- | --- |
| acetate, betaine @ 2 | Open Babel | Open Babel never protonates an input carboxylate; carboxylic acid pKa 4.76. |
| aniline, sulfanilamide @ 2 | Open Babel | No aniline rule in Open Babel; aniline pKa 4.60. |
| pyridine @ 2 | Open Babel | No pyridine rule in Open Babel; pyridine pKa 5.23. |
| ciprofloxacin @ 2 | Open Babel | Burette and Dimorphite-DL also protonate the N-aryl piperazine N (independent sites; Open Babel's monocation is closer to reality). |
| metformin @ 2, 7.4, 12 | Open Babel | Open Babel protonates both biguanide imines; Burette gives the monocation (as Dimorphite-DL). |
| phenol, paracetamol @ 12 | Open Babel | Open Babel does not deprotonate these phenols; pKa 9.99 / 9.5. |
| ethanethiol @ 12; thiophenol @ 7.4, 12 | Open Babel | No thiol rule in Open Babel; pKa 10.61 / 6.62. |
| phosphoric acid @ 7.4, 12 | Open Babel | Open Babel leaves H3PO4 neutral; pKa 2.16/7.21/12.32 gives HPO4(2-). |
| methyl phosphate, dimethyl phosphate @ 2 | both | Measured pKa1 1.54 and 1.29 are below 2; both tools keep the neutral acid. |
| methylphosphonic acid @ 2, 7.4 | Dimorphite-DL | Burette uses measured pKa 2.38/7.74; Dimorphite-DL's estimates are lower. |
| methylphosphonic acid @ 7.4, 12; dimethylphosphinic acid @ 7.4, 12 | Open Babel | No phosphonic/phosphinic rule in Open Babel. |
| methanesulfonic acid @ 2, 7.4, 12 | Open Babel | Open Babel leaves sulfonic acids neutral; pKa -1.9. |
| 5-methyltetrazole @ 7.4, 12 | Open Babel | Open Babel charges another ring N but keeps the N-H proton. |
| paracetamol @ 7.4 | Dimorphite-DL | Dimorphite-DL deprotonates; measured pKa 9.5. |
| sulfanilamide @ 12 | Dimorphite-DL | Burette has no sulfonamide rule. |

## Hydrogen panel

`test-hydrogen-references` removes H from a generated 3D conformer, adds them
back with Burette's Add Hydrogens and compares per-atom H counts, Hill formula,
net charge and atom counts with RDKit `AddHs`/`RemoveHs`. It checks new X–H
lengths against neutron-diffraction means (Allen et al., J. Chem. Soc. Perkin
Trans. 2 1987, S1), H angles at unstrained tetrahedral and sp2 centres, mirror
symmetry of XH2 pairs, the cyclopropane H–C–H angle (114.5° electron
diffraction to about 116° microwave) and, through RDKit perception from the 3D
coordinates, the specified stereo. The panel has no deuterium: Burette removes
every hydrogen isotope (as Avogadro does), RDKit `RemoveHs` keeps isotopic H.
