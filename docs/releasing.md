# Releasing Burrete

Release identity is Burrete-specific:

- app name: `Burrete`
- bundle app: `Burrete.app`
- Quick Look extension: `BurretePreview.appex`
- extension identifier: `com.local.BurreteV10.Preview`
- release repository: `SergeiNikolenko/Burrete`

## Version Discipline

Feature PRs do not need a version bump. Before a release, keep these versions
aligned:

- root `package.json`
- root `bun.lock`
- Tauri `apps/desktop/src-tauri/tauri.conf.json`
- Xcode `MARKETING_VERSION`
- visible About/update version strings exposed by the Tauri shell

Run:

```bash
bun run check:release
```

## Pre-Release Checks

Run the fast checks first:

```bash
bun run ci:fast
```

For native, packaging, Quick Look, or release changes, build the macOS bundle:

```bash
./scripts/build.sh
codesign --verify --deep --strict build/Burrete.app
test -d build/Burrete.app/Contents/PlugIns/BurretePreview.appex
test -d build/Burrete.app/Contents/PlugIns/BurreteThumbnail.appex
```

If Quick Look or renderer behavior changed, install and run forced previews:

```bash
./scripts/install.sh
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif
./scripts/force-preview.sh samples/mini.xyz
```

## Release Command

Use the repository release script:

```bash
./scripts/release.sh
```

Production releases require Developer ID signing and Apple notarization:

```bash
export BURRETE_CODESIGN_IDENTITY="Developer ID Application: Example, Inc. (TEAMID)"
export BURRETE_DEVELOPMENT_TEAM="TEAMID"
export APPLE_ID="release@example.com"
export APPLE_TEAM_ID="TEAMID"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
./scripts/release.sh
```

Instead of Apple ID credentials, a local notarytool keychain profile can be
used:

```bash
export BURRETE_NOTARY_KEYCHAIN_PROFILE="BurreteNotary"
./scripts/release.sh
```

For CI and pull-request validation, run the release dry run. It checks the
release script prerequisites and JavaScript syntax but does not build, sign,
notarize, staple, package, or publish:

```bash
./scripts/release.sh --dry-run
```

The local `./scripts/build.sh` path remains an ad-hoc debug build by default.
Release builds are explicit: `scripts/release.sh` sets
`BURRETE_BUILD_MODE=release`, requires a Developer ID Application identity,
uses the Xcode Release configuration, enables the Tauri macOS hardened runtime
inside the temporary build copy, signs with hardened runtime options, submits
the app to Apple notarytool, staples the notarization ticket, and then packages
zip and dmg artifacts.

## Artifact Requirements

Every release app bundle must satisfy:

- `Burrete.app` launches as the desktop shell.
- `Burrete.app/Contents/PlugIns/BurretePreview.appex` exists.
- `Burrete.app/Contents/PlugIns/BurreteThumbnail.appex` exists.
- Deep codesign verification passes.
- `codesign -dv --verbose=4 build/Burrete.app` shows a Developer ID
  Application authority, a TeamIdentifier, and hardened runtime metadata.
- `spctl --assess --type execute build/Burrete.app` passes.
- `xcrun stapler validate build/Burrete.app` passes.
- Finder Quick Look can preview PDB, CIF, and XYZ samples.
- Update metadata points to the Burrete release endpoint.

The zip artifact is the in-app updater artifact. The dmg artifact is for manual
distribution and is not currently consumed by the updater.

Before publishing performance-sensitive changes, regenerate the size and perf
smoke reports described in [Performance architecture](performance.md). The
release artifact should keep web asset profile membership explainable through
`config/web-runtime-profiles.json` and `scripts/size-report.sh`.

## Package Managers

Homebrew uses the cask in `Casks/b/burrete.rb` and the public tap at
`SergeiNikolenko/homebrew-burrete`. The working user command is:

```bash
brew tap SergeiNikolenko/burrete
brew install --cask burrete
```

The shorter default-tap command, `brew install --cask burrete`, works only if
the cask is accepted into `Homebrew/homebrew-cask`. The first upstream PR was
blocked because the app is not Apple-signed/notarized and the project does not
meet the default tap notability threshold yet.

After each GitHub release, update the cask `version` and `sha256` to match the
uploaded `Burrete-<version>.zip` asset. GitHub exposes the asset digest in the
release metadata as `sha256:<digest>`.

The registry package lives in `packages/burrete`. It is a thin CLI installer
for the macOS app, not the app bundle itself. Publish it from that workspace
package after registry authentication:

```bash
cd packages/burrete
bun publish
```

Bun installs the same published package:

```bash
bunx burrete install
bunx burrete doctor
```

The CLI installer installs to `~/Applications` by default and to
`/Applications` only with `--system`. It prints each install step, verifies the
GitHub `sha256:<digest>` asset checksum when release metadata provides one,
stages replacement through `Burrete.app.updating`, and restores the previous app
bundle if replacement fails. `burrete doctor` checks the installed app, embedded
Quick Look extension, `qlmanage`, and the app version.

## In-App Updates

The desktop app checks Burrete GitHub Releases on launch and from the app menu.
A newer release can be downloaded from the update dialog.
