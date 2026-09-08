# Design Direction

This document records Burette's current design direction and the implementation
constraints that should guide future UI work. It is not a generated token file.
The source of truth for runtime theme defaults is:

- `apps/desktop/src/stores/settings-store.ts`
- `apps/desktop/src/lib/theme.ts`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/styles/interface-tokens.css`

## Current Reality

Burette's desktop shell is a compact, translucent macOS-style workspace. It uses
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

**Native lab utility.** Burette should feel like a focused macOS tool for
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
- Primary actions use a neutral inverse fill, with separate hover and pressed tones.
- Keep the configurable accent separate from primary actions and readiness status.
  Ready/installed states are neutral; success and failure use semantic status colors.
- Hover and focus should clarify interactivity without shifting layout.

### Shared Icon Geometry

- Common commands use the reviewed Apps SDK UI 0.2.2 geometry stored in
  `config/icons/apps-sdk.json`, under the adjacent MIT license. React components
  import `components/ui/app-icons`; controls using the existing Hugeicons SVG
  renderer import `components/ui/app-icon-data`.
- `node scripts/sync-app-icons.mjs` regenerates the React data/exports and the
  inline preview data, and mirrors `viewer.js` into the packaged plugin. Update
  the reviewed snapshot before regenerating; do not edit generated glyph data.
- Existing animation classes, interaction state, labels, dimensions and focus
  behavior belong to the control and survive an icon replacement. Filled SDK
  paths retain their original geometry regardless of a caller's stroke width.
- Protein, molecule, trajectory, topology, spectrum, sequence, precise
  measurements, focus and isolation keep their scientific glyphs. The Ketcher
  Orbit retains its hover animation. Finder and external-editor logos remain
  application identities.
- Web menu specs may name a shared `icon`; application `iconUrl` takes priority.
  Native AppKit menus keep their native rendering and do not consume this web
  glyph field. Mol* context menus use the shared inline geometry directly.
- New icons decorate existing actions (run history, active filters, snapshot,
  unpin, source path, elapsed time, copy confirmation). They do not create new
  commands or change scientific workflows.

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
- The right (Inspector) and bottom docks start hidden by default
  (`apps/desktop/src/stores/shell-store.ts`); features must not assume a dock
  is visible.
- The Inspector presents document information as one scrollable section list
  (`apps/desktop/src/components/structure-info-panel.tsx`), not as nested
  tabbed panels.

### Status And Notifications

- Transient status messages use the Base UI toast layer
  (`apps/desktop/src/components/ui/toast.tsx`): notices stack and auto-dismiss,
  errors persist until dismissed, and long details open in a standalone dialog
  (`apps/desktop/src/components/status-details-dialog.tsx`).
- Do not reintroduce blocking status popups for routine progress.

### Settings And Maintenance

- Settings groups should remain scannable rows with clear labels, descriptions,
  controls, and reset affordances.
- Maintenance actions such as Quick Look reset, logs, diagnostics, cache cleanup,
  and update checks are part of the product, not hidden admin tools.
- Settings should expose real runtime preferences. Avoid controls that do not map
  to current behavior.
- Theme choices support hover preview: hovering a theme option previews it live
  in the viewer before committing.

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

### Interface Typography And Palette

The shell and document controls share the shell's semantic theme palette.
`styles/interface-tokens.css` defines 20/26 headings at weight 600, 14/20 body
labels, and 12/18 supporting text. Buttons use weight 500. Scientific tables
keep their compact scale. Secondary text is mixed against the configured
background rather than made translucent, so it remains distinct from disabled
text. Theme preferences still own background, foreground, fonts and accent.

Inspector disclosures use the installed shadcn `radix-nova` `Accordion` components.
Calculation engines compose `ItemGroup`, outlined `Item` rows, `ItemContent`,
`ItemTitle`, `ItemDescription`, and `ItemActions`. Smoothing and inline engine
option sets use `ToggleGroup` with its outline variant. Keep component variants
responsible for borders, type, selection, and focus; use local classes for layout.
Accordion content uses natural height within the inspector's scrolling dock.
The shared OpenAI glyphs do not make these components Apps SDK UI components;
the shell retains its shadcn base and Burette theme.

The sidebar magnifier opens the same Command palette as Command-P. The palette
uses compact single-line rows: structure names with project labels and numbered
shortcuts, followed by quick actions. Descriptions remain searchable and are
available on hover. Its plain input variant removes the nested input border;
the dialog and list retain semantic light/dark theme colors.

Command-F and native Edit → Find search the focused text viewer, falling back
to the visible text dock. CodeMirror searches the loaded document, including
virtualized lines, with a shadcn input, match count, and previous/next controls.
Enter and Shift-Enter move between matches; Command-F toggles the search panel
and Escape closes it. Read-only
structure text remains searchable and copyable. Files with multiple structures
keep Edit Source disabled with an explanatory tooltip.

Sidebar search, pin, and settings controls show compact shadcn tooltips above
the control on hover and keyboard focus. Folder rows and the Projects header
do not show tooltips. Folder, Ketcher, and search glyphs use the primary text
color at rest in the light theme.
Light-theme shell and neutral button glyphs use the primary text color on hover
and keyboard focus while preserving their resting color and geometry.
