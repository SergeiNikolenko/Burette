# Heading Anchor Links Spec

## Summary

Support `#anchor` links in markdown so users can link to specific headings inside the same document or another workspace document. Today, only file-path links navigate.

## Goals

- Resolve `#heading-slug` and `path/to/file.md#heading-slug` to a heading inside the target document.
- Scroll the target heading into view on click.
- Generate stable, GitHub-style heading slugs deterministically.
- Reuse the existing in-app navigation pipeline and per-tab history.
- Combine cleanly with the wiki-link spec's planned `[[Doc#Heading]]` syntax.

## Non-Goals

- Block (`^block-id`) links — handled separately.
- Cross-workspace anchors.
- Editing the rendered document outline UI in this spec.

## Slug Rules

Match GitHub Flavored Markdown's slugger:

- lowercase
- replace spaces with `-`
- strip punctuation that is not `-` or alphanumeric
- if multiple headings collide on the same slug, append `-2`, `-3`, … in document order

Slug computation must be a pure function so it can be tested in isolation.

## Resolution Rules

- `#slug` resolves against the current document.
- `path.md#slug` resolves against the target file using the same path resolution as plain markdown links.
- Unresolved anchors should still navigate to the file (when present) and scroll to the top, surfacing a small inline warning rather than failing silently.

## Click Behavior

- Same-document anchor click: smooth scroll to the heading, do not push a new history entry but do leave a returnable focus point.
- Cross-document anchor click: open/activate the file in the current tab, then scroll to the heading. Push the navigation onto the per-tab history.

## Editor And Renderer Changes

- Add a heading slug index built from the current ProseMirror document so click handlers can resolve `#slug` quickly.
- Augment the existing markdown link click handler to detect `#fragment` parts and route through the anchor pipeline.

## Files Expected To Change

- `apps/desktop/src/components/editor-area/use-prosemark-editor.ts`
- `apps/desktop/src/lib/heading-slug.ts` (new, pure module)
- `apps/desktop/src/lib/links.ts` or wherever markdown link resolution lives
- `apps/desktop/src/stores/editor-store.ts` (history handling)
- frontend tests under `apps/desktop/tests/`

## Acceptance Criteria

- Clicking `[See setup](#setup)` scrolls the current document to the `Setup` heading.
- Clicking `[Roadmap](planning/roadmap.md#q3)` opens that file in the current tab and scrolls to `Q3`.
- Heading slug generation matches GFM rules including duplicate handling.
- Unresolved anchors fall back gracefully and surface a clear warning.
