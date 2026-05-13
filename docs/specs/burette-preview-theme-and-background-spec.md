# Burrete Preview Theme And Background Spec

## Summary

Unify the visual theme pipeline for the Tauri shell, Settings page, and embedded
preview runtime. The shell should follow a restrained native macOS
style, while the molecular viewer keeps renderer-specific controls and canvas
backgrounds predictable.

## Goals

- Keep a small primary token set for the app shell:
  - accent;
  - background;
  - foreground;
  - UI font;
  - contrast.
- Derive sidebar, tab, hover, border, and status colors from those primaries.
- Keep preview canvas background separate from shell theme.
- Apply theme changes live to the active preview runtime.
- Persist user preferences.

## Non-Goals

- A third-party theme marketplace.
- Per-file themes.
- Arbitrary CSS injection.
- Replacing renderer-specific light/dark controls inside Mol* or RDKit.

## Token Model

Primary shell tokens:

- `--accent`
- `--bg-base`
- `--fg-base`
- `--ui-font`
- `--contrast`

Derived tokens:

- text primary/secondary/muted;
- line/border;
- subtle/hover/active surfaces;
- tab active background;
- focus ring;
- status surface.

Preview tokens:

- `canvasBackground`: `auto`, `black`, `graphite`, `white`, `transparent`.
- `theme`: `auto`, `dark`, `light`.
- `overlayOpacity` for viewer controls.

The shell theme must not force the molecular canvas to become transparent unless
the explicit canvas preference requests it.

## UX

Settings contains:

- Theme: auto/dark/light.
- Canvas: auto/black/graphite/white/transparent.
- Renderer: auto/Fast XYZ/Mol*/external xyzrender.
- XYZ style.

Changing a setting refreshes the active viewer and marks the status line with a
short message.

## Implementation Notes

- Keep CSS derivations in `apps/desktop/src/styles.css`.
- Keep persisted viewer preferences in `apps/desktop/src/stores/settings-store.ts`.
- Pass selected theme/canvas values through `ViewerPreferences` into runtime
  config.
- Generated runtime CSS should use semantic values and avoid hardcoded UI chrome
  that conflicts with the shell.

## Acceptance Criteria

- Dark and light shell themes are readable at all supported window sizes.
- No unintended desktop/background transparency leaks through the app shell.
- Viewer canvas background follows the Canvas preference.
- Theme changes refresh the active preview without duplicating tabs.
- Settings stays a tab/page in the shell, not a floating inspector panel.
