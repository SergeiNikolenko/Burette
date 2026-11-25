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
  - macOS app bundle layout
  - Quick Look and thumbnail appex placement
  - updater zip
  - manual dmg
  - generated checksum files
  - Sparkle framework, nested signed helpers and bundled license
  - Linux bundles (`Burette_<version>_amd64.deb`, `Burette-<version>-1.x86_64.rpm`, `Burette_<version>_amd64.AppImage`, `Burette-<version>-linux.sha256`)
  - Windows installer (`Burette_<version>_x64-setup.exe`, `Burette-<version>-windows.sha256`)
  - platform desktop metadata (`packaging/linux/`, `packaging/windows/file-associations.json`) and `config/xyzrender/requirements-*.txt` locks for macOS, Linux, and Windows
- Native updates:
  - paired Sparkle public variable/private secret and embedded public key
  - signed final ZIP and reachable appcast matching bundle version, minimum OS,
    architecture and stable/beta channel
  - legacy ZIP/SHA-256 migration and the older Burrete compatibility bridge
  - explicit coverage for DMG/ZIP, Homebrew and unsupported historical versions
  - real download, dirty-document cancellation, install, relaunch, Quick Look
    and existing plugin refresh; a signed fixture is not native acceptance
  - feed publication/retry after a partial release failure
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

Use this Mac for macOS builds and native acceptance: it is the only available
Mac. Do not send Apple-platform builds to the Linux compute hosts. When the
user requests native update verification, run its necessary local build and
focused native checks without asking again because the build is large.
Preserve the installed app and user documents; use an isolated development
namespace except when deliberately validating canonical release bundles.

Prefer:

```bash
bun run check:release
node scripts/desktop-metadata.mjs --check
```

Verify `Linux Bundle Build` and `Windows Installer Build` CI checks pass alongside macOS validation before dispatching `.github/workflows/release.yml`, and verify all three platform publish jobs (`release`, `linux-publish`, `windows-publish`) attach their artifacts to the GitHub Release.

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
