# Burrete Auto Update Tauri Spec

## Summary

Add a signed in-app update flow for the Tauri-based Burrete shell while keeping
Quick Look extension bundle identifiers, file associations, and cache paths
stable.

This adapts Writer Computer's native updater spec to Burrete's release model:
the user should be able to check for updates from the app menu/settings, install
with consent, and relaunch without manually downloading a new app bundle.

## Goals

- Detect a newer published Burrete release.
- Download and install updates only after user consent.
- Verify signatures before installation.
- Keep automatic checks quiet when the app is current.
- Expose the update state through native macOS menu/dialog surfaces and a small
  Settings row.
- Preserve Quick Look extension registration compatibility across updates.

## Non-Goals

- Forced background updates.
- Multiple channels beyond stable/beta if the current release process does not
  already support them.
- Delta updates.
- Changing bundle IDs, Quick Look extension IDs, UTIs, or cache paths.

## UX

Native menu items:

- `Check for Updates...`
- `Install Update and Restart` when an update is ready.
- `Downloading update...` while a download is active.

Settings surface:

- Shows current version.
- Offers `Check for Updates`.
- Shows the last check result or error in plain text.

Dialogs:

- No update: `Burrete <version> is current.`
- Update available: show version and release notes with `Install and Restart`
  and `Later`.
- Failure: show an actionable native error dialog.

## State Machine

- `idle`
- `checking`
- `up-to-date`
- `available { version, notes }`
- `downloading { progress }`
- `ready-to-install { version }`
- `error { message }`

Only one update task may run at a time. Manual checks reuse the active state
instead of starting duplicate downloads.

## Implementation Notes

- Use `tauri-plugin-updater` for signed update manifests.
- Keep updater orchestration in `apps/desktop/src-tauri/src/updater.rs`.
- Register updater commands through `apps/desktop/src-tauri/src/commands.rs`
  and the thin Tauri entrypoint in `apps/desktop/src-tauri/src/lib.rs`.
- Store dismissed version state in app data so a user is not nagged repeatedly
  for the same release.
- Ensure updates do not rewrite Quick Look identifiers:
  - main bundle ID remains stable;
  - Quick Look extension ID remains stable;
  - file association declarations remain synchronized with supported backend
    formats.

## Expected Files

- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/src/updater.rs`
- `apps/desktop/src-tauri/src/commands.rs`
- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/src/App.tsx` only for the Settings row
- release scripts that publish the signed updater manifest

## Acceptance Criteria

- Manual check reports current version when no update is available.
- Outdated builds show a native update prompt.
- Install flow downloads, verifies, installs, and relaunches.
- Invalid signatures are rejected.
- Automatic no-update checks stay silent.
- Quick Look still renders test fixtures after an update.
