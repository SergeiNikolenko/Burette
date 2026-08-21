# DMG Artwork

`background.tiff` is the Finder background used by `scripts/create-dmg.sh`.
Regenerate it after editing the artwork:

```
node scripts/build-dmg-background.mjs
```

The build script renders `background.svg` at 1x and 2x and packs both into a
single HiDPI TIFF with `tiffutil -cathidpicheck`, so Finder draws the background
at 660x400 points and stays crisp on Retina displays. The intermediate PNGs are
temporary and are not checked in.

## Geometry

The canvas is 660x400 while the Finder content area is 660x368 for the
`{100, 100, 760, 500}` window in `scripts/create-dmg.sh`. Finder tiles a
background smaller than the view and crops one that is larger, and the content
height depends on the title-bar height of the running macOS version, so the
artwork deliberately overdraws below the fold. Bottom-anchored elements are
placed against `H_VISIBLE`, and the icon coordinates in the script (145, 205)
and (515, 205) must stay in sync with the layout constants in the build script.

## Molecules

The molecular drawings are transparent SVG assets generated with the vendored
RDKit WebAssembly runtime from these SMILES:

- caffeine: `Cn1c(=O)c2c(ncn2C)n(C)c1=O`
- aspirin: `CC(=O)Oc1ccccc1C(=O)O`
- dopamine: `NCCc1ccc(O)c(O)c1`
- ibuprofen: `CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O`

They are inlined by the build script and flattened to a single ink so they read
as faint sky watermarks rather than chemistry diagrams.
