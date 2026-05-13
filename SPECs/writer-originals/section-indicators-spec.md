# Section Indicators Spec

## Summary

Show small markers along the left edge of the editor that represent the document's headings, so the user has a lightweight outline view without opening a full table-of-contents panel.

## Goals

- Visually represent each top-level heading as a marker on the left rail.
- Highlight the marker corresponding to the heading currently in view.
- Let the user click a marker to scroll directly to that heading.
- Stay unobtrusive — no panel, no labels by default.

## Non-Goals

- A full outline pane.
- Folding headings from the rail.
- Showing markers for sub-subheadings beyond a configurable depth in v1.

## UX Decisions

### Visual

- A thin column on the left edge of the editor body (between the body and the sidebar boundary).
- One short horizontal tick per heading. Ticks are slightly indented for `H2`, more for `H3`, etc.
- The tick of the heading currently nearest the top of the viewport is brightened.
- Hovering a tick reveals the heading text in a small floating label.

### Interaction

- Clicking a tick scrolls the corresponding heading into view (smooth).
- Right-clicking opens a tiny menu with `Copy heading link`.

### Depth limit

- Default: H1-H3.
- Configurable in settings if/when settings ships.

## Implementation Notes

- Compute headings from the ProseMirror doc; subscribe to doc changes via the editor store.
- Compute the active heading via a scroll subscription that finds the heading whose top is closest to but above the viewport top.
- Use `IntersectionObserver` for performance instead of polling scroll.
- Render the rail as a sibling of the editor scroll container so it can pin to the viewport edge.

## Files Expected To Change

- `apps/desktop/src/components/editor-area/`
- new `apps/desktop/src/components/editor-area/section-rail.tsx`
- `apps/desktop/src/hooks/use-document-headings.ts` (new)
- frontend tests under `apps/desktop/tests/`

## Acceptance Criteria

- A vertical rail of heading markers appears on the left edge of the editor body.
- The marker for the currently visible heading is highlighted.
- Hovering shows the heading text; clicking jumps to that heading.
- The rail respects the configured depth limit.
