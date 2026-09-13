# Ketcher presentation adapters

`primitives.tsx` maps Ketcher 3.15.0 presentation components to Burette's shared
shadcn components. `workspace.css` owns the surrounding layout and theme fixes,
including macromolecule panels and dialogs rendered outside the editor shell.

Ketcher has no public component-slot API. The Vite plugin in
`../../../vite/ketcher-ui.ts` replaces only reviewed primitive boundaries in
its published bundle, during dependency optimization and application bundling.
Hashes deliberately fail on an upstream change. Review component props and form
codecs before updating the hashes; do not bypass the checks. Chemistry services,
canvas rendering, Redux actions, and input value codecs remain upstream-owned.

Run `bun tests/test-ketcher-ui-binding.mjs`,
`bun tests/test-ketcher-ui-primitives.mjs`, and `bun run typecheck` from the repo
root. Visually check light/dark settings, atom/bond dialogs, periodic and extended
tables, templates, import/export, and both molecule modes in browser-dev.
Controls retain a fixed size in both modes; narrow windows scroll the action
strip instead of scaling the editor. Check mode switching and RNA Builder at
narrow widths. `menus.tsx`, `context-menus.tsx`, and `natural-analogue.tsx`
map menu presentation to shared controls while preserving upstream handlers.
Check context submenus, zoom, RNA preset editing, and fullscreen portals. Browser verification does not establish packaged native or Quick Look
behavior; this adapter applies to the desktop editor bundle.

The macro layout gives the action bar a full-width row, with the canvas and
280px library below. The hidden-library control collapses that column. Stable
Emotion target classes used here belong to the pinned Ketcher version; inspect
Layout again before upgrading. Library previews carry an upstream translate
style and stay beside the library; canvas previews retain their own positions.
Verify RNA typing, sequence/flex switching, library hide/show, RNA properties,
and both preview types after layout changes, in both themes.

General controls share the OpenAI Apps SDK UI 0.2.2 glyph snapshot in
`../ui/app-icons.tsx`; `control-icons.tsx` replaces only named general actions.
Chemical glyphs and shortcut labels remain upstream-owned. Refresh the desktop
snapshot with `node scripts/sync-app-icons.mjs`.
Molecule tool groups have separate primary and dropdown buttons: the primary
selects the current tool, while a chevron shown on hover or keyboard focus opens alternatives.
Selecting an option still dispatches the original action. The molecular canvas takes the whole
area under the action strip; the side rails and the template bar float over it as content-sized
cards. Side rails use native overflow scrolling,
without upstream arrow strips. Check arrow selection and drawing, wheel access
to both ends of each rail, and clipboard dropdowns after changing these rules.

The Burette header owns the single zoom control. Help/About are hidden through
Ketcher's button config. Fullscreen targets the marked Ketcher page, including
its header; verify both entry and exit. Molecular selection plates and transform
handles use neutral theme colors, scoped to the canvas's pinned color markers.

The active Ketcher page portals its Import/Export text controls into the right dock. Import retains automatic format detection and live loading; export subscribes to sketch changes. Close/reopen preserves panel state, and inactive kept-alive pages must not render into the shared dock.
