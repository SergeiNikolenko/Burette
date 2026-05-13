# Obsidian Image Embed Spec

## Summary

Support Obsidian's `![[filename.ext]]` wiki-style embed syntax for inline images. The `[[]]` is a wiki-link, the `!` prefix turns it into an embed, and the editor should render the image inline rather than as a link.

## Goals

- Parse `![[file.png]]`, `![[folder/file.jpg]]`, and similar forms.
- Resolve the target like a wiki-link target (workspace-relative, basename match).
- Render the image inline.
- Keep the source text editable round-trip; no markdown conversion on save.
- Support common image formats: PNG, JPG, JPEG, GIF, WEBP, SVG.

## Non-Goals

- PDF or other file embeds in this spec (covered by `inline-media-preview-spec.md`).
- Aliasing (`![[file|alt]]`).
- Sizing modifiers (`![[file|400]]`) in v1.
- Editing the image inline.

## Resolution Rules

Reuse the existing wiki-link resolver (already shipped for `[[Doc]]` navigation):

- Strip outer `![[ ]]`.
- Normalize slashes.
- If the target contains `/`, treat as workspace-relative path.
- Otherwise resolve the basename against the workspace media index.
- The basename match is case-insensitive.

## UX Decisions

- Inline embeds render at natural width up to the body content width.
- A small gap separates the image from surrounding text.
- Right-clicking opens the editor context menu (which already provides "Reveal in Finder" via the editor context menu spec).
- Unresolved embeds render as a small inline placeholder showing the original `![[...]]` text.

## Editor Integration

- Add a ProseMirror node (or decoration) for `obsidian-embed`.
- The parser must recognize `![[...]]` only outside code spans, code blocks, and frontmatter.
- The serializer round-trips back to the same `![[...]]` text on save.

## Files Expected To Change

- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts`
- shared wiki-link resolver (`apps/desktop/src/lib/wiki-links.ts` from the wiki-link spec)
- a new ProseMirror schema node and parser/serializer pair
- frontend tests

## Acceptance Criteria

- Typing `![[diagram.png]]` in a document renders the image inline.
- Round-tripping the document through save and reload preserves the original `![[...]]` text.
- Unresolved embeds render a placeholder, not an empty box.
- Embeds inside code blocks are not rendered.
