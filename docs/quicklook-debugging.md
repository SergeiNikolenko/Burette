# Quick Look Debugging

## Boundary

Burrete's Quick Look extension is built from `PreviewExtension/` through
`Burrete.xcodeproj`. The final local app must contain:

```text
build/Burrete.app/Contents/PlugIns/BurretePreview.appex
```

The extension bundle identifier is:

```text
com.local.BurreteV10.Preview
```

The forced preview content types are:

```text
com.local.burrete10.pdb
com.local.burrete10.cif
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

## Common Failure Points

- The app was rebuilt but not reinstalled into the location Finder is using.
- Quick Look cache was not refreshed after replacing the app.
- The final Tauri bundle does not contain `BurretePreview.appex`.
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
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif
./scripts/force-preview.sh samples/mini.xyz
```
