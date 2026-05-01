<h1 align="center">Burrete</h1>

<p align="center">Finder-native molecular structure previews for macOS: Mol* 3D, fast XYZ, xyzrender SVG, and RDKit molecule grids.</p>

<p align="center">
  <img alt="Version 0.10.19" src="https://img.shields.io/badge/version-0.10.19-0f8f72.svg?style=flat-square" />
  <a href="https://opensource.org/licenses/MIT"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-yellow.svg?style=flat-square" /></a>
  <img alt="macOS 12+" src="https://img.shields.io/badge/macOS-12%2B-blue.svg?style=flat-square" />
  <img alt="Quick Look" src="https://img.shields.io/badge/Quick%20Look-extension-57606a.svg?style=flat-square" />
  <img alt="Molstar" src="https://img.shields.io/badge/viewer-Mol%2A-0f8f72.svg?style=flat-square" />
</p>

<p align="center">
  <img src="docs/public/burrete-quick-look-preview.png" alt="Burrete Quick Look preview of 1HTB.pdb" width="90%" />
</p>

## What Is Burrete?

Burrete is a macOS menu bar app with a Quick Look preview extension for
molecular structure files. Select a structure file in Finder, press Space, and
Burrete opens a native preview that can use Mol* for interactive 3D, a fast SVG
path for XYZ files, external `xyzrender` for publication-style XYZ/CUBE output,
or an RDKit-powered molecule grid for compound collections.

It is built for quick structure inspection without opening a full molecular
modeling environment.

## Download

The easiest way to install Burrete is from the GitHub Releases page:

[Download the latest Burrete release](https://github.com/SergeiNikolenko/Burette/releases/latest)

1. Open the latest release.
2. Download the `Burrete-<version>.zip` file.
3. Unzip it.
4. Move `Burrete.app` to your `Applications` folder.
5. Open Burrete once from `Applications`.

After that, use Finder as usual: select a supported molecular structure file and
press Space to preview it.

## Supported Files

Burrete supports common structure and small-molecule collection formats:

- PDB and PDBQT
- PDBx/mmCIF and BinaryCIF
- SDF, MOL, and MOL2
- SMILES files (`.smi`, `.smiles`)
- CSV and TSV tables with SMILES-like columns
- XYZ, extXYZ, CUBE, GRO, GROMACS-style trajectories/topologies, and related text outputs

XYZ files use the lightweight Fast XYZ renderer by default in Quick Look for
instant first-frame previews. You can switch to Mol* for interactive rotation or
to external `xyzrender` for high-quality SVG output. If you rotate the molecule
in Mol* and then switch to `xyzrender`, Burrete passes the current orientation to
`xyzrender` through its reference-file workflow.

CUBE and XYZ previews also expose an optional VESTA handoff when VESTA is
installed. Double-clicking a supported file can open it in Burrete; pressing
Space keeps using the Quick Look preview.

## Preview Features

Burrete keeps the preview compact and Finder-friendly:

- interactive 3D molecular structures powered by Mol*
- protein ribbons and ligands in the same scene
- light, dark, automatic, and transparent preview backgrounds
- a small floating toolbar for fullscreen and optional Mol* panels
- optional sequence, log, left, and right Mol* panels when you need them
- fast static SVG previews for `.xyz` files, including first-frame multi-frame XYZ and extXYZ lattice boxes
- external `xyzrender` previews with built-in presets, custom JSON configs, and optional advanced CLI flags
- RDKit grids for SDF, SMILES, CSV, and TSV collections
- grid search, sorting, SMARTS filtering/highlighting, selection, and export to SMILES or CSV
- infinite grid loading for larger collections

## Settings

Burrete runs as a menu bar app. Its settings window includes:

- launch and menu bar behavior
- transparent or opaque preview background
- default visibility for Mol* panels
- renderer selection: Auto, Fast XYZ SVG, Mol* Interactive, or external `xyzrender`
- `xyzrender` executable path, built-in preset/custom JSON config, and extra CLI flags
- quick `.xyz` toolbar switching between Fast SVG, Mol*, and `xyzrender`
- grid preview enablement for SDF, SMILES, CSV, and TSV files
- Finder file association registration
- preview cache cleanup
- log access
- update checks for stable and beta GitHub Releases

## Build From Source

Most users should download Burrete from
[GitHub Releases](https://github.com/SergeiNikolenko/Burette/releases/latest).
If you want to build it yourself, clone the repository and run:

```bash
./scripts/doctor.sh
./scripts/build.sh
./scripts/install.sh
```

The local installer places the app here:

```text
~/Applications/Burrete.app
```

## Development Checks

Useful local checks:

```bash
npm run check:js
npm run check:release
npm run test:web
npm run test:agent
```

The Quick Look extension caches generated runtime files under the extension
container. After replacing the app, refresh Quick Look with:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```

## License

MIT
