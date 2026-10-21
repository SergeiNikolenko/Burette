# Workflow Strategy

The workflows in this directory are split so pull requests get fast,
review-friendly signal while slower native checks still protect packaged app and
Quick Look behavior.

## Pull Requests

- `ci.yml` always runs `scripts/ci-fast.sh` on macOS as two parallel jobs: `js`
  (lint, typecheck, JS tests) and `rust` (fmt, clippy, unit tests with a cached
  target directory).
- `ci.yml` builds the native bundle only when a PR changes native, package, or
  build/install files. The native build runs in parallel with fast validation.

- New commits cancel obsolete CI and blob-size runs for the same PR, freeing
  runners instead of finishing checks against an outdated revision. Main CI runs
  are not cancelled while running.
- Native acceptance ZIP artifacts are uploaded without additional compression.

## Build Caches

- The shared toolchain action caches Bun downloads by OS, architecture, Bun
  version and lockfile, with a same-toolchain fallback for changed lockfiles.
  Frozen-lockfile installation still runs; `node_modules` is not cached.

- Native, nightly, and release jobs set `CARGO_TARGET_DIR` outside the
  workspace because `scripts/build.sh` compiles from a throwaway copy. They share
  the `native-release` Rust cache: nightly runs on `main` save it, PR builds
  restore and refresh it, and release builds only restore it.
- `blob-size-policy.yml` rejects accidental large blobs unless the path is
  explicitly allow-listed.

## Scheduled Checks

- `nightly-smoke.yml` builds a flavored app, installs it, runs packaged Quick
  Look smoke checks, and uploads smoke/performance reports.

## Releases

- `release.yml` builds the release app, validates signing, packages zip/dmg
  artifacts, creates the GitHub release, and updates the external Homebrew tap
  for stable releases. It uses Developer ID plus notarization when all Apple
  credentials are available and otherwise publishes an ad-hoc signed build.
- Release notes are grouped by `.github/release.yml`.

## Rule Of Thumb

- Keep PR-time checks focused enough to be useful during review.
- Move broad native, all-sample, and release-only validation into scheduled or
  release workflows unless a PR touches that surface.
- Reuse `.github/actions/setup-burette-toolchain` for Bun, dependencies, and
  `xyzrender` setup so CI, nightly smoke, and release jobs do not drift.
