# Releasing Burette

## Release Identity

Burette may use Writer's release discipline, but release identity remains
Burette-specific:

- app name: `Burrete`
- app bundle identifier: `com.local.BurreteV10`
- Quick Look extension identifier: `com.local.BurreteV10.Preview`
- release repository: the Burette GitHub repository
- release artifacts: signed Burette app bundles with the embedded Quick Look
  extension

## Version Discipline

Before a release, keep these versions aligned:

- root `package.json`
- root `package-lock.json`
- Xcode `MARKETING_VERSION`
- visible About/update version strings

Run:

```bash
npm run check:release
```

## Pre-Release Checks

Run the lightweight checks first:

```bash
npm run check:js
npm run test:ui
npm run test:agent
npm run build:web
```

Then build the macOS bundle:

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

## Release Script

Use the project release helper when preparing a tagged artifact:

```bash
./scripts/release.sh
```

The release process must not overwrite existing tags. If a tag already exists,
bump the version and rerun the release checks.

## Artifact Requirements

Every release app bundle must satisfy:

- `Burrete.app` launches as the desktop shell.
- `Burrete.app/Contents/PlugIns/BurretePreview.appex` exists.
- Deep codesign verification passes.
- Finder Quick Look can preview PDB, CIF, and XYZ samples.
- Update metadata points to the Burette release endpoint.

## License Follow-Up

License alignment is a release/legal task and should be handled deliberately in
the same release that finalizes imported Writer-derived structure or assets.
