# Shared molecular editor

`@burette/molecular-frame` owns the 2D editor and its 3D switch. Atlas,
the desktop application, the platform and the packaged MCP workspace consume
the same built directory. The 3D switch uses `apps/burette-embed`.

## Build

Run `bun run build:molecular-frame` from the repository root. This builds the
3D runtime, Rust/WASM core and frame, then stages the frame for desktop and
plugin packaging. `dist/manifest.json` records the content version and asset
hashes. Deploy the complete directory together. Consumer integrations should
verify the manifest before packaging.

## Host integration

Give the container an explicit height and import the client from the staged
directory.

```js
import { createMolecularEditor } from '/molecular-frame/molecular-frame.js';

const editor = createMolecularEditor(container, { onOpenFile: openFile });
await editor.load('CC(=O)Oc1ccccc1C(=O)O');
const { molfile, smiles, state } = await editor.snapshot();
// Call editor.destroy() when the host unmounts the component.
```

The public contract is `public/molecular-frame.d.ts`. The asynchronous API
supports loading, snapshots, SVG export, commands, zoom and change/state/error
events. The synchronous `editor` property requires a ready same-origin frame.
MCP hosts provide `BuretteMcpWorkspace` to resolve packaged assets.

The host supplies `--background`, `--foreground`, `--popover`, `--muted`,
`--muted-foreground`, `--accent`, `--border` and `--destructive` on the container,
plus its computed font family. Theme comes from the document's `dark` class or
the container's color scheme, and locale comes from the document language.
Ancestor class/style/lang changes synchronize appearance in place.
`syncAppearance()` handles other host-driven CSS changes. The 3D API exposes
`setTheme` and `setAppearance` through the embed client.

## Format and recovery boundaries

The desktop adapter in `apps/desktop/src/components/molecular-editor.tsx` owns
format conversion through `molecular-codecs.ts`, including KET drafts and
interchange formats. It cancels obsolete imports before applying their results.
Unsupported chemical properties are rejected before changing the drawing.
The desktop page routes reaction documents to its lazy reaction editor.
Direct reaction paste into the shared molecular canvas is rejected.

Core checks run with `cargo test --manifest-path apps/molecular-frame/core/Cargo.toml`.
The shared 3D browser contract is tested by `tests/test-embed-viewer-browser.mjs`.
Browser, packaged MCP transport and native Tauri acceptance are separate checks.
