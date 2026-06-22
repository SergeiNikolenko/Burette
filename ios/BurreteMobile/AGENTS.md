# BurreteMobile Agent Instructions

## Scope

These rules apply to `ios/BurreteMobile/**` and changes that affect the
source-built iPhone preview app target.

## Required Context

- Read `ios/BurreteMobile/README.md` before changing the mobile target.
- Read `docs/architecture.md` for the shared desktop, Quick Look, and preview
  runtime boundaries.
- Read `PreviewExtension/AGENTS.md` when changing bundled web preview assets
  shared with Quick Look.

## Required Capabilities

- Invoke `@build-ios-apps` for iOS project discovery, simulator/device builds,
  installs, launches, tests, screenshots, logs, and UI automation. Prefer its
  XcodeBuildMCP flow over ad hoc `xcodebuild` or `simctl` commands when the
  capability is available.
- Invoke `$apple-design` for iPhone UI, SwiftUI, app icon, SF Symbols,
  accessibility, visual polish, and Apple Human Interface Guidelines decisions.
- Invoke `@product-design` before implementation when the task is about mobile
  product flow, information architecture, prototype direction, or UX tradeoffs.

## Contract Rules

- Treat Simulator, generic iOS builds, and real iPhone installs as separate
  validation surfaces. Simulator or generic build success is not proof that a
  signed real-device install works.
- Do not change `BurreteMobile` scheme, target wiring, document type
  registrations, or bundled preview asset paths without updating
  `ios/BurreteMobile/README.md`.
- Keep the mobile app iPhone-first. Do not introduce persistent desktop-style
  sidebars or always-visible tool rails into the primary phone layout.
- Prefer SF Symbols for native iPhone controls when a semantic match exists.
  Keep custom app or molecular icons only when product-specific meaning requires
  them.
- Preserve the `WKWebView` preview runtime boundary. File loading, RDKit
  thumbnails, and Mol* hosting need real-device verification when touched.
- Do not hard-code development team IDs, device UDIDs, or local derived-data
  paths into source files or committed docs.

## Validation

For a signing-independent compile check:

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

For real-device work, build and install with the developer team and device
documented by the current task, then open at least one structure through Files
or an Open In handoff.
