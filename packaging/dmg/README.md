# DMG Artwork

`background.png` is the Finder background used by `scripts/create-dmg.sh`.
The molecular drawings are transparent SVG assets generated with the vendored
RDKit WebAssembly runtime from these SMILES:

- caffeine: `Cn1c(=O)c2c(ncn2C)n(C)c1=O`
- aspirin: `CC(=O)Oc1ccccc1C(=O)O`
- dopamine: `NCCc1ccc(O)c(O)c1`
- ibuprofen: `CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O`

Finder requires a raster background, so the four SVG drawings are composited
into `background.png` for distribution while remaining available under
`molecules/` as the editable source artwork.
