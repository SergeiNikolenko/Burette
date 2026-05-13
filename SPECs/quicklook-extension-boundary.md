# Quick Look Extension Boundary

## Summary

The Swift Quick Look extension remains a Burette-owned runtime boundary during
and after the Writer migration.

## Invariants

- The extension bundle identifier remains stable unless a dedicated migration
  changes it.
- Forced preview content types remain registered.
- `PreviewExtension/` continues to own Quick Look preview generation.
- `PreviewExtension/Web/` remains the self-contained web runtime used by Finder
  previews.
- Build scripts must continue embedding `BurretePreview.appex` into the final
  app bundle.

## Requirements

- Any repository layout move must update build and install scripts in the same
  phase.
- Any Tauri config move must preserve resource access to preview web assets.
- Quick Look verification must run after changes to `PreviewExtension`,
  `apps/desktop/src-tauri`, bundle config, build scripts, or vendored assets.

## Acceptance Criteria

- `./scripts/build.sh` produces an app bundle with the embedded preview
  extension.
- `./scripts/install.sh` installs the app and refreshes Quick Look.
- Forced previews for PDB, CIF, and XYZ samples still render.
