# Quick Look Debugging

## Boundary

Burrete's Quick Look extension is built from `PreviewExtension/` through
`Burrete.xcodeproj`. The final local app must contain:

```text
build/Burrete.app/Contents/PlugIns/BurretePreview.appex
build/Burrete.app/Contents/PlugIns/BurreteThumbnail.appex
```

The preview extension bundle identifier is:

```text
com.local.BurreteV10.Preview
```

The thumbnail extension bundle identifier is:

```text
com.local.BurreteV10.Thumbnail
```

The main forced preview content types are:

```text
com.local.burrete10.pdb
com.local.burrete10.cif
com.local.burrete10.xyz
com.local.burrete10.xyzrender-input
```

## Build And Install

Build and install locally:

```bash
./scripts/build.sh
./scripts/install.sh
```

Refresh Quick Look after replacing the app:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```

## Smoke Tests

Use forced previews to bypass Launch Services ambiguity while debugging:

```bash
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif
./scripts/force-preview.sh samples/mini.xyz
```

For a real desktop file:

```bash
./scripts/force-preview.sh ~/Desktop/1HTB.pdb
```

## Logs And Cache

Primary extension log:

```text
~/Library/Containers/com.local.BurreteV10.Preview/Data/Library/Caches/Burrete/Burrete.log
```

Preview cache:

```text
~/Library/Containers/com.local.BurreteV10.Preview/Data/Library/Caches/Burrete/previews
```

Tail logs through the project helper:

```bash
./scripts/tail-log.sh
```

The desktop app can export a local diagnostics bundle from Settings > System >
Diagnostics or from the command palette. The exported `.diagnostics` directory
contains app logs, Quick Look logs, environment information, an app size report,
web performance marks, and recent UI or render errors. The app log format is:

```text
timestamp level subsystem documentId event elapsedMs message
```

Diagnostics bundles are local files only. They do not upload telemetry and do
not include raw molecule file contents or structure payloads.

Runtime cache layout, asset profiles, binary payload loading, and the boundary
between desktop previews and Finder previews are documented in
[Performance architecture](performance.md).

## Common Failure Points

- The app was rebuilt but not reinstalled into the location Finder is using.
- Quick Look cache was not refreshed after replacing the app.
- The final Tauri bundle does not contain `BurretePreview.appex`.
- The final Tauri bundle does not contain `BurreteThumbnail.appex`.
- Vendored web assets under `PreviewExtension/Web/` are missing or stale.
- Launch Services is still pointing at an older app bundle.
- The selected file type is not registered to the expected forced content type.

## Required Checks After Migration Changes

Run these after changes to `PreviewExtension/`, `Burrete.xcodeproj`,
`apps/desktop/src-tauri`, `scripts/build.sh`, Tauri config, or vendored preview
assets:

```bash
./scripts/build.sh
codesign --verify --deep --strict build/Burrete.app
test -d build/Burrete.app/Contents/PlugIns/BurretePreview.appex
test -d build/Burrete.app/Contents/PlugIns/BurreteThumbnail.appex
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif
./scripts/force-preview.sh samples/mini.xyz
```
