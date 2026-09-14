# Presentation samples provenance

The browser presentation uses existing records; it does not run docking, scoring,
or affinity prediction.

- `samples/structures/proteins/7rpz.pdb`: PDB entry 7RPZ, KRAS G12D with
  MRTX1133 (ligand component `6IC`). Reused from the supplied FOLD presentation
  asset `site-public/assets/7rpz.pdb` without changing coordinates.
- `samples/structures/small-molecules/imatinib-poses.sdf`: eight recorded MATCHA
  poses for imatinib/ABL1, reused from the supplied FOLD asset
  `site-public/assets/matcha-data/predictions.sdf`. Record titles alone are
  normalized to `MATCHA pose 1` through `MATCHA pose 8`; coordinates, bonds and
  atom order are preserved. These are recorded predictions, not a new calculation.
- `samples/collections/tables/moses-properties.csv`: the first 48 rows of
  `samples/large/moses_10k_descriptors_preview.csv`, in source order, retaining
  SMILES, molecular weight, SLogP and TPSA. Missing properties remain empty and
  are omitted from property plots; they are not zero-valued measurements.
- `samples/structures/crystals/caffeine.cif`: the existing crystal fixture.
- `samples/structures/demo/bimp.v000.xyz`: the existing 20-frame vibrational
  mode. Smooth playback interpolates frames for viewing only.

The landing repository documents its copies in `public/live-data/README.md`.
