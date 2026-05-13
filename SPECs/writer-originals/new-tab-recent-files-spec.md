# New Tab Recent Files Spec

## Summary

Extend the existing launcher page (the `New tab` surface shipped in the workspace) so it shows a list of recently opened files below the primary actions.

## Goals

- Display the most recently opened markdown files on the launcher page.
- Let the user open a file with one click directly from the launcher.
- Keep the recent list scoped to the current workspace.
- Reuse the existing launcher-tab reuse rules (clicking a recent file converts the launcher tab into that file's tab).

## Non-Goals

- Pinned/favorite files (separate spec if desired).
- Cross-workspace recents.
- A separate dashboard surface.

## UX Decisions

- Show 8-12 recent files below the primary action buttons.
- Each row: file title, parent path in muted text, last-opened relative time.
- Clicking a row opens the file (reusing the launcher tab as today).
- A small `Show all` link opens the file search palette pre-scoped to recents.

## Data Source

- Track recent files in the editor store: an ordered list of paths capped at ~50.
- Update on file open; deduplicate by path with most-recent-first ordering.
- Persist alongside the existing session data.
- Drop entries whose files no longer exist when listing.

## Implementation Notes

- Add a `recentFiles` slice to the editor store with `pushRecent(path)` and `pruneMissing()`.
- Hook recent push into the existing `openFile` action.
- The launcher page renders recents only when the workspace is open.

## Files Expected To Change

- `apps/desktop/src/stores/editor-store.ts`
- `apps/desktop/src/components/editor-area/new-tab-page.tsx` (existing launcher page)
- `apps/desktop/src/hooks/use-recent-files.ts` (new)
- session persistence module
- frontend tests

## Acceptance Criteria

- Opening a new tab shows a recent files list once the user has opened files in the workspace.
- Clicking a recent file opens it in the current launcher tab (reusing the existing reuse rule).
- The list survives app restart.
- Stale entries (deleted files) are filtered out automatically.
