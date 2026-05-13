# Writer Computer Spec Adaptation

## Summary

This document records which Writer Computer specs were adapted for Burrete and
which were intentionally skipped. The source reference is
`joelbqz/writer-computer` at commit `64c20bdb5881612e1c6c8bc4bca89155b3d863fd`.

Burrete is a molecular preview app, not a markdown editor, so only specs that
improve macOS/Tauri app quality, preview opening, file resilience, theming,
accessibility, and window behavior are carried over.

## Adapted Specs

| Writer spec | Burrete spec | Why it transfers |
| --- | --- | --- |
| `auto-update-spec.md` | `burette-auto-update-tauri-spec.md` | Native update lifecycle applies directly to Burrete releases. |
| `document-open-latency-spec.md` | `burette-preview-open-latency-spec.md` | Preview startup should avoid fast-file loading flashes and redundant runtime generation. |
| `slow-storage-resilience-spec.md` | `burette-filesystem-open-resilience-spec.md` | Molecular files may live on cloud, external, or network volumes. |
| `theming-system-spec.md` and `body-theming-spec.md` | `burette-preview-theme-and-background-spec.md` | Burrete needs one consistent visual token pipeline for shell and preview backgrounds. |
| `keyboard-and-accessibility-spec.md` | `burette-ui-a11y-spec.md` | Sidebar, tabs, settings, and preview controls need keyboard and accessibility coverage. |
| `titlebar-double-click-zoom-spec.md` | `burette-titlebar-window-behavior-spec.md` | Custom Tauri titlebar must still honor macOS window conventions. |
| `workspace-switch-hang-spec.md` | `burette-preview-task-cancellation-spec.md` | The same epoch/cancellation idea applies to stale preview generation and renderer refreshes. |

## Skipped Specs

These Writer specs are intentionally not copied because they are markdown-editor
or workspace-editor concerns:

- `archive-files-spec.md`
- `breadcrumb-spec.md`
- `caret-history-navigation-spec.md`
- `custom-mcp-spec.md`
- `document-date-display-spec.md`
- `editor-context-menu-spec.md`
- `editor-context-menu-submenus-spec.md`
- `editor-search-lifecycle-spec.md`
- `editor-shortcuts-clash-spec.md`
- `editor-tab-switch-performance-spec.md`
- `extensionless-markdown-links-spec.md`
- `frontmatter-edit-flow-spec.md`
- `fuzzy-search-grep-spec.md`
- `gitignore-aware-workspace-spec.md`
- `heading-anchor-links-spec.md`
- `inline-media-preview-spec.md`
- `mermaid-diagrams-spec.md`
- `multi-window-spec.md`
- `new-tab-recent-files-spec.md`
- `obsidian-image-embed-spec.md`
- `obsidian-wikilink-parsing-spec.md`
- `recent-workspaces-dock-menu-spec.md`
- `remove-saving-indicator-spec.md`
- `section-indicators-spec.md`
- `sidebar-bulk-actions-spec.md`
- `sidebar-file-context-menu-spec.md`
- `sidebar-folder-context-menu-spec.md`
- `tags-spec.md`
- `workspace-snapshot-spec.md`
- `writer-cli-spec.md`
- `writer-open-cli-spec.md`

Some UI-only ideas from Writer's sidebar, tab, command palette, and UI-store
shape are already reflected in the current Tauri shell work, but their full
document-tree semantics do not belong in Burrete unless Burrete later grows a
persistent workspace browser.
