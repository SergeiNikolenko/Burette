# Quick Look Extension Instructions

## Scope

These rules apply to `PreviewExtension/**`, `PreviewExtension/Web/**`, and
changes that affect Finder Quick Look preview behavior.

## Stable Identifiers

The release Quick Look extension identifier is:

```text
com.local.BuretteV10.Preview
```

Forced release preview content types include:

```text
com.local.burette10.pdb
com.local.burette10.cif
```

Do not change bundle identifiers, exported content types, or Launch Services
registration behavior without an explicit migration plan.

## Contract Rules

- Invoke `@build-macos-apps` for macOS app, Xcode project, Quick Look extension,
  signing, packaging, build, run, and native verification work.
- Invoke `$apple-design` for macOS Finder/Quick Look UI, AppKit/SwiftUI shell,
  icon, menu, toolbar, accessibility, or Apple Human Interface Guidelines
  decisions.
- For native macOS UI or icon work, check SF Symbols through `$apple-design`
  before adding custom glyphs. Keep custom or product-specific icons only when
  the molecular meaning is not covered by a system symbol.
- Invoke `@product-design` before implementation when the change affects the
  preview product flow, inspection workflow, or user-facing design direction.
- Use `BURETTE_DEV_FLAVOR=<worktree-slug>` for packaged local builds and Quick
  Look checks. Do not run unflavored build/install commands for local testing
  unless the task is explicitly a release-bundle task.
- Keep `config/preview-formats.json`, `apps/desktop/src-tauri/AppMetadata.plist`,
  and Quick Look content-type behavior in sync.
- `PreviewExtension/Web/viewer.js` is a high-risk runtime boundary. Do not
  mechanically refactor it without focused viewer/runtime contract coverage.
- Browser-dev success is not Quick Look success. Finder/Quick Look has separate
  bundle registration, container logs, cache, and Launch Services state.
- Use logs and machine-readable smoke output before claiming a Quick Look fix.

## Local Verification

For a flavored packaged app:

```bash
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/build.sh
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/install.sh
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/force-preview.sh samples/mini.pdb
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/force-preview.sh samples/mini.cif
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/force-preview.sh samples/mini.xyz
```

For broader sample coverage:

```bash
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/smoke-samples-quicklook.sh samples
```

For focused CI-like preview checks:

```bash
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/quicklook-preview-smoke.sh samples/mini.pdb samples/mini.cif samples/mini.sdf
```

After replacing the app or extension, refresh Quick Look state:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```
