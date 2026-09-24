# Native widget development

First-use examples do not require a project checkout: `open_viewer` accepts
`example: "1htb" | "caffeine"` from packaged assets. For a new Ketcher drawing,
pass `view: "ketcher"` and `structure: { format: "smi", content: "..." }`
instead of `file`. Content is bounded to 64 KiB and snapshotted privately with
the session; it is not a saved user document. Retries bind to the same content.
Ketcher opens inline unless `displayMode: "fullscreen"` is explicitly requested.
Mounting still depends on the host; a created session is not a rendered molecule.
The caffeine example selects `view: "xyzrender"` explicitly. The native adapter
passes a document-scoped initial renderer to the shared app; it does not change
saved preferences or override subsequent explicit renderer changes.

## Story Auto acceptance

`scripts/molstar-story-presentation.mjs` intercepts only current Story snapshots
before their first application. In Auto it omits authored molecular geometry,
uses the normal Mol* Auto provider, preserves the selected appearance, and caches
the completed state per step/appearance. Camera restoration and rendering resume
only after this work finishes. Do not add delayed restyling to the observer.

The docking fixture's `burette-environment` MVS component reference selects
the exact residues for standard Mol* component and representation builders.
Do not focus/expand this set a second time: a 5 Å expansion around every pocket
residue highlights unrelated neighbours. Without an explicit nonempty component
no environment is manufactured. One stock ball-and-stick representation shows
the exact set, without residue-name labels. Preserve authored distance measurements:
the docking fixture has six measured atom-endpoint distances per step, also listed
in the Story description. Check numeric labels against the endpoint coordinates.
The facade lives in
`scripts/molstar-story-facade.js` and uses the installed Mol* implementation.

Run `node --test tests/test-story-automatic-presentation.mjs`, rebuild both
native and compatibility resources, install normally, then verify first-frame
appearance and next/previous on the newly served native resource. Unit checks
are not visual or performance acceptance.

## File-header acceptance

`WorkspaceFileHeader` is shared React UI, not a copy of host-owned Codex chrome.
Its primary Open button follows the shared `openInDefaultDestination` preference;
the adjacent chevron opens discovered applications and a `Default for Open`
submenu. This preference does not change macOS file associations. Reveal in Finder is a menu item, not a separate
folder button. The compact 38px row shows path breadcrumbs and full-path copying.
Workspace right/bottom dock toggles belong in this row, not the Mol* toolbar.
Run `bun tests/test-workspace-file-header.tsx` for path changes, full-path copying,
dock toggles and Open action routing, then verify light/dark rendering. The main checkout carries the same
component and stylesheet. Build with `--app-root` below to consume that source
directly rather than maintaining a second UI copy.
Do not claim that the visible file heading also changes the Codex tab title.
Do not add unsupported Save As or View source buttons just to match a reference.

Application icons use the bundle's original ICNS artwork at 64px when available,
not Launch Services' decorated legacy tile. Finder/asset-catalog-only apps retain
the system fallback. Cache materialized icons across header rerenders/remounts;
never blank them when dock buttons change state. Test with
`tests/test-open-editor-discovery.tsx`, `tests/test-open-editor-default.tsx` and
`tests/test-local-file-actions.mjs`.

The shared Mol* RDKit preview loader must resolve lazy scripts through
`BuretteResolveRuntimeAsset` in the native widget. Relative script URLs cannot
load packaged resources from a sandboxed `srcdoc` iframe. Verify real NAD SVG
generation with `tests/test-molecule-preview-rdkit.mjs`; script/module failures
must be bounded rather than leaving `Rendering 2D preview...` forever.

## Identify the source before editing

The native Codex widget, hosted public plugin, and installed desktop app are
different delivery surfaces. A desktop or browser build does not update a
mounted native widget.

The recovered native widget is currently built from the `Burette-widget-recovery`
checkout. Main-line packaging stages a pinned widget through
`config/native-widget.json` and `scripts/stage-native-widget.mjs`; that pin does
not automatically include uncommitted work or new application UI changes.
Verify these paths and the current git status before each task. Do not overwrite
the user's dirty primary checkout or assume the two histories can be merged.

Native source owners:

- `PreviewExtension/Web/viewer-shell.js` and `viewer-runtime.css` in `--app-root`:
  shared toolbar markup, icons, menu appearance and spacing. Do not decorate
  those controls a second time in the native adapter.
- `plugins/burette-agent/ui/native-workspace-placement.mjs`: host button/layout.
- `plugins/burette-agent/ui/native-workspace-preview.mjs`: preview integration.
- `PreviewExtension/Web/viewer.js`: shared molecular viewer behavior.
- `config/icons/apps-sdk.json`: reviewed shared icon geometry, with its LICENSE.
- `plugins/burette-agent/mcp/registrations/local-viewer/register.mjs`: tool contract.
- `scripts/mcp-app-session.mjs`: bounded, authorized session/action transport.

Reuse the main application's reviewed components and icons. When porting a
change, inspect its dependencies and paired tests; do not blindly copy a dirty
viewer or generated bundle. The recovered checkout is not yet automatically in
sync with main. Shared icon snapshot updates must be deliberate and reviewed.

## Build and install

Run from the verified native source checkout:

```sh
node --test tests/test-native-workspace-toolbar.mjs tests/test-native-workspace-preview.mjs tests/test-native-workspace-placement.mjs tests/test-agent-workspace-panel.mjs tests/test-mcp-app-session.mjs
bun run typecheck
node scripts/check-vendor-assets.mjs --write
bun scripts/build-agent-shell-plugin.mjs --app-root /Users/nikolenko/.codex/worktrees/b55a/Burette
bun run install:plugin
```

Only update the vendor lock when owned runtime sources change; review its diff.
Change the source plugin manifest version before publishing a new local build.
Finish edits before building. A source edit after the build requires rebuilding.
Never patch installed caches, immutable server snapshots, or generated bundles
by hand. Keep targeted tests proportional to the touched surface.

`--app-root` builds the desktop shell, grid, sequence, compact molecular runtime,
native runtime and reviewed icons from the supplied application checkout.
Transport/MCP adapters remain owned by this recovery checkout. A rebuild consumes
new main UI changes; an already mounted card does not hot-reload. The main
repository's release pin is a separate contract and is not updated by this flag.

## No-restart verification

Installed package, active MCP resource, and already mounted card are three
separate states. The installer reports `restartRequired`; this is not proof that
a full Codex restart is necessary, nor is installation proof of hot reload.

1. Check the install result's exact version and path.
2. Read `ui://burette/native-workspace-v1.html` from `burette_agent_mcp`.
   Compare a few distinctive rendered strings/attributes with the built resource.
   Keep output bounded; never print the full bundle. Minification changes quotes
   and variable names, so do not rely on a literal source expression as a marker.
3. A resource read is evidence about that resource connection only, not every
   tool connection or mounted pane. Codex can retain several generations at
   once. After a normal install, inspect only the Burette server processes
   (`ps -Ao pid,ppid,args`, matching `./mcp/lib/server-bundle.mjs --stdio`) and
   use `lsof -a -p <exact-pid> -d cwd -Fn` to identify their cache version.
   On 2026-09-23, installation of 0.2.19 started a server in its new cache
   directory without restarting Codex, while a resource read still returned
   another generation. Do not call the whole plugin stale on that basis.
   A new process is not proof that an existing pane has adopted its assets.
   Preserve existing panes and open one fresh pane when the user requests the
   updated build, then observe that exact session and verify its rendering.
   If the resource connection is old, report that narrowly. Do not kill processes,
   clear user state, mutate caches, or create repeated cards to force a refresh.
   A refresh without restarting has been observed, but its trigger is not a
   guaranteed API. Do not promise it on the next message.
4. Once the live resource matches, open a fresh card only when the user requests
   the updated build. Keep ordinary scene actions and additional files in the
   existing session. Old mounted cards can retain the previous generation.
5. Observe that exact session: `awaiting_mount` is not loaded. `ready: true`
   is typed readiness, not proof of correct visual layout.

Do not restart Codex unless the user explicitly authorizes it.

Same-task refresh has already been observed. Do not reinterpret the
plugin-creator recommendation to test in a new task as a requirement to restart
the host or abandon this task. A new task is a fallback for tool pickup and
requires the user's request. Check the current connection first.

For an updated-UI request, a successful opener, ready molecule or scene capture
does not close the acceptance gate. Verify the actual changed header, controls
and interactions in that exact mounted panel before claiming delivery. If the
panel still shows the old UI, keep the update incomplete; do not open repeated
cards. Compare like-for-like resources: native HTML against native HTML, and
shell assets against shell assets. HTML alone does not identify every asset
served through the separate tool connection.

## Acceptance checklist

For mode-transition regressions, use an extracted molecule, not only an
original disk file. Virtual `burette-ketcher://` documents must carry source
bytes into their first Mol* to xyzrender transition; do not authorize their
synthetic paths as local files. Exercise Grid -> molecule in a new tab ->
xyzrender -> Mol* -> Ketcher and return to the original collection. Verify
hover hints as well as accessible names after icon decoration.

- Confirm a visible molecular scene, not just a created tool card.
- Check both light and dark themes, actual widget width, and narrow side pane.
- Check L/R inside their icon panes, SEQ, style label, mode icons and tooltips.
- Horizontal action icons and vertical rail icons use the same 16 px footprint.
  Workspace right/bottom dock actions are in the current-file header. Toolbar
  hints use the browser top layer to escape the scroll container; check actual
  hover, not only tooltip text in the DOM.
- Check side-pane startup, expanded controls, return to chat and back. Manual
  collapse must survive same-mode host updates. The document must stay mounted.
- Check button click, opaque fill, size, border and corner radius.
- Check whole-protein framing without clipping; do not focus only the first
  residue or hide a failed selection behind a success message.
- Switch multiple documents; wait for observation to identify the new active
  document before sending molecular commands. An action acknowledgement can
  precede the next observation. Preserve all user tabs and camera state.
- Check `set_workspace_panel` for both right/bottom with an observed open
  document ID. Bottom is available in side-pane mode, not the inline card.
- Use `capture_scene` for molecular canvas evidence. It does not capture toolbar
  layout; use an authorized native UI surface or the user's screenshot for that.
- Report installed, live-resource-verified and visually verified separately.

Do not claim a PR, deployment, full-main parity, or marketplace readiness from
these local checks. Those are separate requested workflows.

## Molecular selection and generated-document tabs

The experimental Annotate tool has been removed at the user's request. Do not
restore its overlay, comment editor, button, or direct chat-send bridge. Keep
the standard viewer picking/context menu and selection-to-composer context.

The native shell suppresses its internal document tab strip and collapses the
project sidebar in the shared layout, including persisted open-sidebar state.
Hiding the panel's inner DOM with CSS alone leaves its resizable wrapper wide.
Only host-owned Codex tabs remain visible; no outer tab-creation API is assumed.
Existing internal documents remain accessible through tab-management tools.
Composer context must include protein/residue selections, not only ligand
preview targets; deselection clears it. Generated
`burette-ketcher://` documents are unsaved in-memory documents, not file paths:
the shared header must omit filesystem Open/Copy actions and icon discovery.
Never extend file authorization to synthetic paths to suppress an error.

Focused application checks: `tests/test-open-editor-discovery.tsx`,
`tests/test-native-file-actions.mjs`, `tests/test-workspace-file-header.tsx`,
`tests/test-native-layout-selection.mjs`, `tests/test-toolbar-viewport-bounds.mjs`.
Verify the same interactions after installing the native package; these checks
do not certify the host's composer attachment or native header rendering.

## Host-owned Open menu API

The Codex file pane's native Open/Open With menu is not a component exported by
the installed MCP Apps SDK. Do not emulate host chrome and call it native.
The plugin's existing authorized `fileAction` transport supports `list_apps`,
`reveal`, `open_default`, and `open_with` for session documents. Those operations
are distinct from embedding Codex's menu. The public Apps SDK documents
`openExternal` and `setOpenInAppUrl` for ChatGPT; that does not prove that this
Codex host exposes them or accepts custom `burette://` links.
