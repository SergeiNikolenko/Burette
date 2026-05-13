# Settings And Theme System

## Summary

Burette settings should follow Writer's compact settings and theme-store model
while retaining Burette renderer and Quick Look controls.

## Sections

- Appearance
- Renderer
- Grid Preview
- Quick Look
- Updates
- Maintenance

## Requirements

- Viewer preferences live in a dedicated settings store behind settings hooks.
- Theme tokens drive shell, sidebar, tabs, command palette, and settings.
- Renderer preferences remain typed and persisted.
- Settings rows use Writer-like local controls instead of native default
  checkboxes or unstyled action buttons.
- Maintenance actions remain explicit: clear cache, reset Quick Look, open logs.
- Update channel and release checks stay Burette-specific.

## Acceptance Criteria

- Settings state is separate from sidebar and molecule-session state.
- Settings can be opened from tabs, sidebar, menu, and command palette.
- Changes to renderer/background preferences refresh active preview behavior.
- The automatic update preference is rendered as a compact switch control.
- Settings action buttons share one Writer-like visual class.
- The shell can visually match Writer without hard-coding a single theme.
