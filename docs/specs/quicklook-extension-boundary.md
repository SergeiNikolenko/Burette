# Quick Look Extension Boundary

The Swift Quick Look extension is a separate runtime boundary from the Tauri
desktop app.

## Invariants

- The extension bundle identifier stays `com.local.BurreteV10.Preview`.
- Forced Burrete content types stay stable unless a migration is explicit.
- The shipped app embeds `BurretePreview.appex` under `Contents/PlugIns/`.
- The extension uses bundled web assets under `PreviewExtension/Web/`.
- Quick Look cache refresh remains part of local install and debugging flows.

## Verification

```bash
./scripts/build.sh
./scripts/install.sh
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif
```
