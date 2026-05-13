# Inline Media Preview Spec

## Summary

When a markdown link in the document points to a local PNG, JPG, GIF, or PDF, render a small inline thumbnail next to the link. Clicking the thumbnail opens the file in a modal preview.

## Goals

- Detect local image and PDF link targets in the editor.
- Render a small inline thumbnail next to the link without disrupting text flow.
- Open a modal preview on click.
- Keep performance acceptable for documents with many such links.

## Non-Goals

- Replacing the link with a full-size embed (use Obsidian-style `![[...]]` syntax for that — see `obsidian-image-embed-spec.md`).
- Editing media in the modal.
- Remote URL thumbnails.

## Detection Rules

A link qualifies for a thumbnail if all of:

- the target resolves to an existing local file
- the file extension is `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, or `.pdf`
- the target is inside the workspace (or, optionally, accessible via Tauri filesystem permissions)

## UX Decisions

- Thumbnail is ~16-20px tall, rendered to the right of the link text with a small horizontal margin.
- Thumbnails are square-cropped for images and use the first page for PDFs.
- The thumbnail is itself clickable; clicking opens the modal.
- The modal supports zoom, pan (for images), and basic navigation (next/prev page for PDFs).
- `Esc` closes the modal.

## Implementation Notes

- Add a small Rust command that returns a base64-encoded thumbnail for a given local path. Cache thumbnails by `path + mtime`.
- For PDFs, use `pdfium-render` or a minimal PDF crate to render the first page. If no acceptable crate is available, fall back to a generic PDF icon.
- The editor extension responsible for rendering links should add a decoration containing the thumbnail.
- Use intersection observers to defer thumbnail loading for off-screen links.

## Files Expected To Change

- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/src/commands/images.rs`
- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts`
- new `apps/desktop/src/components/inline-thumbnail.tsx`
- new `apps/desktop/src/components/media-modal.tsx`
- frontend and Rust tests

## Acceptance Criteria

- Markdown links pointing to local images and PDFs render a small thumbnail beside the link text.
- Clicking the thumbnail opens a modal preview.
- Performance does not degrade noticeably on documents with dozens of such links.
- Non-image / non-PDF links remain unchanged.
