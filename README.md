# Burrete

Burrete is a macOS menu bar app with a Quick Look Preview Extension for molecular structure files. It renders PDB, PDBx/mmCIF, BinaryCIF, SDF, MOL, and MOL2 files in Finder previews using Mol*.

The app itself stays out of the Dock. Settings and maintenance tools live in the menu bar, while Quick Look previews keep the Mol* UI compact by default.

## Features

- Menu bar settings window with General, Viewer, Files, Logs, and About sections.
- Compact Quick Look viewer with hidden sequence, log, and right panels by default.
- Draggable preview toolbar for fit-to-screen and Mol* panel toggles.
- Native fit-to-screen window resizing instead of WebKit fullscreen.
- Hidden debug UI by default, with logs still written to disk for troubleshooting.
- Shared Mol* assets and runtime preview cache for faster repeat previews.
- GitHub Releases update checks with stable/beta channels and app archive download.

## Build And Install

```bash
./scripts/doctor.sh
./scripts/build.sh
./scripts/install.sh
```

The installer writes the app to:

```text
~/Applications/Burrete.app
```

The Quick Look extension bundle identifier remains:

```text
com.local.BurreteV10.Preview
```

Keeping the extension identifier stable avoids stale Quick Look registration conflicts while the product name moves to Burrete.

## Reset Quick Look

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```

## Forced Preview Tests

```bash
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif
./scripts/force-preview.sh ~/Desktop/ltz_model.cif
./scripts/force-preview.sh ~/Desktop/1HTB.pdb
```

The forced content types are:

```text
com.local.burrete10.pdb
com.local.burrete10.cif
```

## Logs

Logs are available from Burrete Settings and from:

```bash
./scripts/tail-log.sh
```

Primary log path:

```text
~/Library/Containers/com.local.BurreteV10.Preview/Data/Library/Caches/Burrete/Burrete.log
```
