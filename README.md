<h1 align="center">Burrete</h1>

<p align="center">Finder-native molecular structure previews for macOS, powered by Mol*.</p>

<p align="center">
  <img alt="Version 0.10.5" src="https://img.shields.io/badge/version-0.10.5-0f8f72.svg?style=flat-square" />
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-yellow.svg?style=flat-square" /></a>
  <img alt="macOS 12+" src="https://img.shields.io/badge/macOS-12%2B-blue.svg?style=flat-square" />
  <img alt="Quick Look" src="https://img.shields.io/badge/Quick%20Look-extension-57606a.svg?style=flat-square" />
  <img alt="Molstar" src="https://img.shields.io/badge/viewer-Mol%2A-0f8f72.svg?style=flat-square" />
</p>

<p align="center">
  <img src="docs/public/burrete-quick-look-preview.png" alt="Burrete Quick Look preview of 1HTB.pdb" width="90%" />
</p>

## Quick Start

Burrete is a macOS menu bar app plus a Quick Look Preview Extension for molecular
structure files. It renders structures directly in Finder previews and keeps the
main app out of the Dock.

```bash
./scripts/doctor.sh
./scripts/build.sh
./scripts/install.sh
```

The installer writes the app to:

```text
~/Applications/Burrete.app
```

After installing or replacing the app, refresh Quick Look:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```

## Preview Experience

Burrete turns a structure file such as `1HTB.pdb` into a native Quick Look
preview with an `Open with Burrete` action in the title bar. The preview uses a
transparent Quick Look background by default, so the Mol* canvas sits naturally
inside the macOS glass frame instead of looking like a separate web page.

The bundled Mol* viewer is configured for compact Finder use:

- protein structures render as interactive 3D ribbons and ligands are visible in
  the same scene
- sequence, log, left, and right Mol* panels stay hidden until requested
- the floating toolbar can be dragged away from molecule controls
- the toolbar exposes fullscreen plus `L`, `R`, `Seq`, and `Log` panel toggles
- the standalone app viewer shares the same runtime assets and preview settings

## Supported Inputs

Burrete supports common structure formats used in molecular modeling:

- PDB and PDBQT
- PDBx/mmCIF and BinaryCIF
- SDF, MOL, MOL2
- XYZ and GRO

Finder double-click can open supported structures in Burrete, while Space keeps
using the Quick Look extension.

## Settings

The menu bar settings window includes:

- application launch and menu bar behavior
- transparent or opaque preview background
- default visibility for Mol* panel toggles
- Finder file association registration
- preview cache cleanup
- log access
- GitHub Releases update checks with stable and beta channels

The Quick Look extension bundle identifier is:

```text
com.local.BurreteV10.Preview
```

Keeping the extension identifier stable avoids stale Quick Look registration
conflicts while the product name stays Burrete.

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

Forced preview content types:

```text
com.local.burrete10.pdb
com.local.burrete10.cif
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

## License

MIT
