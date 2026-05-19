# Burrete xyzrender Controls Spec

## Summary

Add a shared compact `xyzrender` controls menu to the preview runtime so the
desktop app, browser-dev runtime, and Quick Look can expose the most useful
`xyzrender` flags without overloading the top toolbar or turning preview into
an export workstation.

The feature must preserve the existing hybrid renderer boundary:

- Mol* remains the interactive 3D viewer.
- Fast XYZ remains the lightweight static fallback.
- External `xyzrender` remains the publication-oriented SVG renderer.

## Goals

- Keep the top toolbar compact while exposing a small, meaningful set of
  `xyzrender` controls.
- Use one shared runtime menu for browser-dev, the Tauri app, and Quick Look.
- Send structured `xyzrender` controls through the preview reload contract
  instead of relying on ad hoc string parsing in the viewer.
- Support a first-class set of common controls that make sense in preview:
  - transparent background;
  - gradients on/off/default;
  - fog on/off/default;
  - VdW spheres toggle;
  - hide bonds;
  - cell on/off/default;
  - ghosts on/off/default;
  - axes on/off/default;
  - supercell dimensions.
- Keep a smaller appearance subsection for the few preview-safe numeric/style
  controls that still matter in runtime preview:
  - atom scale;
  - bond width;
  - VdW scale;
  - molecular flat color.

## Non-Goals

- Rebuilding preview around every `xyzrender` CLI flag in one pass.
- Turning Quick Look into a heavyweight export workstation.
- Supporting GIF/export-only flows from the preview menu.
- Allowing preview users to override output paths, reference-file paths, or
  renderer executable paths from the runtime toolbar.

## UX

### Toolbar

The top toolbar stays short.

When `renderer === "xyzrender-external"`:

- show the preset select;
- show a `Tune` action;
- keep renderer switching visible.

When any other renderer is active:

- hide the `Tune` action;
- hide the `xyzrender` advanced menu.

### Advanced Menu

The `Tune` action opens a popover anchored to the toolbar.

The popover contains these sections:

- `Main`
  - transparent background
  - gradients
  - fog
  - VdW
  - hide bonds
- `Crystal`
  - cell
  - ghosts
  - axes
  - supercell
- `Appearance`
  - atom scale
  - bond width
  - VdW scale
  - mol color

The menu uses live editing:

- changing a field updates local form state and automatically reloads the
  active preview after a short debounce;
- `Reset` clears the advanced controls back to runtime defaults for the current
  document.

## Data Contract

`ViewerReloadOptions` gains a new optional object:

- `xyzrenderControls`

`xyzrenderControls` contains a structured subset of CLI behavior:

- `transparentBackground?: boolean | null`
- `atomScale?: number | null`
- `bondWidth?: number | null`
- `molColor?: string | null`
- `gradients?: boolean | null`
- `fog?: boolean | null`
- `showVdw?: boolean | null`
- `vdwScale?: number | null`
- `hideBonds?: boolean | null`
- `showCell?: boolean | null`
- `showGhosts?: boolean | null`
- `showAxes?: boolean | null`
- `supercell?: [number, number, number] | null`
- `customConfigPath?: string | null`
- `extraArguments?: string | null`

The runtime config returned to the viewer also includes:

- `xyzrenderControls`

This allows the shared viewer menu to reflect the current active state after
reloads and when switching tabs.

## Runtime Rules

- Structured controls must compile to explicit CLI arguments in the worker
  layer, not in the shell UI.
- `preset` remains the owner of `--config` unless an external host default
  explicitly supplies `customConfigPath`.
- `customConfigPath` and `extraArguments` remain host/runtime fields but are
  not part of the shared compact preview popover.
- The advanced CLI field, when supplied by the host, is appended after
  structured controls.
- Unsafe flags must be stripped from the advanced CLI field:
  - `-o`, `--output`
  - `-go`, `--gif-output`
  - `--config`
  - `--ref`
- Renderer switching from Mol* to `xyzrender` must continue to preserve
  orientation through the existing reference-file workflow.

## Implementation Notes

- Shared viewer UI:
  - `PreviewExtension/Web/viewer-shell.js`
  - `PreviewExtension/Web/viewer.js`
  - `PreviewExtension/Web/viewer-runtime.css`
- Desktop/browser-dev contract:
  - `apps/desktop/src/types.ts`
  - `apps/desktop/src/App.tsx`
  - `apps/desktop/src/lib/browser-dev-documents.ts`
  - `apps/desktop/vite.config.ts`
- Tauri worker/runtime:
  - `apps/desktop/src-tauri/src/preview/runtime.rs`
  - `apps/desktop/src-tauri/src/preview/runtime_viewer.rs`
  - `apps/desktop/src-tauri/src/preview/xyzrender.rs`
- Quick Look bridge/worker:
  - `PreviewExtension/Platform/PreviewViewController.swift`

## Acceptance Criteria

- `xyzrender` exposes a `Tune` control without enlarging the default toolbar
  into a multi-row card.
- The advanced menu opens in the same place and with the same behavior in
  browser-dev, Tauri, and Quick Look.
- The main visible controls are the compact preview-safe set:
  - transparent background
  - gradients
  - fog
  - VdW
  - hide bonds
- Editing controls updates the active preview automatically and preserves the
  current document/tab.
- Runtime-supplied `customConfigPath` and `extraArguments` continue to work
  across Tauri, browser-dev, and Quick Look, minus the blocked unsafe flags,
  without turning the shared preview menu into a generic CLI editor.
- Existing checks continue to pass:
  - `npm run check:js`
  - `npm run test:ui`
  - `npm --prefix apps/desktop run typecheck`
  - `cargo check`
