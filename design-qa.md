# Grid Minimap Design QA

final result: passed

## Scope

- Reference component: https://www.vivid-layer.com/components/chat-minimap
- Reference source: https://github.com/lawsonhan/vivid-layer/blob/main/components/ui/chat-minimap.tsx
- Latest user feedback crop: `/Users/nikolenko/Library/Application Support/CleanShot/media/media_B8xySgwJZJ/ScreenShot 2026-08-20 at 14.24.58@2x.png`
- Implementation: `PreviewExtension/Web/grid-viewer.js`, `PreviewExtension/Web/grid.css`
- Packaged runtime mirror: `plugins/burette-agent/preview-web/grid-viewer.js`, `plugins/burette-agent/preview-web/grid.css`

## Visual comparison

- Viewport: 1280 x 720 CSS pixels, device scale factor 1, light theme.
- State: middle minimap marker hovered, cosine lens expanded, popover visible.
- Reference screenshot: `/Users/nikolenko/.codex/visualizations/2026/08/20/01a01ed4-a43e-7b70-a96a-b4d151d96582/vivid-chat-minimap-source-hover.png`
- Implementation screenshot: `/Users/nikolenko/.codex/visualizations/2026/08/20/01a01ed4-a43e-7b70-a96a-b4d151d96582/grid-minimap-final.png`
- Side-by-side comparison: `/Users/nikolenko/.codex/visualizations/2026/08/20/01a01ed4-a43e-7b70-a96a-b4d151d96582/grid-minimap-comparison.png`
- Latest full implementation capture: `/Users/nikolenko/.codex/visualizations/2026/08/20/01a01ed4-a43e-7b70-a96a-b4d151d96582/grid-minimap-hover-reset-full.png`
- Latest focused implementation crop: `/Users/nikolenko/.codex/visualizations/2026/08/20/01a01ed4-a43e-7b70-a96a-b4d151d96582/grid-minimap-hover-reset-focused@2x.png`
- Latest focused comparison: `/Users/nikolenko/.codex/visualizations/2026/08/20/01a01ed4-a43e-7b70-a96a-b4d151d96582/grid-minimap-hover-reset-comparison.png`

The latest user crop is 104 x 56 pixels at 2x density, representing a 52 x 28 CSS-pixel region. The implementation was captured at device scale factor 1, cropped to the same 52 x 28 CSS-pixel region, and normalized to 104 x 56 pixels for the focused comparison.

The implementation matches the reference component's 2 px pills, 12 px resting width, 36 px cosine-lens peak, foreground current marker, and adjacent hover card. The Grid-specific 10 px vertical step is intentionally denser than the reference after user feedback. The tick layer sits above the popover shadow and the popover begins 12 px after the fully expanded pill, so the right edge remains unobstructed.

Typography, surface colors, borders, radii, and shadows use the existing Burette grid tokens. The popover hierarchy matches the reference: molecule name first, muted position second. No image or icon assets are involved.

## Interaction and runtime checks

- Hover expands the target and neighboring markers and shows the matching molecule preview.
- Click scrolls to the sampled molecule and updates exactly one `aria-current="location"` marker.
- Drag moved the document to scroll position 56,835.5; a subsequent click moved it to 60,850.5.
- Browser console after hover, drag, and click: 0 errors.
- Latest hover computed style: transparent background, no box shadow, no transform; browser console: 0 errors.
- `bun tests/test-ui-shell-contract.mjs`: passed.
- `bun tests/test-grid-paging-contract.mjs`: passed.
- `bun tests/test-grid-runtime-lifecycle-contract.mjs`: passed.
- `bun scripts/check-js-syntax.mjs PreviewExtension/Web/grid-viewer.js`: passed.
- `bun tests/test-packaged-plugin-mirror.mjs`: passed after regenerating the packaged preview runtime.

## Issues resolved

- P1: removed a stale drag-handler reference found only in live interaction testing.
- P2: prevented the popover shadow/focus surface from obscuring the expanded pill.
- P2: reduced the marker step from 12 px to 10 px for the requested denser rhythm.
- P2 follow-up: the generic `button:not(:disabled):hover` selector still painted a gray control surface because it outranked the initial rail reset. The final selector targets enabled rail buttons with equal-or-greater specificity; the post-fix focused comparison shows the pill with no surrounding surface.
- P1 interaction follow-up: after a drag left the rail and returned before pointer release, `pointerup` cleared the lens and popover even though the pointer still matched `:hover`. A release outside the Grid iframe could also be lost entirely, leaving drag mode active. The end handler now restores inside hover, listens for same-origin parent release, blur, boundary exit, and lost pointer capture, and clears drag state on every cancellation path.

## Drag-return regression evidence

- Reproduction: drag from the middle marker above the rail, leave the Grid iframe, return to the same marker, and release.
- Pre-fix state: one marker still matched `:hover`, but all pills reset to 12 px and the popover was hidden until another pointer movement.
- Post-fix state: five consecutive leave-and-return cycles cleared drag mode, kept the popover visible, and retained five expanded cosine markers without requiring another movement. Releasing outside cleared drag mode and hover state; returning immediately restored five expanded markers.
- Browser capture: `/Users/nikolenko/.codex/visualizations/2026/08/20/01a01ed4-a43e-7b70-a96a-b4d151d96582/grid-minimap-drag-return-stress-fixed.png`
- Browser console: 0 errors.
- Testing-system audit: the earlier contract covered click, pointer wiring, and lens math but not pointer-end state across the iframe boundary or virtual rerenders. The contract now requires inside-release restoration, parent/boundary/lost-capture cancellation, and preservation of the active lens during rail rerender.
