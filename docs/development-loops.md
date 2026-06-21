# Development Loops

Burrete has several edit loops. Use the narrowest loop that matches the layer
you changed.

For strict agent-facing server startup, browser Quick Look URLs, tokenized
preview sessions, and contract test levels, use
[Testing surfaces](tools/testing-surfaces.md).

## Desktop React UI

Use the UI-only design loop for layout, styling, panels, tabs, empty states, and
other frontend work that does not need native Tauri behavior:

```bash
bun run design
```

This starts the Vite desktop frontend directly. It is the fastest loop for
visual design because it does not build the Tauri, Rust, or Swift layers.

Use Tauri dev mode when changing `apps/desktop/src/*` and the native shell
matters:

```bash
bun run dev:tauri
```

In this mode Tauri launches the native desktop shell and loads the frontend from
the Vite dev server at `http://127.0.0.1:1420`. React changes can use Vite's dev
server instead of rebuilding the packaged `.app`.

Use a packaged rebuild only when the change must be verified in the final bundle:

```bash
bun run build:tauri
```

## Parallel Dev App Identities

Use a dev flavor when multiple local worktrees need to build and install Burrete
without competing for the same Launch Services and Quick Look bundle IDs.
Agents must treat this as the default for any packaged local build or install:

```bash
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/build.sh
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/install.sh
```

This keeps the release identifiers untouched, but writes the local build to
`build/Burrete-chat85b0.app`, installs it as
`~/Applications/Burrete-chat85b0.app`, and uses isolated identifiers such as
`com.local.BurreteV10.Dev.chat85b0.Preview` and
`com.local.burrete10.dev.chat85b0.pdb`.

Use the same flavor for forced preview and diagnostics:

```bash
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/force-preview.sh samples/mini.pdb
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/diagnose.sh samples/mini.pdb
```

`scripts/build-dev.sh` intentionally does not support `BURRETE_DEV_FLAVOR`
because it builds in-place and must not rewrite source-tree bundle identifiers.

## Preview Web Assets

Use the web asset patch loop when changing `PreviewExtension/Web/*`, including
the grid viewer:

```bash
bun run patch:web-assets
```

This copies `PreviewExtension/Web` into the desktop viewer runtime and Quick
Look bundle locations, then re-signs the app:

- `build/Burrete.app/Contents/Resources/ViewerWeb`
- `build/Burrete.app/Contents/PlugIns/BurretePreview.appex/Contents/Resources/Web`

For agent-driven work in a flavored build, set `BURRETE_APP_PATH` to the
flavored app path before patching.

Restart Burrete or reopen the preview after patching so the WebView reloads the
updated files.

## Quick Look Native Extension

Use the flavored full build when the Swift Quick Look extension or extension
packaging changed in an agent-managed worktree:

```bash
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/build.sh
```

`scripts/build-dev.sh` remains available for a deliberately unflavored in-place
debug loop, but agents should not use it unless the user explicitly asks for
that path. When Swift and extension packaging did not change and an unflavored
in-place build is explicitly desired, reuse the existing embedded preview
extension:

```bash
BURRETE_DEV_REUSE_QUICKLOOK=1 ./scripts/build-dev.sh
```

## Rust and Tauri Backend

Changes under `apps/desktop/src-tauri/src/*` or `crates/*` require Cargo/Tauri to
rebuild the native binary. Use Tauri dev mode for the shortest debug loop:

```bash
bun run dev:tauri
```

Use Rust checks before publishing backend changes:

```bash
bun run check:rust
```

## Remote Lightweight Checks

Use the remote check loop for Node-only contract checks without spending local
CPU on them:

```bash
bun run check:remote
```

To target a specific SSH alias:

```bash
bun run check:remote gauss
```

The remote check syncs a lightweight checkout, excludes build outputs and local
caches, then runs:

```bash
node tests/test-ui-shell-contract.mjs
node tests/test-tauri-structure.mjs
```

## Full Bundle Build

Use the full macOS build only for final bundle validation, release work, or
changes that cross several native layers:

```bash
BURRETE_DEV_FLAVOR=chat85b0 ./scripts/build.sh
```

The full build runs the JavaScript/Tauri build, Rust release build, Xcode Quick
Look builds, bundle assembly, signing, and bundle validation.

Run unflavored `./scripts/build.sh` only when explicitly producing a release or
final non-dev bundle.
