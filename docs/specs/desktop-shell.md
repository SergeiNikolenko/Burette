# Desktop Shell

The Burrete desktop shell is a compact molecule workspace.

## Required Surfaces

- sidebar for project folders and nested structures
- tab strip for active previews and settings
- command palette for app actions
- settings page for renderer and preview preferences
- update check entry point in the app menu and command palette

## Session Model

- Open structures are represented as tabs.
- Recent structures are persisted.
- Sidebar project groups are derived from structure paths plus optional explicit project roots.
- Explicit project roots persist independently from open tabs so the sidebar can preserve folder context.
- File preview tabs keep renderer state while mounted.
- Settings is a persistent page, not a generated molecule preview.

## Command Palette

The command palette must expose structure opening, tab switching, renderer
selection, cache cleanup, Quick Look reset, log folder opening, settings, and
update checks.
