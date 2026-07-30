# Superposition demo

Four small C-alpha traces exercise structure superposition without a large fixture:

- `reference.pdb` is the original ten-residue trace.
- `rotated.pdb` and `flipped.pdb` contain exact rigid transforms of the reference.
- `flexed.pdb` also changes the trace geometry, so a successful fit retains a non-zero RMSD.

The files intentionally share residue numbers and sequence so Auto, residue-number, sequence, and TM-align flows can all be tested.
