# Agent Notes

This file is for coding agents working on Burrete. Keep user-facing installation
and usage instructions in `README.md`.

## Project Shape

Burrete is a macOS menu bar app plus a Quick Look Preview Extension for molecular
structure files. It renders structures directly in Finder previews and keeps the
main app out of the Dock.

The Quick Look extension bundle identifier is:

```text
com.local.BurreteV10.Preview
```

Keep the extension identifier stable to avoid stale Quick Look registration
conflicts while the product name remains Burrete.

Forced preview content types:

```text
com.local.burrete10.pdb
com.local.burrete10.cif
```

## Common Commands

```bash
# Build and install locally
./scripts/build.sh
./scripts/install.sh

# Force Quick Look to preview a sample
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif

# Preview a real desktop file
./scripts/force-preview.sh ~/Desktop/1HTB.pdb

# Inspect runtime logs
./scripts/tail-log.sh

# Refresh vendored Mol* assets
npm ci --ignore-scripts
npm run vendor:molstar
```

After installing or replacing the app, refresh Quick Look:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```

## CI And Releases

Pull requests run the full CI workflow on macOS: npm dependency restore, release
version checks, JavaScript syntax checks, plist linting, and a local Xcode build.
Every PR intended for merge must bump `package.json`, `package-lock.json`,
`MARKETING_VERSION`, and the visible About version together.

Merging to `main` builds the app and publishes a GitHub Release tagged with the
same package version. If the tag already exists, the release workflow fails so
the next PR cannot overwrite an existing release.

Local hooks use lefthook:

```bash
npm ci --ignore-scripts
npm run prepare
```

## Runtime Files

Quick Look previews are generated under the extension container cache. Burrete
keeps Mol* assets shared and writes per-preview runtime HTML/data files for
repeatable WebKit loading.

Primary log path:

```text
~/Library/Containers/com.local.BurreteV10.Preview/Data/Library/Caches/Burrete/Burrete.log
```

Preview cache:

```text
~/Library/Containers/com.local.BurreteV10.Preview/Data/Library/Caches/Burrete/previews
```
