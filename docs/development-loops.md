# Development Loops

Burrete has several edit loops. Use the narrowest loop that matches the layer
you changed.

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

## Preview Web Assets

Use the web asset patch loop when changing `PreviewExtension/Web/*`, including
the grid viewer:

```bash
bun run patch:web-assets
```

This copies `PreviewExtension/Web` into both bundle locations and re-signs the
app:

- `build/Burrete.app/Contents/Resources/Web`
- `build/Burrete.app/Contents/PlugIns/BurretePreview.appex/Contents/Resources/Web`

Restart Burrete or reopen the preview after patching so the WebView reloads the
updated files.

## Quick Look Native Extension

Use the dev build when the Swift Quick Look extension or extension packaging
changed:

```bash
./scripts/build-dev.sh
```

When Swift and extension packaging did not change, reuse the existing embedded
preview extension:

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
./scripts/build.sh
```

The full build runs the JavaScript/Tauri build, Rust release build, Xcode Quick
Look builds, bundle assembly, signing, and bundle validation.
