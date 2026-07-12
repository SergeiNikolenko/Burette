# Smooth Motion Redesign QA

- Source visual truth: `/var/folders/t3/nwtqy3391q3_vt1f8s3sl4r00000gn/T/codex-clipboard-39859662-2c47-4ef8-b466-7d6b84c8ceed.png`, supplemented by the user's explicit interaction and layout specification from 2026-07-12.
- Implementation screenshot: `/Users/nikolenko/.codex/visualizations/2026/07/12/019f55c2-c17e-7351-b94b-f640b4dc0fc6/smoothing-redesign/design-qa-smoothing-implementation.png`
- Focused DeepTICA screenshot: `/Users/nikolenko/.codex/visualizations/2026/07/12/019f55c2-c17e-7351-b94b-f640b4dc0fc6/smoothing-redesign/design-qa-smoothing-deeptica.png`
- Side-by-side comparison: `/Users/nikolenko/.codex/visualizations/2026/07/12/019f55c2-c17e-7351-b94b-f640b4dc0fc6/smoothing-redesign/design-qa-smoothing-comparison.png`
- Viewport: 865 x 964, light theme.
- State: benzene XYZ trajectory; Smooth motion enabled for the full comparison, Scientific settings expanded; DeepTICA selected before first enable for the focused runtime check.

## Full-view comparison evidence

The original block led with explanatory copy and nested controls. The implementation now follows the specified path: On/Off, strength, one factual source-frame line, one accordion, a single scientific surface, then plots. The external card remains consistent with the existing inspector design system.

## Focused region evidence

The DeepTICA capture verifies the compact method note, aligned numeric inputs, accented checkbox, inline runtime status, and first-run Enable smoothing action. A focused view was necessary because those controls are below the compact header and cannot be read reliably in the full-view comparison.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: existing system font, weights, line heights, and small-label hierarchy are preserved; no clipped or unintended wrapped control text was observed.
- Spacing and layout rhythm: the compact path is materially shorter, segments are equal width, scientific rows share one grid, and nested explanation cards were removed.
- Colors and visual tokens: active states use the existing purple accent as a fill rather than border-only selection; Ready uses the existing success treatment.
- Image quality and asset fidelity: no new raster or custom icon assets were introduced; the molecular viewport remains unchanged.
- Copy and content: On/Off, concise playback explanation, factual preset summary, Signal, Target frames, Align structures before analysis, runtime state, and Enable smoothing match the requested terminology.

## Primary interactions tested

- Expanded and collapsed Scientific settings.
- Selected DeepTICA before first enable without starting training.
- Verified automatic runtime capability resolution to `Ready ✓`.
- Verified no browser console errors.

## Comparison history

- Initial target issue: duplicated Original/Smoothed control, verbose descriptions, nested explanation cards, ambiguous Hide affordance, wide numeric fields, and oversized runtime/apply actions.
- Fixes made: introduced On/Off, compact preset result line, true accordion, grouped Method/Sampling grid, inline notes and runtime state, constrained field widths, automatic update status, and first-run-only Enable smoothing.
- Post-fix evidence: implementation and DeepTICA screenshots listed above. No P0/P1/P2 findings remained after comparison.

## Follow-up polish

No blocking polish remains. A future pass could animate the accordion height, but it is not required for clarity or fidelity.

final result: passed
