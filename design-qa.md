# File chrome alignment — 2026-09-23

final result: blocked

## Evidence

- Source: `/Users/nikolenko/Library/Application Support/CleanShot/media/media_6WGcJ3tJH3/ScreenShot 2026-09-23 at 17.33.57@2x.png` (1680 × 766, @2x; equivalent 840 × 383 CSS).
- Implementation: `/tmp/burette-file-header-qa/light.png` (840 × 383 rendered pixels; viewport 840 × 383 CSS; browser DPR 2, screenshot API normalizes output). Dark state: `/tmp/burette-file-header-qa/dark.png`.
- These images were opened in the same comparison call. Only the file header and open menu are comparable: the test fixture intentionally has no molecular renderer and uses two test menu entries. No claim of whole-screen or native-host parity.
- Browser: in-app, private local fixture. Console error list empty. React/DOM integration exercises filename replacement, Reveal, default Open and menu item invocation; 14 related routing, placement and toolbar tests also pass.

## Findings

- P1: Native acceptance pending. Installed 0.2.21, but new session `dc89eac2-d682-4507-9d7d-c13a9014a721` reports awaiting_mount. Installation is not a successful visible pane.
- P1: Host-owned tab title remains outside this header; current implementation does not rename it. Source heading is not a substitute.
- P1: Previous Story session reports first-frame timeout. The header change does not fix that renderer failure or establish smooth first-frame appearance.
- P2: Full molecular toolbar, rail and menu parity is unverified in the installed host. Shared native CSS aligns radii, neutral surfaces and 16px icon footprints; filled icon geometry was not thinned.
- P2: Exact source component reuse from Codex is unavailable here. The header uses existing Burette actions and shared reviewed SDK glyphs. Save As and View source were not added without supported handlers.

## Fidelity review and iterations

- Typography: system UI, 14px regular actions, medium filename; reference is a system UI header. Menu's existing app typography is retained. Exact optical parity remains unconfirmed.
- Spacing: 44px file row, 30px buttons, 16px menu radius; breadcrumbs truncate without pushing actions. Reference @2x header is approximately 42 CSS px. Native responsive acceptance remains pending.
- Tokens: neutral light/dark backgrounds, subtle divider and hover; molecular colors untouched by chrome CSS.
- Assets: reviewed shared glyphs, real app icon hook for production. Fixture deliberately supplies no app icons; native icon appearance unverified.
- Copy: filename + parent, Open, application menu and Open in folder. Actions are functional, not a mock OS menu; test fixture labels are not production application discovery.
- Iteration 1: open-menu tooltip remained visible behind the dropdown and border was absent. Fixed expanded-trigger tooltip suppression and explicit theme border.
- Iteration 2: light and dark browser captures show a bordered rounded menu without the overlapping tooltip. Remaining P1/P2 findings above prevent a passed result.

## Remaining acceptance

Verify the mounted native header and real app icons; resolve Story first-frame timeout; establish supported host tab naming/opening; then compare the complete molecular controls to the supplied references. Do not ask for native UI access that the user already declined.

---
## Earlier scoped inline-viewer report (retained, not current native acceptance)

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
