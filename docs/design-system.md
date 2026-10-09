# Design Direction

This document records Burette's current design direction and the implementation
constraints that should guide future UI work. It is not a generated token file.
The source of truth for runtime theme defaults is:

- `apps/desktop/src/stores/settings-store.ts`
- `apps/desktop/src/lib/theme.ts`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/styles/interface-tokens.css`
- `apps/desktop/src/lib/codex-theme.ts`
- `apps/desktop/src/styles/codex-tokens.css`

## Current Reality

The desktop shell follows the Codex InterfaceAtlas tokens and primitives while
retaining Tauri and the molecular workspace. It uses system fonts, configurable
light/dark appearance, neutral controls, and dense file-oriented navigation.

Resolved shell defaults (including untouched legacy appearance settings):

| Token | Light | Dark |
| --- | --- | --- |
| Accent | `#339CFF` | `#339CFF` |
| Background | `#FFFFFF` | `#181818` |
| Foreground | `#1A1C1F` | `#FFFFFF` |
| UI font | system UI stack | system UI stack |
| Editor font | system UI stack | system UI stack |
| Translucency | `30` | `20` |
| Contrast | `45` | `60` |

Primary shell text uses the resolved foreground; secondary and tertiary text
use the shared Codex semantic tokens. Persisted legacy defaults remain readable
and resolve through `theme.ts`; custom colours are preserved.

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

- Preserve the classic Codex shell: its background and edge-to-edge sidebar.
  Component migration does not authorize the newer navigation rail, inset
  panels, or a different sidebar treatment.
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
- `Annotate` follows the Codex annotation glyph: three rounded frame corners
  drawn for Burette plus the Apps SDK `Cursor` path scaled by 0.62 and offset by
  10.3 into the open corner.
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

### Shell Menus

- Shell button hints use the shared Tooltip's `floating` variant, matching
  Atlas `FloatingTooltip` (`overlays/floating-tooltip-shortcut`): 13/18 text,
  5px/12px padding, semantic tooltip surface/border/shadow and a 2px offset.
  `ShortcutTooltip` wraps its button rather than placing an absolutely
  positioned span inside it; themed portals prevent pane overflow clipping.
  The SDK default and compact tooltip variants remain separate.

- Dropdown and context flyouts use the Atlas default menu surface and spacing:
  4px gutter, 1px margin, 5px/8px row padding, and 6px collision inset.
  Submenus portal into the shell rather than the parent's scrolling content.
- Checkbox rows stay open by default, like Atlas `Menu.CheckboxItem`.
  Use `closeOnSelect` for one-shot commands: `MenuItemSpec` snapshots and the
  Ketcher editor-mode switch close before their surrounding UI is refreshed.
- Keep keyboard selection, disabled-item skipping, parent focus restoration and
  portal placement covered in `tests/test-overlay-interactions.test.tsx`.

### Viewer Menus on macOS

Browser Grid select popups reuse the generated Atlas Select menu CSS and
`SelectOptionContent`, not a separate CSS approximation. The standalone Grid
bundle embeds those styles and the shared theme tokens; `grid-atlas-styles.ts`
maps their scope to `data-buret-theme` and derives both palettes through
`buildCodexThemeVariables`. The underlying select remains the runtime's value,
options and change-event contract. App/Quick Look retain their native select
route. `test-grid-selection-toolbar.mjs` covers browser selection, disabled
options, Escape/focus return, nested choices and the native-route guards;
these guards are not packaged native acceptance.

Scene and Composition object menus, viewport rail menus (camera, screenshot,
animation and selection), Style/Appearance, Compute, Grid Actions and column
context menus use the shared AppKit popup in the desktop app. The DOM controls
remain their command model through `native-viewer-menus.js`; changes still use
the existing scoped scene operations and undo handlers. Slider drags commit once
when the menu closes. Commands run after native menu tracking finishes.

Mol* canvas picking, xyzrender, collection molecule rows, and shell menus retain
their existing native routes. Browser, Finder Quick Look and mobile keep their
own supported presentation. Free-form measurement labels and column filters are
editors, not command menus. The viewer bridge validates menu shape, disabled
rows, option counts and nesting before opening AppKit.

### Sidebar And Search

- Folder markers use the matching 24-unit Hugeicons `Folder01Icon` and
  `Folder02Icon` outlines, recorded as `SidebarFolder`/`SidebarFolderOpen` in
  the shared icon snapshot. Both render at 16 px with the primary text color.
  `SidebarGlobe` comes from `Globe02Icon`; the folder component supports cyan,
  blue and purple network badges. Local folders have no badge; source identity
  must be supplied before assigning one. These glyphs use the existing
  `@hugeicons/core-free-icons` dependency's geometry and license.
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

- Transient status messages use the sonner toast layer
  (`apps/desktop/src/components/ui/toast.tsx`): notices stack and auto-dismiss,
  application error notices last eight seconds, and long details open in a standalone dialog
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

Desktop Sequence uses `apps/desktop/src/preview-sequence/adapter.js`
(bundled into `PreviewExtension/Web/sequence-panel.js` with `vp run build:sequence-ui`) to present Mol*
controls as compact named menus in a single header row. Selection actions remain
in the shared viewport toolbar.
The sequence is an opaque, flat, edge-to-edge dock with thin dividers, no outer card or
shadow. Its menus and resize target use the shared `Select` and `ResizableHandle`
components and the shared pixel-size guard; the preview stylesheet maps them
onto its existing theme tokens. User resizing persists the height across reloads.
Mol* still owns the hidden selects, residue nodes, numbering, and picking.
Dragging within a chain previews its range and scrolls at the reading-area edges
(vertically in wrapped mode, horizontally in compact mode). Releasing outside
commits the last endpoint; blur or cancellation clears the drag preview.
Blank reading-area clicks preserve the current selection.
Dragging the shared separator to the top collapses the dock. The same separator
remains at the viewport edge to reopen it by dragging down; Seq restores its last
expanded size, capped at the intrinsic content height and 60% of the viewport.
The cap is recalculated when the chain or available width changes. Below 112px,
the dock becomes a horizontal sequence track; it can shrink to 88px before collapsing.
The 3D viewport starts below the dock and resizes with it.
Single-letter sequences up to 10,000 residues use responsive groups of ten;
multi-letter residues and larger sequences retain the flexible Mol* layout.
The mobile host keeps its existing controls. Selection in the sequence uses a
high-contrast flat accent fill without per-letter outlines: dark text on a light
fill in dark mode, white text on a dark fill in light mode. Hover has a lighter tint. All chains
and All components use labeled, separated sections with sticky chain headings. The initial 3D selection
colour matches the accent, while authored snapshot renderer settings take precedence.

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

The shell takes its palette, type, radius and shadow scales from the Codex
desktop theme. `lib/codex-theme.ts` derives the base variables from the theme
preferences (accent, background, foreground, contrast) and writes them on
`.app-shell`; `styles/codex-tokens.css` holds the token layer that derives every
other value from those variables for the light and dark appearance. That file is
generated: regenerate it with `node scripts/sync-codex-tokens.mjs` and do not
edit it by hand. Interface text is 13px at weight 430. Burette's own variable
names (`--surface-*`, `--text-*`, `--line-*`) are mapped onto the tokens in
`lib/theme.ts`, so existing styles follow the theme without per-rule changes.
`apps/desktop/dev/codex-theme.html` shows the tokens and shared controls in
both appearances side by side in browser-dev.

`styles/interface-tokens.css` keeps the heading and settings text scale:
20/26 headings at weight 600, 14/20 body labels, and 12/18 supporting text.
Scientific tables keep their compact scale. Theme preferences still own
background, foreground, fonts and accent.

The shared controls in `components/ui` follow the Codex control specs and read
their colors, radii and shadows from the tokens. SDK pill buttons retain the
32px default, 28px `sm` and 24px `xs` sizes. Pane headers use the original app
button's `toolbar` / `icon-toolbar` sizes instead: 28px height, 13/18 type,
8px inline padding (zero for square icon controls) and `--radius-button-toolbar`.
Use the ghost variant for secondary toolbar actions. Ketcher's header follows
the Atlas `panel-header-toolbar` pane geometry; its actions wrap below the title
and display controls when the editor pane is narrow, rather than shrinking or
removing commands. Inputs are 36px fields. Select triggers use the original Atlas
outline style: 32px high with a 10px radius by default, or 28px high with a 7.5px
radius for `size="sm"`. Their popup and option CSS are extracted by
`scripts/sync-atlas-primitives.mjs`; the Radix adapter retains keyboard focus,
disabled choices, grouping and form values. Browser-dev uses web listboxes;
Tauri keeps real native selects. `Tabs` renders the inset segmented control.
Grid's Table/Cards switch reuses the shell `SegmentedControl` and its shared
`segmented-control.css` (Atlas ACc inset: 24px items inside a 28px track).
The shell imports this CSS into the components layer; standalone Grid embeds
the same source alongside its Atlas tokens. Keep keyboard selection in the
shared Radix primitive, not in a second grid-only toggle implementation.
At narrow widths the ordinary Grid toolbar wraps its controls rather than
hiding sorting, representation, columns or selection actions.
Grid toolbar actions use shared `Button` ghost/md and uniform icon/md variants;
the original button CSS is loaded by `styles.css` in the shell and embedded by
`grid-atlas-styles.ts` in standalone previews. The viewer's imperative
`aria-pressed` contract maps to the original selected appearance. Legacy grid
button rules must not override these shared controls.
Grid search uses the shared Atlas `SearchInput` (32px page-search variant),
including its clear action and focus return. Search text updates immediately;
the collection filter retains its 120ms debounce and stale-request invalidation.
Grid selects reuse `NativeSelectControl` and the extracted Select CSS, not a
second arrow image or field skin. The real select remains the viewer's value,
options and disabled-state contract; only browser popups use `GridSelectMenu`.
Grid button hints also use the shared `Tooltip` floating variant, portaled
outside the toolbar with its exposed width as the collision boundary. They
open below the top toolbar after 200ms, remain available on disabled actions,
and dismiss with Escape without activating their button. Standalone previews
embed the same tooltip CSS as the shell; do not add a grid-only tooltip skin.
Grid Actions uses shared `DropdownMenu` content/items/labels/separators and
the same `dropdown-menu.css` as the shell. Radix owns placement, focus and
keyboard navigation, with the overlaid dock excluded from the available
width. Menu items remain real buttons with their original IDs for viewer
updates and the native menu adapter; inline method choices retain their
native selects. Commands close the menu before dispatching their action.
Tooltips have no arrow unless `showArrow` is set. Style these controls through
their variants and sizes; app styles should only place them, not repaint them.

Run `vp exec node scripts/sync-atlas-primitives.mjs --check` to compare the
extracted CSS modules with the local InterfaceAtlas snapshot without modifying
them. Use `--atlas /path/to/InterfaceAtlas` for a different checkout. A mismatch
or missing generated module exits nonzero. This verifies extraction fidelity,
not React interaction behavior or whole-screen visual parity.

Loading uses two original Atlas variants: `Spinner` is the 18px app icon with
a two-second stepped rotation synchronized to the document timeline, including
indicators mounted later; `LoadingIndicator` is the gradient ring with a 0.8s
linear rotation and explicit size/stroke controls. Both stop animating under
`prefers-reduced-motion`. Keep their geometry and animation behavior in the
shared primitives rather than adding screen-specific spinners.

Composition, Tools, File and other `InspectorSection` blocks use the shared
`CollapsibleSection`, from Atlas `display/collapsible-section` (`Ci`). Its native
details/summary disclosure keeps child controls mounted and excludes collapsed
content from keyboard navigation. The 37px header, 16/24 medium title, 14px
disclosure glyph, subtle divider and 16px body gap follow that source; do not
wrap it in another padded inspector card. Filters, Smooth motion and its nested
Scientific settings also use this primitive; Folding Results remains a separate
accordion and is not evidence that every disclosure migrated.
Calculation rows use shared Button/Dialog/Tooltip primitives. Their unavailable
reason stays in the settings trigger's tooltip and accessible description,
rather than making disabled rows taller. The primary action remains disabled
both in the row and in its settings dialog.

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

### Code And Markdown Highlighting

Code viewers and Markdown fenced blocks use Shiki with explicit, lazily loaded
language grammars and the Oniguruma WASM engine. The existing bounded worker
queues and line caches remain responsible for visible-range tokenization.
`code-viewer-syntax-shiki.ts` maps the CSS-variable theme into semantic token
classes, so light/dark theme changes do not require a second tokenization pass.
Source text stays escaped by the existing DOM and Markdown projections.

Tokenization is line-local, as before; multiline lexical state is not retained
across virtualized requests. The editable CodeMirror surface retains its own
parser and incremental editor highlighting.
