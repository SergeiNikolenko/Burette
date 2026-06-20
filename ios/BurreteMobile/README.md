# BurreteMobile

BurreteMobile is the source-built iPhone preview app target for Burrete. It is
intended for opening molecular files from Files, iCloud Drive, AirDrop, Mail,
or other iOS document providers and inspecting them with the same preview
runtime used by the desktop and Quick Look surfaces where possible.

The app is not distributed by the macOS Homebrew cask. Build it from this
repository with Xcode and a development signing team.

## Target Layout

- `BurreteMobileApp.swift`: SwiftUI app entrypoint and document handoff.
- `MobilePreviewScreen.swift`: Apple-style mobile shell, file browser, SDF
  grid/table previews, bottom controls, sheets, and contextual actions.
- `MobilePreviewRuntime.swift`: file classification, summaries, trajectory
  metadata, SDF record extraction, and bundled runtime helpers.
- `MobilePreviewWebView.swift`: Mol* and web-runtime hosting for 3D structure
  previews.
- `Assets.xcassets/AppIcon.appiconset`: iOS app icon assets.
- `Info.plist`: document type registration, "Open In" support, and app
  metadata.

The Xcode scheme is `BurreteMobile`, and the target is wired in
`Burrete.xcodeproj`.

## Supported Document Flow

The app registers molecular document extensions in `Info.plist`, including
PDB, CIF, SDF, MOL, MOL2, XYZ, XYZR, trajectory/topology files, OpenMM
artifacts, and related chemistry text formats. iOS exposes Burrete in document
handoff surfaces when the file type matches these registrations.

The runtime currently uses:

- Mol* in a `WKWebView` for interactive 3D structure previews.
- RDKit.js for SDF molecule thumbnails in grid and table views.
- Native SwiftUI controls for file browsing, document actions, trajectory
  controls, logs, and mobile sheets.

## Build

For an unsigned compile check:

```bash
xcodebuild \
  -project Burrete.xcodeproj \
  -scheme BurreteMobile \
  -configuration Debug \
  -destination 'generic/platform=iOS' \
  -derivedDataPath /private/tmp/burrete-ios-deriveddata \
  CODE_SIGNING_ALLOWED=NO \
  build
```

For a real iPhone build, use an Apple development team that is trusted on the
device:

```bash
xcodebuild \
  -project Burrete.xcodeproj \
  -scheme BurreteMobile \
  -configuration Debug \
  -destination id=<device-udid> \
  -derivedDataPath /private/tmp/burrete-ios-device-deriveddata \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM=<team-id> \
  build
```

Install the built app with CoreDevice:

```bash
xcrun devicectl device install app \
  --device <device-udid> \
  /private/tmp/burrete-ios-device-deriveddata/Build/Products/Debug-iphoneos/BurreteMobile.app
```

If launching from the command line fails with a locked-device error, unlock the
iPhone and launch Burrete from the home screen. The install may still have
succeeded.

## Runtime Resources

The mobile target embeds the web preview assets required by Mol* and RDKit.
When changing those assets, verify that the built app bundle still contains:

```text
BurreteMobile.app/Web/rdkit/RDKit_minimal.js
BurreteMobile.app/Web/rdkit/RDKit_minimal.wasm
```

RDKit thumbnails are rendered inside noninteractive transparent `WKWebView`
instances so taps and long presses continue to belong to the surrounding SwiftUI
file rows and molecule cards.

## Verification Checklist

Before merging mobile changes:

1. Build `BurreteMobile` with signing disabled for a generic iOS device.
2. Build and install the signed app on a real iPhone when device access is
   available.
3. Open at least one structure file through Files or an "Open In" sheet.
4. Open an SDF document and confirm grid/table thumbnails render through RDKit.
5. Confirm the app icon appears on the iPhone home screen after reinstall.
