# Finder Thumbnail Extension Spike

Stage: P2 Finder Thumbnail Extension Spike

## Outcome

Burrete now has a separate Quick Look thumbnail extension target:
`BurreteThumbnail.appex`.

The spike deliberately keeps thumbnail rendering native. The thumbnail provider
does not import WebKit and does not load Molstar, RDKit, or the shared web
runtime.

## Initial Scope

The first thumbnail path is intentionally small:

- MOL/SDF single-molecule files through the V2000 atom block.
- PDB-like files through `ATOM` and `HETATM` records.
- XYZ files through the first frame.

Large, complex, unsupported, or unparsable files fall back to a generic static
molecular document glyph instead of trying to render the full preview.

## Build Integration

`scripts/build.sh` builds `BurretePreview` and `BurreteThumbnail`, then embeds
both app extensions into:

```text
build/Burrete.app/Contents/PlugIns/
```

## Validation Targets

Use these fixtures for the first manual Finder thumbnail pass:

- `samples/mini.pdb`
- `samples/mini.sdf`
- `samples/mini.xyz`

## Follow-Up

- Add an automated Finder thumbnail smoke only after the target is installed in
  a stable app bundle, because Launch Services thumbnail cache behavior is
  system-global and timing-sensitive.
- Decide whether `burrete-core` should expose a small native atom projection API
  before expanding beyond simple PDB, MOL/SDF, and XYZ files.
