# Superposition demo

Four real protein fragments exercise structure superposition with visible alpha
helices, beta strands, loops, and side-chain geometry:

- `1htb-a.pdb` and `1htb-a-rotated.pdb` are exact rigid placements of chain A.
- `1htb-b.pdb` and `1htb-b-rotated.pdb` are exact rigid placements of chain B.

Every file contains residues 194–280 of human beta3 alcohol dehydrogenase from
PDB entry 1HTB (X-ray diffraction, 2.40 Å resolution). Chains A and B are two
experimentally observed copies from the crystallographic homodimer, so they
share sequence and residue numbering but retain a measurable conformational
difference. Each fragment contains all 635 deposited heavy-atom records for its
87 residues, not a synthetic C-alpha trace.

The four rigid placements keep the unaligned structures visually separate.
Auto, residue-number, sequence, chain, and TM-align flows can then superpose the
real fragments without relying on artificial residue correspondence.
