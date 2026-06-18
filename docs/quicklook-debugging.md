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

Build and install locally with a dev flavor:

```bash
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/build.sh
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/install.sh
```

Agents should always use a dev flavor for local packaged builds and installs so
the installed app, extension IDs, container paths, and forced content types do
not collide with the release namespace or with another dev install. Run
unflavored `./scripts/build.sh` and `./scripts/install.sh` only when explicitly
producing a release or final non-dev bundle.

The example above installs `~/Applications/Burrete-chat85b0.app` and registers
`com.local.BurreteV10.Dev.chat85b0.Preview`. Normal Finder ownership for file
extensions remains global, so use forced previews for flavor-specific smoke
tests.

Refresh Quick Look after replacing the app:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```

## Browser-Only Preview Debug Loop

Use the browser-only Quick Look debug loop when changing React/CSS/viewer web
surfaces and you need to inspect the Quick Look-shaped preview without building
or registering the native Finder extension. This route is for development and
debugging only. It must not be exposed as an end-user command or menu item.

Start the desktop Vite server:

```bash
vp dev
```

Open the dedicated debug URL in the built-in Browser:

```text
http://127.0.0.1:1420/?quickLookFile=/absolute/path/to/file.pdb
```

For repository samples, use:

```text
http://127.0.0.1:1420/?quickLookFile=/absolute/path/to/Burette/samples/mini.pdb
```

Build the sample path from the current repository root and URL-encode it when
constructing the URL from tooling. Do not use `devFiles` for this check.
`devFiles` opens the normal browser-dev app shell; `quickLookFile` is the
isolated Quick Look debug surface.

Expected browser state:

- The page renders a single `Quick Look <filename>` dialog.
- The preview content is the same viewer runtime that the selected renderer
  would use for that file.
- The normal browser-dev app chrome is absent: no `Open structures` tablist, no
  project sidebar search, and no main workbench behind the preview.
- The dialog has an explicit `Done` close control and the red close dot.

Use this loop for fast visual checks of toolbar spacing, preview sizing,
transparent surfaces, renderer controls, and CSS regressions. It does not prove
Launch Services registration, extension signing, cache invalidation, or Finder
Quick Look process behavior. After changes to Swift, packaging, content types,
extension assets, or native runtime generation, still run the forced preview
smoke path below.

## Smoke Tests

Use forced previews to bypass Launch Services ambiguity while debugging:

```bash
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/force-preview.sh samples/mini.pdb
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/force-preview.sh samples/mini.cif
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/force-preview.sh samples/mini.xyz
```

Keep the same `BURRETE_DEV_FLAVOR` value across build, install, diagnostics,
and smoke commands.

For a real desktop file:

```bash
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/force-preview.sh ~/Desktop/1HTB.pdb
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
web performance marks, recent UI or render errors, and the desktop
`preview-trace.jsonl`. Quick Look also writes `preview-trace.jsonl` next to its
extension logs when a preview request is created, completed, or fails. The app
log format is:

```text
timestamp level subsystem documentId event elapsedMs message
```

Diagnostics bundles are local files only. They do not upload telemetry and do
not include raw molecule file contents or structure payloads.

Generated desktop and Quick Look runtime directories contain a `manifest.json`
with `schemaVersion`, `complete`, selected renderer, source extension, byte
counts, and asset profile or host details. Treat a missing or incomplete
manifest as a runtime-generation failure before debugging Mol*, RDKit, or
`xyzrender` behavior.

`scripts/quicklook-preview-smoke.sh` validates this stability contract for each
successful preview: the Quick Look log must expose the trace request id and
runtime directory, `preview-trace.jsonl` must contain a completed Quick Look
event for that request, and the runtime directory must contain a complete
`manifest.json`.

On hosts where macOS refuses to launch an ad-hoc signed Quick Look extension,
the same smoke script reports `Quick Look extension launch failure` using
recent unified-log entries instead of returning a generic `NO_REQUEST`. This is
a host trust/signing failure, not a renderer or runtime-manifest failure. The
script does not create certificates; signed environments can pass an existing
identity through `BURRETE_CODESIGN_IDENTITY` during local install. If the
unified-log window does not contain the AMFI rejection, the script falls back to
the installed `BurretePreview` signature and reports that the extension is
ad-hoc signed.

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
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/build.sh
codesign --verify --deep --strict build/Burrete-chat85b0.app
test -d build/Burrete-chat85b0.app/Contents/PlugIns/BurretePreview.appex
test -d build/Burrete-chat85b0.app/Contents/PlugIns/BurreteThumbnail.appex
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/quicklook-preview-smoke.sh samples/mini.pdb samples/mini.cif samples/mini.xyz
```
