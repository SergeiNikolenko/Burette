# Interaction diagram fixtures

Inputs of `tests/test-interaction-diagram-engine.py`.

| File | Content | Source |
| --- | --- | --- |
| `2hyy-imatinib-pocket.pdb` | PDB 2HYY chain A: imatinib (STI 600) and every residue and water with an atom within 8 Å of it, hydrogens and alternate locations removed, written with gemmi 0.7.5 | RCSB PDB entry 2HYY |
| `STI.cif` | Chemical Component Dictionary entry of imatinib, as the engine caches it | `https://files.rcsb.org/ligands/download/STI.cif` |

The trimmed pocket gives the same contacts as the full entry. PDB and CCD data
are released under CC0.
