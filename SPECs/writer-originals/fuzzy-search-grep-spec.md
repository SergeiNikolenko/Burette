# Fuzzy Search And Grep Spec

## Summary

Add full-content fuzzy search and grep across the workspace. Today Writer only has fuzzy file-name search through the command palette; users cannot search the text inside their documents.

## Goals

- Let the user search the text content of every markdown file in the workspace.
- Rank results by relevance, not just recency.
- Show inline result snippets with the match highlighted.
- Clicking a result opens the file and jumps to the matched line.
- Keep performance acceptable on workspaces with thousands of files.

## Non-Goals

- Regex search in v1 (follow-up).
- Search-and-replace in v1.
- Searching non-markdown files.
- Case-sensitive toggle UI in v1 (defaults to smart case).

## Search Surface

### Entry points

- `Cmd+Shift+F` opens the content search palette.
- A dedicated search icon in the sidebar header also opens it.
- The existing command palette (`Cmd+P`) stays filename-only to keep muscle memory intact.

### Palette layout

- Search input at the top.
- Scrollable results list below: one row per match, grouped by file.
- Each result row shows: file title, matched line with the query highlighted, line number, and workspace-relative parent path.
- File headers are sticky; arrow keys navigate rows; Enter opens the active row.

## Backend Strategy

- Use `ripgrep`'s library (`grep` crate) on the Rust side to walk the workspace and match lines.
- Honor `.gitignore` (reuse the workspace ignore matcher already wired up for the file index).
- Match in parallel across files using `rayon` or similar, bounded to a reasonable thread count.
- Return at most N results per file (default ~10) and M total (default ~500) to keep the palette responsive.

### Search modes

- **Fuzzy mode** (default): tokenize the query and rank files whose content contains the tokens, weighted by proximity.
- **Grep mode**: triggered by prefixing the query with `/`. Matches lines literally. Snippets show the exact matched range.

Fuzzy mode is for "I kind of remember writing about foo and bar"; grep mode is for "find me this exact string".

## Ranking

For fuzzy mode:

- Prefer matches in headings over matches in body text.
- Prefer files where all query tokens appear close together.
- Use filename-stem matches as a tiebreaker.
- Recency bias is secondary to relevance.

## Incremental Index vs. Live Scan

Start with live scans: ripgrep is fast enough that a naive full-workspace scan is acceptable for v1 up to medium-sized workspaces.

If performance becomes a problem:

- Add an in-memory inverted index built from the existing workspace file index.
- Invalidate per file on watcher updates.

Do not design v1 around the inverted index.

## UX Decisions

- Results appear as the user types, debounced ~120ms.
- Show a "Searching..." indicator only if results take longer than ~200ms.
- Empty-query state shows a short hint explaining fuzzy vs. grep (`/` prefix).
- Clicking a result opens the file in the active tab (honoring the existing tab-reuse rules) and scrolls to the matched line.
- The editor highlights the matched range briefly on arrival.

## Implementation Notes

- Add a Rust command `search_workspace_content(query, options) -> Vec<ContentMatch>`.
- `ContentMatch` includes `path`, `line_number`, `line_text`, and `match_ranges` for highlighting.
- Debounce in the frontend hook, not the backend.
- Reuse the command palette's fuzzy-match highlighting style for consistency.
- Share the existing workspace ignore matcher so the file index and content search apply the same filter.

## Files Expected To Change

- `apps/desktop/src-tauri/Cargo.toml` (add `grep` / `grep-searcher` / `grep-matcher`)
- `apps/desktop/src-tauri/src/commands/search.rs`
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src/components/content-search-palette.tsx` (new)
- `apps/desktop/src/hooks/use-content-search.ts` (new)
- `apps/desktop/src/hooks/use-keyboard-shortcuts.ts`
- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts` (line-jump + brief highlight)
- frontend and Rust tests

## Acceptance Criteria

- `Cmd+Shift+F` opens a content search palette that searches across every markdown file in the workspace.
- Typing a query returns ranked results with inline snippets and highlighted matches.
- A `/query` prefix switches to literal grep mode.
- Clicking a result opens the file in the current tab and scrolls to the matched line with a brief highlight.
- Search honors the workspace's `.gitignore` filter.
- Performance remains responsive (< ~250ms to first results) on workspaces with up to a few thousand markdown files.
