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

## What Is Burrete?

Burrete is a small macOS app that lets Finder preview molecular structure files.
Select a structure file, press Space, and Burrete shows an interactive Mol*
viewer directly inside the native Quick Look window.

It is useful when you want to inspect structures quickly without opening a full
molecular modeling environment.

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

Burrete supports common molecular structure formats:

- PDB and PDBQT
- PDBx/mmCIF and BinaryCIF
- SDF, MOL, and MOL2
- XYZ and GRO

Double-clicking a supported file can open it in Burrete. Pressing Space keeps
using the Quick Look preview.

## Preview Features

Burrete keeps the preview compact and Finder-friendly:

- interactive 3D molecular structures powered by Mol*
- protein ribbons and ligands in the same scene
- a transparent Quick Look background that fits the macOS preview frame
- a small floating toolbar for fullscreen and optional Mol* panels
- optional sequence, log, left, and right Mol* panels when you need them

## Settings

Burrete runs as a menu bar app. Its settings window includes:

- launch and menu bar behavior
- transparent or opaque preview background
- default visibility for Mol* panels
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

## License

MIT
