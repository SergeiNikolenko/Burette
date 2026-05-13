# Shell Parity With Writer

## Summary

Burette's default app shell should use Writer Computer as the visual and
interaction baseline: translucent macOS chrome, traffic-light-aware controls,
floating top tabs, resizable sidebar, command palette, compact settings, and a
single work surface.

## Goals

- Match Writer's default shell geometry as closely as practical.
- Use the same product pattern: sidebar + top tab strip + main stage.
- Keep Burette molecule semantics in that shell.
- Preserve current Tauri, Swift Quick Look, and renderer behavior while the UI
  is migrated.

## Non-Goals

- Shipping Writer's markdown editor as a Burette feature.
- Replacing the Quick Look extension with a Tauri-only implementation.
- Moving Quick Look or macOS build assets under `apps/desktop`.

## Required Behavior

- The app opens to a Writer-like shell, not a marketing page.
- Tabs are top-level chrome. Molecule, Settings, and Launcher pages are tabs.
- The sidebar lists open and recent structures instead of workspace files.
- The command palette is a first-class entrypoint for app actions.
- The main stage renders Burette's viewer iframe or settings page.
- Development builds identify themselves as `Burette Dev` in the visible shell
  badge and native window title; production builds identify as `Burette`.
- The launcher/welcome state is a first-class component, not inline fallback
  markup inside the viewer.
- Active stage rendering goes through a page-kind registry with launcher,
  settings, and file/molecule pages.
- File/molecule page kinds marked as `keepAlive` remain mounted while inactive
  so renderer iframes are not torn down during tab switches.
- Tabs use a Writer-like tab object with `id`, `location`, `back`, and
  `forward`; active rendering comes from the active tab location.
- The top tab strip exposes Writer-like back/forward controls bound to the
  active tab's location history.
- The molecule session store exposes serialized tab snapshots through the
  page-kind serializer boundary.
- Persisted molecular file tabs refresh through Tauri `open_documents` on
  startup by source path so restored tabs do not depend on stale runtime cache
  artifacts.
- The shell root has an error boundary with a retry action.
- Overflowing chrome lists can use the shared scroll-fade helper.
- Shell icons use Writer's Hugeicons stack (`@hugeicons/react` plus
  `@hugeicons/core-free-icons`) rather than custom glyphs or ad hoc SVGs.

## Acceptance Criteria

- Visual layout has Writer-like titlebar spacing, tab positioning, sidebar
  behavior, and translucent surfaces.
- Visual tokens follow Writer's single-background model: one translucent app
  background, fg-on-transparent overlays, subtle sidebar divider, tab active
  overlay, and no separate bottom statusbar chrome.
- The frontend includes Writer-style `components/welcome`,
  `components/error-boundary.tsx`, `components/scroll-fade.tsx`, and
  `components/editor-area/page-kinds/` skeletons.
- The active stage renders through a tab-backed page stack and honors
  `pageKind.keepAlive` for molecular file tabs.
- `test:ui` checks the shell skeleton contracts, including page-kind registry,
  welcome, error boundary, scroll-fade, command palette, stores, tabs, and
  serialized molecule session snapshots plus startup runtime refresh wiring.
- Sidebar toggle, search, file rows, tab close, and open/new-tab controls use
  Hugeicons-style icons consistent with Writer.
- The command palette uses Writer-like grouped sections for suggested actions,
  renderer controls, recent structures, and open structures.
- Settings use Writer-like compact controls, including switch-style booleans,
  styled selects, and shared action buttons.
- Development browser sessions show a visible `Burette Dev` instance label so
  local test instances are not confused with production builds.
- Back and forward history controls are present in the top tab chrome and use
  Hugeicons-style arrow icons.
- `Cmd+O`, `Cmd+P`, `Cmd+\`, `Cmd+,`, `Cmd+W`, and numeric tab shortcuts still
  work.
- No Rust, Swift, Quick Look, bundle identifier, or build script behavior changes
  are required for the shell-parity slice.
