# Tags Spec

## Summary

Add lightweight tag support: users can write `#tag` inside markdown documents and Writer will index, render, and let them browse documents by tag.

## Goals

- Recognize `#tag` tokens in markdown body text.
- Index tags per document for fast lookup.
- Render tags as styled chips in the editor.
- Provide a tag browser (sidebar section or dedicated view) listing all tags and their documents.
- Support clicking a tag to filter the workspace by it.

## Non-Goals

- Hierarchical tags (`#parent/child`) in v1.
- Tag autocomplete inside the editor in v1 (follow-up).
- Renaming tags across the workspace in v1.

## Tag Recognition Rules

A tag is `#` followed by 1+ characters from `[A-Za-z0-9_-]`.

Tags do not match when:

- inside fenced code blocks
- inside inline code spans
- inside frontmatter
- as part of a URL fragment (e.g., `https://...#section`)
- preceded by an alphanumeric character (so hex colors, headings markdown, and word-internal `#` do not match)

## Indexing

- Index tags per file in the existing workspace index.
- Recompute on file save and on watcher updates.
- Expose a Rust command `list_tags() -> Map<tag, file_paths[]>`.

## UX Decisions

### Editor

- Tags render as small chips with a subtle background.
- Clicking a tag opens the tag browser filtered to that tag.

### Browser

- A sidebar section labeled `Tags` lists every tag with a document count.
- Selecting a tag opens a results pane (or filters the file tree) showing matching documents.

## Implementation Notes

- Add a Rust `tags.rs` module with parsing helpers and an index.
- Reuse the existing markdown parser when possible to skip code/frontmatter regions.
- Frontend ProseMirror plugin renders the inline tag chip decoration.
- Add `useTagIndex()` hook for the browser.

## Files Expected To Change

- `apps/desktop/src-tauri/src/tags.rs` (new)
- `apps/desktop/src-tauri/src/state.rs`
- `apps/desktop/src-tauri/src/commands/`
- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts`
- new `apps/desktop/src/components/tag-browser.tsx`
- new `apps/desktop/src/hooks/use-tag-index.ts`
- frontend and Rust tests

## Acceptance Criteria

- Writing `#draft` in a document renders as a styled tag chip.
- The Tags browser lists every tag in the workspace with the documents that contain it.
- Clicking a tag in the editor opens the browser filtered to that tag.
- Tags inside code blocks and frontmatter are ignored.
