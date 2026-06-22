# Design Direction

This document records Burrete's current design direction and the implementation
constraints that should guide future UI work. It is not a generated token file.
The source of truth for runtime theme defaults is:

- `apps/desktop/src/stores/settings-store.ts`
- `apps/desktop/src/lib/theme.ts`
- `apps/desktop/src/styles.css`

## Current Reality

Burrete's desktop shell is a compact, translucent macOS-style workspace. It uses
system fonts, configurable light/dark theme settings, a single default accent,
low-contrast surfaces, and dense file-oriented controls.

Current default theme values include:

| Token | Light | Dark |
| --- | --- | --- |
| Accent | `#AF52DE` | `#AF52DE` |
| Background | `#FFFFFF` | `#111111` |
| Foreground | `#0D0D0D` | `#FCFCFC` |
| UI font | system UI stack | system UI stack |
| Editor font | system UI stack | system UI stack |
| Translucency | `30` | `20` |
| Contrast | `20` | `16` |

The runtime derives border, surface, hover, selected, palette, tab, and scrollbar
colors from these settings through CSS variables and `color-mix()`. Users can
edit accent, background, foreground, font, translucency, and contrast in
settings, so design guidance should describe behavior and hierarchy rather than
hard-code a parallel token registry.

## North Star

**Native lab utility.** Burrete should feel like a focused macOS tool for
molecular inspection: compact, quiet, recoverable, and oriented around files.
The shell is a workspace, not a brand canvas.

## Surface Rules

- The molecular preview, collection, text artifact, or workflow panel stays the
  primary visual object.
- Chrome should remain compact and predictable: sidebar, tab strip, command
  palette, settings, docks, and maintenance surfaces should share the same
  vocabulary.
- Translucency and blur are allowed because the current shell uses them, but they
  must serve native integration and hierarchy. Do not add decorative glass
  panels, gradient blobs, or purely atmospheric effects.
- Default UI should stay readable at 13px shell scale and use system fonts.
- Icon-only controls need accessible names and visible focus/hover states.
- Active tab, row, or selection state should not rely on color alone; use fill,
  border, inset, or another structural cue.
- Browser-dev, desktop app, Finder Quick Look, and iPhone app may diverge where
  their platform constraints differ, but the decision should be explicit.

## Component Guidance

### Buttons And Icon Controls

- Use compact controls with stable dimensions.
- Use familiar icons for common actions when available.
- Reserve filled accent treatment for primary or high-intent actions.
- Hover and focus should clarify interactivity without shifting layout.

### Sidebar And Search

- The sidebar is a file/project navigation tool, not a marketing navigation
  rail.
- Project folders, recent files, nested structures, and search should stay dense
  enough for repeated technical use.
- Search should filter or route clearly; do not make it look like an unrelated
  command entrypoint unless it invokes the command palette.

### Tabs And Workspace

- Tabs preserve renderer state where the runtime supports it.
- Close, pin, split, and dock controls should be reachable by keyboard and
  discoverable on hover/focus.
- Empty states should offer the next useful file action, not generic product
  copy.

### Settings And Maintenance

- Settings groups should remain scannable rows with clear labels, descriptions,
  controls, and reset affordances.
- Maintenance actions such as Quick Look reset, logs, diagnostics, cache cleanup,
  and update checks are part of the product, not hidden admin tools.
- Settings should expose real runtime preferences. Avoid controls that do not map
  to current behavior.

### Molecular And Workflow Panels

- Viewer controls should stay close to the active preview or panel.
- Collection grids, FEP previews, pose review, Ketcher, and text panels should
  expose domain actions without turning the shell into a broad dashboard.
- Reports and agent-rendered panels should stay bounded, reviewable, and clear
  about source files or workflow artifacts.

### iPhone App

- The iPhone app is source-built and phone-first. It should not inherit desktop
  sidebars, persistent tool rails, or dense desktop panels without adaptation.
- Prefer full-screen preview, bottom-oriented controls, document handoff clarity,
  and Apple-platform interaction patterns.

## Do

- Keep the shell subordinate to molecular content.
- Use system typography and stable compact spacing.
- Make focus, hover, active, disabled, and error states explicit.
- Keep Quick Look recovery, renderer switching, and install health visible.
- Verify UI claims on the intended surface before documenting them.

## Do Not

- Describe a color, component, or layout rule that is not implemented or planned.
- Add decorative blur, gradients, glass panels, or oversized cards just for
  atmosphere.
- Use a single accent as the whole visual language.
- Hide critical file, renderer, or maintenance actions behind vague labels.
- Treat screenshots as the source of truth when typed runtime state exists.
