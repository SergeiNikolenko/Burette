# Local inline viewer design QA

final result: passed

Scope: OpenAI Design Reference visual-system adoption for the local molecular
MCP App prototype, not a pixel clone of the pizza examples and not native Codex
host acceptance. The existing shadcn `Button` is the registry component used.

## Evidence and comparison

- Source visual truth: `/Users/nikolenko/.agents/skills/artifact-template-openai-design-reference/assets/design-reference/guides/images/inline_card_layout.png`.
- Implementation screenshot: `/Users/nikolenko/.codex/visualizations/2026/08/27/01a0449b-6db1-7f21-9c56-3fd4fe2ada9e/burette-inline/inline-focused.png`.
- Source board: 3350 × 1334 pixels; illustrative multi-card board, not a CSS viewport.
- Implementation: 756 × 994 pixels, Browser capture at the current visible viewport;
  approximately 720 × 520 CSS pixels for the embedded card. No image resampling.
  Compare visual hierarchy and tokens, not absolute pixel sizes across the board.
- Both images were opened in the same comparison input. The readable header,
  secondary text and expand control provide the focused-region comparison;
  no separate crop was necessary. The surrounding serif test-host heading and
  iframe border are fixture chrome, not the product UI.
- State: light theme, local 1HTB structure, NAD A377 focused, inline after an
  expand/return roundtrip. Exact camera position, target, up vector and radius
  were unchanged; the same selected ligand remained visibly highlighted.

## Findings

No actionable P0/P1/P2 differences within this scoped system adoption.

- Typography: system sans stack, medium 14/20 title, 12/20 secondary summary;
  compact app-specific hierarchy instead of scaling the illustrative board text.
- Spacing/layout: 16px horizontal and 12px vertical header spacing; one expand
  action and remaining space dedicated to the live scene. Expanded mode restores
  existing scene controls. Host-owned card framing is intentionally not duplicated.
- Colors/tokens: exact neutral foreground/background/secondary values from the
  retained Apps SDK UI source, restrained divider, no added product accent chrome.
- Image/assets: real Mol* WebGL structure and actual supplied Expand icon, not
  mock molecular imagery or an approximate hand-drawn replacement.
- Copy: real filename and measured atom/residue counts; accessible Expand viewer
  and Return to conversation labels. No source pizza content or prompt leakage.

## Comparison history and checks

First combined visual comparison passed; no visual fix iteration was required.
The earlier strict-CSP and server-registration fixes were runtime troubleshooting,
not design-QA iterations. Typed live checks confirmed readiness, NAD A377 selection
(44 atoms), unchanged camera across inline/fullscreen/inline, and a nonexistent
ligand failure without a revision increment.

## Remaining acceptance gates

- Native Codex mounting and host side-pane behavior require the newly installed
  tools in a new task; Browser protocol-fixture success does not prove that gate.
- Dark host context, narrow mobile-sized host frames, remount restoration and
  direct native-file-viewer registration are not covered by this preview.
- The Browser tool does not expose a console API; startup errors are reported by
  the app and typed heartbeat confirmed the renderer was ready.
