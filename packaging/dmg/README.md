# DMG Artwork

`background.tiff` is the Finder background used by `scripts/create-dmg.sh`.
Regenerate it after editing the artwork:

```
node scripts/build-dmg-background.mjs
```

The build script renders the sky, composites `background.svg` over it at 1x and
2x, and packs both rasters into a single HiDPI TIFF with
`tiffutil -cathidpicheck`, so Finder draws the background at 660x400 points and
stays crisp on Retina displays. The intermediate PNGs are temporary; only
`sky.png`, `background.svg` and `background.tiff` are checked in.

`background.tiff` is listed in `.github/blob-size-allowlist.txt`: a photographic
background is roughly 560 KB once TIFF LZW has had its way with it, over the
512 KB gate. Checking the built TIFF in is what keeps the release path free of a
build-time dependency on `rsvg-convert`.

## Sky

`sky.png` is one frozen frame of the cloud shader used by the burette-landing
hero, ported to the CPU in `scripts/render-dmg-sky.mjs` so the artwork rebuilds
without a WebGL context. The shader itself came from MAKI
(`web/patent-workspace/src/components/ui/cloud-shader.tsx`, originally
Aceternity UI).

The palette is MAKI's own default, not the landing's. Cloud shading mixes the sky
colour into the shadow side (`shadow = mix(cloud * 0.60, sky, 0.38)`), so a
saturated sky is what makes the clouds read as volumes; the landing overrides the
tokens with an achromatic near-white pair, which is deliberately subtle behind a
headline but renders as an almost blank white field on its own.

The frame is chosen by `SKY_TIME` in the build script and the render is
supersampled: the cloud envelope is a hard threshold on noise, and a still frame
has no animation to hide the aliasing.

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

They are inlined by the build script and flattened to white so they read as faint
contrails against the sky rather than chemistry diagrams.
