# Document Date Display Spec

## Summary

Show the document's creation and last-updated timestamps near the top of the editor so the user has quick context without opening a metadata panel.

## Goals

- Display "Last updated" at minimum, optionally creation date.
- Use relative time for recent values ("2 minutes ago"), absolute for older ones.
- Source the data from filesystem timestamps (or frontmatter when present).
- Keep the display unobtrusive and aligned with the document title area.

## Non-Goals

- A full metadata or properties panel.
- Editable timestamps.
- Timezone configuration in v1 (use the system locale).

## Data Source Rules

Order of precedence:

1. Frontmatter `created` / `updated` keys, if present.
2. Filesystem birth time (`ctime` on macOS, equivalent on Windows/Linux).
3. Filesystem `mtime` for last-updated.

## UX Decisions

- Render under the document title in a small, muted text style.
- Format: `Updated 2 minutes ago • Created Apr 3` (creation only on hover or when explicitly enabled).
- Switch from relative to absolute after ~7 days.
- Update the relative timestamp on a low-frequency interval (e.g., once a minute).

## Implementation Notes

- Add a Rust command `read_file_metadata(path) -> { created, modified }` if the existing fs commands don't already return it.
- Add a `useDocumentMetadata(path)` hook that returns merged frontmatter + filesystem metadata.
- Re-read on save and on watcher updates.

## Files Expected To Change

- `apps/desktop/src-tauri/src/commands/fs.rs`
- `apps/desktop/src/components/document-title/`
- `apps/desktop/src/hooks/use-document-metadata.ts` (new)
- `apps/desktop/src/lib/relative-time.ts` (new or existing)
- frontend tests

## Acceptance Criteria

- The document title area shows a "Last updated" line.
- Recent timestamps render as relative time and update over time without rerender thrash.
- Frontmatter `updated` overrides filesystem `mtime` when present.
- No new heavy dependency for date formatting (use `Intl.RelativeTimeFormat`).
