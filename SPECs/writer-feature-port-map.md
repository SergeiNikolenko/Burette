# Writer Feature Port Map

## Summary

This document maps Writer Computer features and specs to their Burrete
destination. The rule for the full transplant is: copy Writer behavior by
default, adapt markdown-specific semantics into molecular-preview semantics, and
only disable a feature when it would create dead UI or conflict with Quick Look
or molecular preview invariants.

## Writer Specs

| Writer spec | Burrete action |
| --- | --- |
| `cmd-f-spec.md` | Adapt to active molecule view search: grid search, table search, and future metadata search. |
| `custom-mcp-spec.md` | Defer behind a Burrete plugin/automation spec; keep command palette extension point. |
| `document-date-display-spec.md` | Adapt to file metadata display: modified time, size, format, renderer, source path. |
| `external-file-watcher-spec.md` | Copy and adapt to molecular cache invalidation and viewer reloads. |
| `fuzzy-search-grep-spec.md` | Adapt path fuzzy search first; defer content grep unless molecular metadata/text extraction is defined. |
| `heading-anchor-links-spec.md` | Disable for the desktop viewer; keep only for docs/spec workspace if added later. |
| `inline-media-preview-spec.md` | Adapt to inline molecular/asset previews where the viewer has list or detail surfaces. |
| `install-cli-menu-placement-spec.md` | Copy and adapt to install the `burrete` CLI. |
| `mermaid-canvas-widget-spec.md` | Disable for v1 unless Burrete grows a document/notebook surface. |
| `mermaid-drag-selection-edit-mode-flip-spec.md` | Disable for v1 with the Mermaid surface. |
| `multi-window-spec.md` | Adapt carefully for multiple molecular workspaces/windows. |
| `new-tab-recent-files-spec.md` | Copy and adapt to recent structures and recent folders. |
| `obsidian-image-embed-spec.md` | Disable for v1; no markdown/Obsidian document model in Burrete. |
| `section-indicators-spec.md` | Disable for v1; no markdown outline surface. |
| `selection-rect-bleeds-past-text-spec.md` | Copy visual polish/test principle where text/list selection appears. |
| `slow-storage-resilience-spec.md` | Copy and adapt to large molecular files, external volumes, network drives, and cloud sync. |
| `tags-spec.md` | Adapt to molecule labels, dataset tags, source annotations, or file-derived tags. |
| `workspace-snapshot-spec.md` | Copy and adapt to molecular file snapshots keyed by path and stable identity. |
| `writer-cli-spec.md` | Copy and adapt into `burrete` CLI spec. |

## Writer Desktop Code Areas

| Writer area | Burrete action |
| --- | --- |
| `apps/desktop/src/App.tsx` | Copy as shell host and replace editor payload with molecule viewer. |
| `apps/desktop/src/App.css` | Copy shell tokens and adapt only brand/product names and molecule-specific surfaces. |
| `components/app-layout.tsx` | Copy. |
| `components/window-title/` | Copy and keep macOS chrome parity. |
| `components/welcome/` | Copy and adapt text/actions to open molecular files/folders. |
| `components/settings-panel/` | Copy shell and replace settings schema with Burrete renderer/app settings. |
| `components/sidebar/` | Copy behavior and adapt file tree to molecular formats. |
| `components/command-palette/` | Copy and replace commands with Burrete commands. |
| `components/editor-area/editor-tabs.tsx` | Copy visual behavior and adapt tabs to molecular documents. |
| `components/editor-area/index.tsx` | Transform into molecule viewer area. |
| `components/editor-area/new-tab-page.tsx` | Adapt to recent structures. |
| `components/editor-area/editor-pane.tsx` | Replace with molecule runtime frame. |
| ProseMirror/markdown editor internals | Remove from the product surface unless a future notes/spec editor is explicitly added. |
| Mermaid/wiki/frontmatter helpers | Move to disabled/deferred code or remove after specs mark them out of scope. |
| `hooks/use-workspace.ts` | Copy and adapt to molecular workspace. |
| `hooks/use-tabs.ts` | Copy and adapt to molecule tabs. |
| `hooks/use-file-watcher.ts` | Copy and adapt to renderer reload/cache invalidation. |
| `hooks/use-keyboard-shortcuts.ts` | Copy and adapt commands. |
| `hooks/use-command-palette.ts` | Copy. |
| `hooks/use-open-drop.ts` | Copy and adapt accepted file formats. |
| `hooks/use-sidebar.ts` | Copy. |
| `hooks/use-theme.ts` | Copy. |
| `stores/workspace-store.ts` | Copy and adapt state shape. |
| `stores/ui-store.ts` | Copy. |
| `stores/settings-store.ts` | Copy and replace schema. |
| `stores/editor-store.ts` | Replace with `molecule-store.ts`. |
| `shared/themes/` | Copy. |
| `shared/settings.schema.json` | Ported as `apps/desktop/shared/settings.schema.json` with Burrete renderer/app settings. |

## Writer Backend Code Areas

| Writer area | Burrete action |
| --- | --- |
| `apps/desktop/src-tauri/src/state.rs` | Defer direct copy. Writer's multi-window Markdown index state is not compatible with the current molecular viewer. Revisit only with a molecular workspace-state spec. |
| `apps/desktop/src-tauri/src/watcher.rs` | Defer direct copy. Adapt only after defining molecular cache invalidation and reload semantics. |
| `apps/desktop/src-tauri/src/open_target.rs` | Ported as Burrete `open_target.rs` for supported molecular files and folders. |
| `apps/desktop/src-tauri/src/updater.rs` | Copy structure, replace product identity and endpoints. |
| `apps/desktop/src-tauri/src/writer_cli.rs` | Copy as basis for `burrete_cli.rs`. |
| `apps/desktop/src-tauri/src/commands/fs.rs` | Ported structurally as `commands/fs_actions.rs`; behavior remains molecular-folder/file operations. |
| `apps/desktop/src-tauri/src/commands/search.rs` | Ported structurally as `commands/search.rs`; behavior remains supported-structure path search. |
| `apps/desktop/src-tauri/src/commands/settings.rs` | Copy shape, adapt settings schema. |
| `apps/desktop/src-tauri/src/commands/workspace.rs` | Partially represented by `commands/workspace_store.rs`; full Writer workspace lifecycle is deferred until multi-window molecular workspaces are specified. |
| `apps/desktop/src-tauri/src/commands/images.rs` | Adapt or remove based on molecule asset preview needs. |
| `apps/desktop/src-tauri/src/commands/shell_install.rs` | Copy and adapt for `burrete`. |
| `apps/desktop/src-tauri/src/commands/startup.rs` | Ported structurally and merged with Burrete startup documents via `open_target`. |
| `apps/desktop/src-tauri/src/config.rs` | Copy and adapt product names/paths. |
| `apps/desktop/src-tauri/src/error.rs` | Copy. |

## Burrete Domain Modules To Create

```text
apps/desktop/src/lib/molecule-formats.ts
apps/desktop/src/lib/molecule-runtime.ts
apps/desktop/src/lib/quicklook.ts
apps/desktop/src/lib/renderer-policy.ts
apps/desktop/src/stores/molecule-store.ts
apps/desktop/src/types/molecule.ts
apps/desktop/src/components/viewer-area/
apps/desktop/src/components/molecule-tabs/
apps/desktop/src/components/molecule-grid/
apps/desktop/src-tauri/src/molecule/
```

## Cleanup Rule

After a Writer feature is either copied, adapted, or explicitly disabled by a
spec, remove the corresponding old Burrete implementation if it duplicates the
same responsibility. Do not leave old and new shells side by side.
