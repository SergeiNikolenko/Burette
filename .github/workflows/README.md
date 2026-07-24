# Workflow Strategy

The workflows in this directory are split so pull requests get fast,
review-friendly signal while slower native checks still protect packaged app and
Quick Look behavior.

## Pull Requests

- `ci.yml` always runs `bun run ci:fast` on macOS.
- `ci.yml` builds the native bundle only when a PR changes native, package, or
  build/install files.
- `blob-size-policy.yml` rejects accidental large blobs unless the path is
  explicitly allow-listed.

## Scheduled Checks

- `nightly-smoke.yml` builds a flavored app, installs it, runs packaged Quick
  Look smoke checks, and uploads smoke/performance reports.

## Releases

- `release.yml` builds the release app, validates signing, packages zip/dmg
  artifacts, creates the GitHub release, and updates the external Homebrew tap
  for stable releases.
- Release notes are grouped by `.github/release.yml`.

## Rule Of Thumb

- Keep PR-time checks focused enough to be useful during review.
- Move broad native, all-sample, and release-only validation into scheduled or
  release workflows unless a PR touches that surface.
- Reuse `.github/actions/setup-burette-toolchain` for Bun, dependencies, and
  `xyzrender` setup so CI, nightly smoke, and release jobs do not drift.
