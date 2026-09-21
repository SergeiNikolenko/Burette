---
name: burette-release-readiness
description: Review Burette release readiness for versioning, packaging, signing, updates, installers, and package managers.
---

# Release Readiness Review

Use this skill when a change touches release automation, packaging, installer
behavior, update manifests, version metadata, Homebrew, Bun package publishing,
signing, notarization, or user-facing release docs.

## Required Review Areas

- Version alignment:
  - root `package.json`
  - root `bun.lock`
  - Tauri `apps/desktop/src-tauri/tauri.conf.json`
  - Xcode `MARKETING_VERSION`
  - visible About/update version strings
- Build artifacts:
  - app bundle layout
  - Quick Look and thumbnail appex placement
  - updater zip
  - manual dmg
  - generated checksum files
- Signing and notarization:
  - Developer ID identity
  - Apple team credentials
  - notarytool profile
  - ad-hoc release escape hatch behavior
- Package managers:
  - external Homebrew tap `SergeiNikolenko/homebrew-burette`
  - `HOMEBREW_TAP_TOKEN`
  - cask `version` and `sha256`
  - Bun package under `packages/burette`
- User-facing release notes:
  - GitHub release page sections from `.github/release.yml`
  - `CHANGELOG.md` points to GitHub Releases
  - concise user-facing entries, not raw implementation logs

## Checks

Prefer:

```bash
bun run check:release
```

For stable releases, also verify the external Homebrew tap after the workflow
completes:

```bash
brew tap SergeiNikolenko/burette
brew update
brew info --cask SergeiNikolenko/burette/burette
brew fetch --cask --force SergeiNikolenko/burette/burette
```

## Output

Return release blockers first. Include stale tap/cask metadata, missing secrets,
version drift, unsigned/not-notarized assumptions, and missing release-note
labels.
