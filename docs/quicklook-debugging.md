# Quick Look Debugging

## Boundary

Burette's Quick Look extension is built from `PreviewExtension/` through
`Burette.xcodeproj`. For the browser-dev Quick Look surface
(`?quickLookFile=...`) and the difference between browser Quick Look and native
Finder Quick Look, use [Testing surfaces](tools/testing-surfaces.md).

The final local app must contain:

```text
build/Burette.app/Contents/PlugIns/BurettePreview.appex
build/Burette.app/Contents/PlugIns/BuretteThumbnail.appex
```

The preview extension bundle identifier is:

```text
com.local.BuretteV10.Preview
```

The thumbnail extension bundle identifier is:

```text
com.local.BuretteV10.Thumbnail
```

The main forced preview content types are:

```text
com.local.burette10.pdb
com.local.burette10.cif
com.local.burette10.xyz
com.local.burette10.xyzrender-input
```

## Build And Install

Build and install locally with a dev flavor:

```bash
BURETTE_DEV_FLAVOR=chat85b0 ./scripts/build.sh
BURETTE_DEV_FLAVOR=chat85b0 ./scripts/install.sh
```

Agents should always use a dev flavor for local packaged builds and installs so
the installed app, extension IDs, container paths, and forced content types do
not collide with the release namespace or with another dev install. Run
unflavored `./scripts/build.sh` and `./scripts/install.sh` only when explicitly
producing a release or final non-dev bundle.

The example above installs `~/Applications/Burette-chat85b0.app` and registers
`com.local.BuretteV10.Dev.chat85b0.Preview`. Normal Finder ownership for file
extensions remains global, so use forced previews for flavor-specific smoke
tests.

Refresh Quick Look after replacing the app:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```

Remove a dev flavor with its script instead of deleting the bundle by hand:

```bash
BURETTE_DEV_FLAVOR=chat85b0 ./scripts/uninstall-dev.sh
```

Deleting a bundle (`rm -rf`, a removed `/tmp` review checkout, or the Trash)
does not unregister it. See
[Stale Launch Services registrations](#stale-launch-services-registrations).

## Stale Launch Services Registrations

Symptom: Spacebar preview shows the generic Quick Look card with
`Extension com.local.BuretteV10.Dev.<flavor>.Preview not found.` (or another
Burette extension id) instead of the Burette preview.

Cause: a Burette bundle was deleted or moved to the Trash while Launch Services
still has its record. Dev flavors namespace their own `com.local.burette10.*`
types, but they also claim shared third-party UTIs such as
`com.schrodinger.mol`, `public.pdb`, and `net.sourceforge.openbabel.mdl`. When
the missing bundle has a newer version than the installed app, Quick Look keeps
routing those types to the missing extension. Finder can re-register app
bundles that sit in the Trash, so empty the Trash after removing them.

Fix, from least to most manual:

1. In the app, open Settings and press **Quick Look → Reset**. The same action
   is under Help → Troubleshooting → Reset Quick Look. It unregisters Burette
   bundles that no longer exist or sit in the Trash, then re-registers the
   running app and refreshes Quick Look.
2. From the repository:

   ```bash
   ./scripts/prune-launch-services.sh --dry-run
   ./scripts/prune-launch-services.sh
   qlmanage -r && qlmanage -r cache
   ```

   `scripts/install.sh` runs the prune step on every install.
3. Inspect the records directly:

   ```bash
   LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
   "$LSREGISTER" -dump | grep -E '^path:.*Burette'
   "$LSREGISTER" -u /path/to/missing/Burette-<flavor>.app
   ```

## Smoke Tests

Use forced previews to bypass Launch Services ambiguity while debugging:

```bash
BURETTE_DEV_FLAVOR=chat85b0 ./scripts/force-preview.sh samples/mini.pdb
BURETTE_DEV_FLAVOR=chat85b0 ./scripts/force-preview.sh samples/mini.cif
BURETTE_DEV_FLAVOR=chat85b0 ./scripts/force-preview.sh samples/mini.xyz
```

Keep the same `BURETTE_DEV_FLAVOR` value across build, install, diagnostics,
and smoke commands.

For a real desktop file:

```bash
BURETTE_DEV_FLAVOR=chat85b0 ./scripts/force-preview.sh ~/Desktop/1HTB.pdb
```

## Logs And Cache

Primary extension log:

```text
~/Library/Containers/com.local.BuretteV10.Preview/Data/Library/Caches/Burette/Burette.log
```

Preview cache:

```text
~/Library/Containers/com.local.BuretteV10.Preview/Data/Library/Caches/Burette/previews
```

Tail logs through the project helper:

```bash
./scripts/tail-log.sh
```

The desktop app can export a local diagnostics bundle from Settings >
Maintenance > Diagnostics (Export) or from the command palette
(`Export Diagnostics`). The exported `.diagnostics` directory
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
identity through `BURETTE_CODESIGN_IDENTITY` during local install. If the
unified-log window does not contain the AMFI rejection, the script falls back to
the installed `BurettePreview` signature and reports that the extension is
ad-hoc signed.

Runtime cache layout, asset profiles, binary payload loading, and the boundary
between desktop previews and Finder previews are documented in
[Performance architecture](performance.md).

## Common Failure Points

- The app was rebuilt but not reinstalled into the location Finder is using.
- Quick Look cache was not refreshed after replacing the app.
- The final Tauri bundle does not contain `BurettePreview.appex`.
- The final Tauri bundle does not contain `BuretteThumbnail.appex`.
- Vendored web assets under `PreviewExtension/Web/` are missing or stale.
- Launch Services is still pointing at an older app bundle.
- A deleted or trashed dev build is still registered and owns a shared UTI.
- The selected file type is not registered to the expected forced content type.

## Quick Look RCA

| Symptom | Likely cause | Where to look first |
| --- | --- | --- |
| `quicklook-preview-smoke.sh` reports `NO_REQUEST` | Finder did not launch the extension, or Launch Services selected another generator. | Recent unified logs, `qlmanage -m plugins`, installed app path |
| Smoke reports `Quick Look extension launch failure` | macOS rejected the ad-hoc signed extension before renderer code ran. | Smoke output, unified-log AMFI entries, installed `BurettePreview` signature |
| Runtime directory is missing `manifest.json` | Preview runtime generation failed before web rendering. | Quick Look log, `preview-trace.jsonl`, `PreviewExtension/Platform/PreviewViewController.swift` |
| Manifest exists but preview is blank | Generated web assets or renderer-specific assets are missing or stale. | `PreviewExtension/Web/`, `vendor-assets.lock.json`, runtime `manifest.json` |
| Browser Quick Look succeeds but native Quick Look is blank | Browser-dev URL bypasses native extension registration, sandbox, and Launch Services. | `docs/tools/testing-surfaces.md`, extension container logs |
| Quick Look card says `Extension com.local.BuretteV10...Preview not found.` | A deleted or trashed Burette bundle is still registered and claims the file's UTI. | [Stale Launch Services registrations](#stale-launch-services-registrations) |
| Only `.csv` or `.tsv` normal preview is missing | macOS may route public table UTIs to the system generator. | Forced preview scripts, browser-dev grid rendering |

## Required Checks After Migration Changes

Run these after changes to `PreviewExtension/`, `Burette.xcodeproj`,
`apps/desktop/src-tauri`, `scripts/build.sh`, Tauri config, or vendored preview
assets:

```bash
BURETTE_DEV_FLAVOR=chat85b0 ./scripts/build.sh
codesign --verify --deep --strict build/Burette-chat85b0.app
test -d build/Burette-chat85b0.app/Contents/PlugIns/BurettePreview.appex
test -d build/Burette-chat85b0.app/Contents/PlugIns/BuretteThumbnail.appex
BURETTE_DEV_FLAVOR=chat85b0 ./scripts/quicklook-preview-smoke.sh samples/mini.pdb samples/mini.cif samples/mini.xyz
```
