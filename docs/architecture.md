# Burette Architecture

## Product Shape

Burette is a macOS molecular preview product with a Writer-like desktop shell.
The shell owns navigation, tabs, command palette, settings, recents, and window
chrome. The molecular engine remains Burette-specific and owns preview runtime
generation, Quick Look integration, renderer selection, and molecule grid
support.

## Repository Boundaries

- `apps/desktop/` owns the React desktop application.
- `apps/desktop/src-tauri/` owns the Tauri desktop shell and IPC backend.
- `PreviewExtension/` owns the Swift Quick Look preview extension and the
  Finder runtime.
- `PreviewExtension/Web/` owns the self-contained web preview runtime used by
  Quick Look.
- `App/` and `Burrete.xcodeproj` own the native macOS wrapper used to build the
  preview extension.
- `scripts/` owns build, install, release, vendor, preview, and diagnostic
  workflows.
- `SPECs/` owns migration and product contracts.

Root scripts remain the public command surface. They delegate into
`apps/desktop` where needed so the repository can keep Writer-style app
organization without hiding Burette's macOS packaging boundary.

## Desktop Shell

The desktop UI starts at `apps/desktop/src/App.tsx` and is composed through
Writer-style surfaces:

- `components/app-layout.tsx` owns the main shell frame.
- `components/sidebar/` owns open documents, recents, and sidebar search.
- `components/editor-area/` owns tabs and the active preview stage.
- `components/editor-area/page-kinds/` owns the Writer-style page-kind registry
  for launcher, settings, and molecular file pages.
- `components/welcome/` owns the launcher page shown before a structure is
  opened.
- `components/command-palette/` owns command search and keyboard navigation.
- `components/settings-panel/` owns renderer, update, cache, and Quick Look
  settings.
- `components/error-boundary.tsx` protects the shell root from component
  crashes and provides a local retry surface.
- `components/scroll-fade.tsx` provides the shared overflow fade used by chrome
  lists.
- `components/window-title/` owns the native window title bridge.

Development builds set the native window/browser title and sidebar footer to a
worktree-specific `Burette Dev` label. Production builds keep the visible
product name as `Burette`. The label is intentionally kept out of the top chrome
so Writer Computer's tab strip geometry remains unchanged during visual parity
work.

State is split by responsibility:

- `stores/ui-store.ts` owns command palette UI state.
- `stores/shell-store.ts` owns shell chrome state such as sidebar visibility and
  width.
- `stores/molecule-store.ts` owns open molecular documents, active tab, and
  recent structures. It uses a Writer-like tab model:
  `Tab { id, location, back, forward }`, where locations are launcher, settings,
  or molecular file pages.
- `stores/settings-store.ts` owns viewer preferences.

Hooks under `apps/desktop/src/hooks/` provide the Writer-like access layer for
commands, tabs, sidebar state, settings, menu events, startup events, and drag
and drop.

Active stage rendering goes through `pageKind(location)` from the active tab
rather than ad hoc branching in `ViewerArea`. The current locations are:

- `launcher`: transient welcome page; not serialized.
- `file`: molecular preview page backed by a generated iframe runtime and a
  stable source path.
- `settings`: persistent settings page.

This keeps Writer's extension point while preserving Burette's molecule-specific
document model.

The editor area renders a tab-backed page stack. Page kinds that opt into
`keepAlive`, currently molecular file pages, remain mounted while inactive so
their iframe runtime state is preserved across tab switches.

The store exposes a serialized session snapshot through
`getMoleculeSessionSnapshot`, using the same page-kind serializer boundary as
Writer. On Tauri startup, persisted file tabs are refreshed through
`open_documents` by source path so iframe runtime artifacts are regenerated
instead of trusting stale cache paths. The tab/session layer owns shell
navigation state; the Tauri preview pipeline still owns molecular runtime
generation.

The tab strip includes Writer-like back/forward controls. The controls are
driven by each tab's `back` and `forward` location stacks and are disabled when
the active tab has no history.

## Tauri Backend

The Tauri entrypoint is intentionally thin:

- `apps/desktop/src-tauri/src/lib.rs` wires plugins, menu, startup handling, and
  IPC commands.
- `commands/` exposes stable Tauri commands used by the React shell, grouped by
  shell responsibility: startup, documents, preview cache, external shell
  actions, and Quick Look reset.
- `menu.rs` owns native menu construction and menu-to-window event routing.
- `startup.rs` owns launch argument parsing and startup open events.
- `preview/` owns molecular preview runtime generation.

The preview modules are split by responsibility:

- `preview/runtime.rs` is the stable document-open API coordinator.
- `preview/runtime_grid.rs` owns grid collection parsing and grid runtime
  generation for CSV/TSV/SMI/SDF-like inputs.
- `preview/runtime_viewer.rs` owns normal viewer runtime generation, bundled
  web asset copying, generated HTML/data/metadata artifacts, and cache paths.
- `preview/runtime_utils.rs` owns shared runtime path, escaping, clipping, and
  cache-pruning helpers.
- `preview/formats.rs` maps file extensions to renderer format capabilities.
- `preview/xyz.rs` parses the first XYZ frame for the fast renderer.
- `preview/xyzrender.rs` discovers and runs external `xyzrender`.

Command names should remain stable because the React shell, menus, and tests use
them as the IPC contract.

## Quick Look Boundary

Quick Look remains a Swift extension boundary. The bundle identifier stays:

```text
com.local.BurreteV10.Preview
```

Build scripts embed `BurretePreview.appex` into the final Tauri app bundle at:

```text
build/Burrete.app/Contents/PlugIns/BurretePreview.appex
```

Finder previews load the runtime from `PreviewExtension/Web/`. The Tauri desktop
app may generate similar runtime artifacts for its iframe viewer, but it must not
move or weaken the extension runtime without a dedicated Quick Look migration.

## Verification Matrix

Use lightweight checks for shell-only changes:

```bash
npm run check:js
npm run test:ui
npm run build:web
```

Use Rust checks for Tauri/backend changes:

```bash
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Use full macOS checks when bundle layout, Quick Look, Tauri config, Swift,
vendored assets, or build scripts change:

```bash
./scripts/build.sh
codesign --verify --deep --strict build/Burrete.app
test -d build/Burrete.app/Contents/PlugIns/BurretePreview.appex
```
