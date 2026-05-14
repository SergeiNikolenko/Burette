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
- root `package-lock.json`
- Tauri `apps/desktop/src-tauri/tauri.conf.json`
- Xcode `MARKETING_VERSION`
- visible About/update version strings exposed by the Tauri shell

Run:

```bash
npm run check:release
```

## Pre-Release Checks

Run the fast checks first:

```bash
npm run ci:fast
```

For native, packaging, Quick Look, or release changes, build the macOS bundle:

```bash
./scripts/build.sh
codesign --verify --deep --strict build/Burrete.app
test -d build/Burrete.app/Contents/PlugIns/BurretePreview.appex
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

The script expects a clean version state and produces release artifacts for the
GitHub release workflow.

## Artifact Requirements

Every release app bundle must satisfy:

- `Burrete.app` launches as the desktop shell.
- `Burrete.app/Contents/PlugIns/BurretePreview.appex` exists.
- Deep codesign verification passes.
- Finder Quick Look can preview PDB, CIF, and XYZ samples.
- Update metadata points to the Burrete release endpoint.

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

The npm package lives in `packages/burrete`. It is a thin CLI installer for the
macOS app, not the app bundle itself. Publish it from that workspace package
after npm authentication and OTP:

```bash
npm publish --workspace packages/burrete
```

pnpm uses the same npm package:

```bash
pnpm dlx burrete install
```

## In-App Updates

The desktop app checks Burrete GitHub Releases on launch and from the app menu.
A newer release can be downloaded from the update dialog.
