# Molecule Session Model

## Summary

Burette should adapt Writer's tab/session architecture to molecular structures.
The product model is a molecule session, not a markdown workspace.

## Entities

- `ViewerDocument`: one opened structure or collection preview.
- `MoleculeTab`: a visible tab for a viewer document, Settings, or Launcher.
- `ViewerPreferences`: rendering and shell preferences.
- `RecentStructure`: a persisted file path remembered for quick reopening from
  the sidebar and command palette.

## Requirements

- Molecule session state is separate from shell/sidebar/settings state.
- Opening a structure creates or refreshes a `ViewerDocument` and activates its
  tab.
- Closing a tab does not delete source files.
- Closing all structures clears in-memory documents without affecting preview
  cache unless explicitly requested.
- Settings are a tab-like page in the Writer shell.
- Launcher is shown when no molecule is active.
- Recently opened structures survive app reloads, but generated viewer runtime
  documents do not; reopening a recent structure rebuilds the runtime from the
  source file.

## Non-Goals

- Markdown save state.
- File tree CRUD.
- Workspace folder indexing.
- Frontmatter, wiki links, or Mermaid support.

## Acceptance Criteria

- `use-tabs` reads from a molecule/session store, not from the shell store.
- The tab strip can represent multiple molecules plus Settings.
- Sidebar and command palette can activate any open structure.
- Sidebar and command palette can reopen recent structures.
- Existing preview runtime paths remain the source of viewer iframe URLs.
