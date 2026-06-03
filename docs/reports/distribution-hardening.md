# Distribution Hardening

Stage 16 inspected the release path for Developer ID signing, hardened runtime,
notarization, stapling, and release artifacts.

## Findings

- Local builds intentionally remain ad-hoc by default. `scripts/build.sh`
  uses `BURRETE_BUILD_MODE=local` unless a caller opts into release mode.
- Release builds are explicit. `scripts/release.sh` sets
  `BURRETE_BUILD_MODE=release`, requires a Developer ID Application identity,
  requires an Apple development team, and requires either a notarytool keychain
  profile or Apple ID notarization credentials.
- The checked-in Tauri config keeps `bundle.macOS.hardenedRuntime=false` so
  local debug builds keep their previous behavior. Release builds enable
  `bundle.macOS.hardenedRuntime=true` only inside the temporary build copy.
- The app bundle does not have a checked-in app entitlement file. The Quick Look
  preview and thumbnail extensions share `PreviewExtension/BurretePreview.entitlements`.
- The shared extension entitlement file grants sandboxing, user-selected
  read-only file access, and network client access. Network access is still
  present because removing it safely needs a separate Quick Look runtime smoke
  pass across all preview formats.

## Release Verification

The release check now rejects production bundles that are ad-hoc signed, missing
a TeamIdentifier, missing Developer ID Application authority, missing hardened
runtime metadata, missing `BurretePreview.appex`, or missing
`BurreteThumbnail.appex`.

Release packaging produces both:

- `build/release/Burrete.zip` for the in-app updater.
- `build/release/Burrete.dmg` for manual distribution.

The GitHub release workflow now fails before packaging when Developer ID and
Apple notarization secrets are absent.

## Remaining Blocker

Removing `com.apple.security.network.client` from the shared extension
entitlements is intentionally left as a separate hardening task. It should be
paired with Quick Look smoke coverage for PDB, CIF, XYZ, SDF, CSV, TSV, and
SMILES previews so the extension does not lose a needed runtime capability
silently.
