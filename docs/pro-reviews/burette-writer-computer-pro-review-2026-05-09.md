# ChatGPT Pro Review: Burette Writer Computer Migration

Source conversation: https://chatgpt.com/c/69ff901a-7f20-8387-bb1e-22b4cc0d12a8

## 1. Feasibility verdict

**Да, writer-computer реально можно использовать как “1:1 визуальный и структурный костяк” для Burette, но нельзя использовать как 1:1 engine.** Правильная формула миграции: **Writer shell, Burette molecule engine**.

Что можно переносить почти напрямую: layout philosophy, macOS transparent/HUD chrome, top tab strip, sidebar geometry, command palette, settings/theme-store pattern, docs/SPECs/release conventions, pnpm monorepo layout, Vite+/Tailwind v4 conventions. У writer-computer уже есть root-level `pnpm-workspace.yaml`, `vite-plus` orchestration, `apps/desktop`, `docs`, `SPECs`, and `scripts/distribute.sh` release flow.   

Что **нельзя** переносить 1:1: workspace/file-tree/editor engine. Writer’s core model is “open a folder, index files, edit Markdown, keep sessions, file watcher, file CRUD”; Burette’s core model is “open molecular files, generate runtime preview HTML/assets, render through iframe/Quick Look, preserve molecular renderer policy”. Writer’s `workspace-store.ts` and `editor-store.ts` are valuable as state-management patterns, but their domain logic is Markdown/workspace-specific.  

Самая важная граница: **Swift Quick Look extension stays owned by Burette**. Burette has explicit Quick Look content type declarations, `NSExtensionPointIdentifier = com.apple.quicklook.preview`, Swift `WKWebView` preview surface, renderer policy, and molecule-grid preview builder. None of that exists in writer-computer, so replacing it would be architectural regression, not migration.    

Also: **license risk is real.** writer-computer is GPL-3.0, while Burette is MIT. Directly copying Writer code into an MIT-distributed Burette repo is not a “minor detail”; either Burette must accept GPL-compatible distribution for copied code, or the migration should be implemented as clean-room reimplementation of structure/UX patterns.  

My verdict: **feasible and worthwhile, but do it as staged shell migration, not repo overwrite.** The dangerous move would be “replace Burette with writer-computer and then re-add molecules”; the safe move is “keep Burette runtime/Quick Look intact, progressively reshape UI/repo/build around Writer”.

---

## 2. Source-to-source mapping

| writer-computer source                                                 | Current role in Writer                                                                                                            | Burette target                                                               | Migration action                                                                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                         | Root `vite-plus` orchestration: `ready`, `dev`, `prepare`, `distribute`; pnpm 10.32.1; Node `>=22.12.0`.                          | root `package.json`                                                          | Adapt later. Keep Burette npm scripts during early phases; add pnpm/Vite+ only after UI and Quick Look are stable.                                          |
| `pnpm-workspace.yaml`                                                  | Monorepo packages: `apps/*`, `packages/*`, `tools/*`; dependency catalog for CodeMirror, Tailwind, cmdk, Tauri plugins, Zustand.  | new root `pnpm-workspace.yaml`                                               | Adapt. Add Burette-only catalog entries: `molstar`, `@rdkit/rdkit`, Tauri API/dialog/opener, maybe no CodeMirror/prosemark.                                 |
| `apps/desktop/package.json`                                            | Desktop React/Tauri package with `vite`, `tsc`, `tauri`, Tailwind, cmdk, Zustand, Tauri plugins.                                  | `apps/desktop/package.json` or current root package first                    | Adapt. Do not initially move Burette root `src`/`src-tauri`; first mirror dependency/style conventions.                                                     |
| `apps/desktop/src-tauri/tauri.conf.json`                               | Writer window chrome, updater, md file association, asset protocol scope, hardened runtime.                                       | `src-tauri/tauri.conf.json` / later `apps/desktop/src-tauri/tauri.conf.json` | Partially adapt. Copy window feel, not identifier, md file associations, updater key, asset scope, or minimum macOS blindly.                                |
| `apps/desktop/src-tauri/Cargo.toml`                                    | Rust backend with filesystem/search/image/store/updater/single-instance/webdriver deps.                                           | `src-tauri/Cargo.toml`                                                       | Selective adapt. `tauri-plugin-store`, updater, release profile may be useful; `notify`, `ignore`, `trash`, editor/file CRUD deps are not core for Burette. |
| `apps/desktop/src/App.tsx`                                             | Startup resolver -> Welcome or AppLayout; hooks for file watcher, keyboard, menu, drop; global CommandPalette.                     | `src/App.tsx`                                                                | Adapt structure. Replace workspace root with molecule session/open-docs startup.                                                                            |
| `apps/desktop/src/components/app-layout.tsx`                           | Writer’s core chrome: transparent full-window layout, drag region, sidebar toggle, floating tabs, resizable sidebar.              | `src/components/AppLayout.tsx` -> later `components/app-layout.tsx`           | Best first UI target. Reimplement with Burette state/actions.                                                                                               |
| `apps/desktop/src/App.css`                                             | Tailwind v4 import, CSS tokens, translucency, chrome sizing, scrollbar, cmdk styling.                                             | `src/styles.css` / `src/App.css`                                             | Adapt visually. Keep Burette viewer iframe and molecular CSS isolated.                                                                                      |
| `apps/desktop/src/components/sidebar/*`                                | Search button, file tree, workspace switcher, context menus.                                                                      | `src/components/sidebar/*`                                                   | Copy visual structure; replace file tree with molecule list/search/recent files. Do not copy rename/delete/create folder behavior.                          |
| `apps/desktop/src/components/editor-area/index.tsx`                    | Tab location router with keep-alive pages and footer.                                                                             | `src/components/stage/MoleculeStage.tsx`                                     | Adapt strongly. Use `viewer`, `settings`, `launcher` page kinds; keep iframe alive for active molecule tabs if useful.                                      |
| `apps/desktop/src/components/command-palette/*` + `stores/ui-store.ts` | cmdk command palette state and search/create intents.                                                                             | `src/components/command-palette/*`, `src/stores/ui-store.ts`                 | Good copy/adapt target. Commands become Open Structure, Search Structures, Renderer Mode, Settings, Reset Quick Look, Clear Cache.                          |
| `apps/desktop/src/stores/settings-store.ts`                            | Backend-hydrated settings, theme side effects, typed schema.                                                                      | `src/stores/settings-store.ts`                                               | Adapt. Map to Burette `ViewerPreferences` plus Quick Look/grid support prefs.                                                                               |
| `apps/desktop/src/stores/workspace-store.ts`                           | Workspace root, directory cache, recent workspaces, startup bundle, session save.                                                 | `src/stores/molecule-store.ts`                                               | Pattern only. Replace `root/directoryCache` with `documents/recentDocuments/openDocuments/status`.                                                          |
| `apps/desktop/src/stores/editor-store.ts`                              | Markdown files, tabs, history, save/reload/dirty state.                                                                           | `src/stores/tabs-store.ts`                                                   | Pattern only. Replace `OpenFile` with `ViewerDocument`; remove save/dirty/frontmatter/stat logic.                                                           |
| Burette `src-tauri/src/lib.rs`                                         | Actual molecular runtime engine: open docs, grid runtime, cache, Quick Look reset, logs, renderer resolution.                     | keep, then split into modules                                                | Preserve behavior. Refactor into modules after tests, not before.                                                                                           |
| Burette `PreviewExtension/*`                                           | Swift Quick Look extension, content types, renderer policy, grid preview.                                                         | keep outside monorepo app                                                    | Must not be overwritten. Only adjust paths if repo layout moves.                                                                                            |
| Burette `scripts/build.sh`, `scripts/install-local.sh`                 | Builds Tauri app, builds Xcode Quick Look extension, embeds `.appex`, signs, installs, registers Quick Look.                      | keep, then adapt carefully                                                   | This is a hard boundary. Every repo-layout change must update these scripts and pass ql tests.                                                              |

---

## 3. Target architecture

### Target repo layout

Recommended final shape:

```text
.
├── package.json
├── pnpm-workspace.yaml
├── .vite-hooks/
├── apps/
│   └── desktop/
│       ├── package.json
│       ├── index.html
│       ├── vite.config.ts
│       ├── src/
│       │   ├── App.tsx
│       │   ├── App.css
│       │   ├── components/
│       │   │   ├── app-layout.tsx
│       │   │   ├── window-title.tsx
│       │   │   ├── command-palette/
│       │   │   ├── sidebar/
│       │   │   │   ├── index.tsx
│       │   │   │   ├── molecule-browser.tsx
│       │   │   │   ├── molecule-list.tsx
│       │   │   │   └── molecule-list-item.tsx
│       │   │   ├── tabs/
│       │   │   │   └── molecule-tabs.tsx
│       │   │   ├── stage/
│       │   │   │   ├── molecule-stage.tsx
│       │   │   │   ├── preview-iframe.tsx
│       │   │   │   ├── preview-controls.tsx
│       │   │   │   └── welcome.tsx
│       │   │   └── settings/
│       │   ├── stores/
│       │   │   ├── molecule-store.ts
│       │   │   ├── tabs-store.ts
│       │   │   ├── settings-store.ts
│       │   │   └── ui-store.ts
│       │   ├── hooks/
│       │   │   ├── use-keyboard-shortcuts.ts
│       │   │   ├── use-menu-events.ts
│       │   │   ├── use-open-drop.ts
│       │   │   └── use-command-palette.ts
│       │   ├── lib/
│       │   │   ├── tauri.ts
│       │   │   ├── renderer-policy.ts
│       │   │   ├── paths.ts
│       │   │   └── theme.ts
│       │   └── types/
│       └── src-tauri/
│           ├── tauri.conf.json
│           ├── Cargo.toml
│           ├── capabilities/
│           ├── permissions/
│           └── src/
│               ├── lib.rs
│               ├── main.rs
│               ├── commands/
│               │   ├── documents.rs
│               │   ├── preview_cache.rs
│               │   ├── quicklook.rs
│               │   ├── settings.rs
│               │   ├── shell.rs
│               │   └── updater.rs
│               ├── preview/
│               │   ├── runtime.rs
│               │   ├── formats.rs
│               │   ├── grid.rs
│               │   ├── xyz.rs
│               │   └── assets.rs
│               ├── menu.rs
│               └── macos.rs
├── App/
├── PreviewExtension/
├── Burrete.xcodeproj
├── scripts/
├── docs/
├── SPECs/
├── samples/
└── tests/
```

Important nuance: **do not move to this layout in the first PR.** First get Writer-like UI while keeping current root `src/`, `src-tauri/`, `PreviewExtension/`, and scripts. Move into `apps/desktop` only after the Quick Look build/install path is green.

### Package manager / build tooling

Final target can use writer-computer’s pnpm + Vite+ model, but Burette’s current build scripts are still deeply tied to `npm`, `src-tauri`, `PreviewExtension/Web`, and Xcode. Burette’s root package currently owns molecular vendoring scripts, web preview tests, JS checks, Tauri build, and macOS build workflow; replacing it with Writer’s root `vp` scripts immediately would break too much at once.  

Target convention:

```jsonc
// root package.json, after migration
{
  "scripts": {
    "ready": "vp fmt && vp lint && vp run test -r && vp run build -r",
    "dev": "vp run desktop#dev",
    "prepare": "vp config",
    "distribute": "./scripts/distribute.sh",

    // Burette-specific compatibility aliases
    "build:macos": "bash scripts/build.sh",
    "install:macos": "bash scripts/install.sh",
    "test:web": "vp run desktop#test:web",
    "check:quicklook-assets": "vp run desktop#check:quicklook-assets"
  }
}
```

But early phases should keep the existing npm scripts exactly enough that `./scripts/build.sh` does not need a simultaneous rewrite.

### React component boundaries

Target boundaries should mirror Writer naming but keep Burette semantics:

```text
App
├── WindowTitle
├── CommandPalette
└── AppLayout
    ├── SidebarToggleButton
    ├── MoleculeTabs
    ├── Sidebar
    │   ├── MoleculeBrowser
    │   ├── MoleculeSearchButton
    │   ├── MoleculeList
    │   └── SidebarFooter
    └── MoleculeStage
        ├── WelcomePanel / LauncherPage
        ├── PreviewIframe
        ├── PreviewControls
        └── SettingsPage
```

`MoleculeStage` replaces Writer’s Markdown `EditorArea`. It should keep the useful Writer concept of **tab location routing**, but location kinds become:

```ts
type Location =
  | { kind: "launcher" }
  | { kind: "molecule"; documentId: string }
  | { kind: "settings" };
```

Do not model molecules as editable `OpenFile`. Burette already has `ViewerDocument` with `runtimePath`, `renderer`, `byteCount`, etc. 

### Zustand/store boundaries

Current Burette has one persisted store with `documents`, `activeDocumentId`, `sidebarOpen`, and `preferences`.  Target split:

```text
stores/molecule-store.ts
  documents
  recentDocuments
  openDocuments(paths)
  closeDocument(id)
  closeAllDocuments()
  reloadDocument(id)
  activeDocument lookup helpers

stores/tabs-store.ts
  tabs: Tab[]
  activeTabId
  openMoleculeTab(documentId)
  openSettingsTab()
  openLauncherTab()
  closeTab(tabId)
  navigateBack/Forward if useful

stores/settings-store.ts
  ViewerPreferences
  grid preview support prefs
  update prefs
  theme/css side effects

stores/ui-store.ts
  command palette open/search/intent
  sidebar collapsed/width
  transient status/drop state
```

Use Writer’s store style and hooks, not its Markdown-specific types. Writer’s `settings-store.ts` is the closest direct pattern because it cleanly separates backend hydration and theme side effects. 

### Rust/Tauri command boundaries

Current Burette Rust is doing too many things in one file, but it is the correct molecular engine. Split without changing behavior:

```text
commands/documents.rs
  startup_documents
  open_documents
  open_document

commands/preview_cache.rs
  clear_preview_cache
  open_logs_folder
  prune_runtime_dirs

commands/quicklook.rs
  reset_quick_look

commands/shell.rs
  open_external_url
  menu events

preview/formats.rs
  format_for_extension
  resolve_renderer
  stable_id
  file_title

preview/runtime.rs
  create_runtime
  copy_web_assets
  asset_url
  html builders

preview/grid.rs
  create_grid_runtime
  parsers for sdf/smi/csv/tsv

preview/xyz.rs
  xyz_first_frame
  xyz-fast helpers
```

Keep command names stable at first: `open_documents`, `startup_documents`, `clear_preview_cache`, `reset_quick_look`, `open_logs_folder`, `open_external_url`. The existing frontend depends on those names.  

### Swift Quick Look boundary

`PreviewExtension/` remains a separate Swift/Xcode product. It owns:

* `Info.plist` content types and `QLSupportedContentTypes`;
* `NSExtensionPointIdentifier = com.apple.quicklook.preview`;
* Swift `WKWebView` preview surface;
* renderer policy;
* molecule grid preview builder;
* `PreviewExtension/Web` vendored runtime assets.

Do not import React/Tauri UI into Quick Look. Quick Look should continue to render self-contained web assets via Swift/WKWebView.    

### Docs/spec layout

Adopt Writer’s `SPECs/` + `docs/` discipline:

```text
SPECs/
  shell-parity-with-writer.md
  molecule-session-model.md
  quicklook-extension-boundary.md
  renderer-runtime-contract.md
  release-and-signing.md

docs/
  architecture.md
  quicklook-debugging.md
  renderer-support.md
  releasing.md
  migration-from-root-to-apps-desktop.md
```

---

## 4. Migration phases

### Phase 0 — Freeze invariants before touching UI

Goal: make the current behavior reproducible.

Actions:

* Add `SPECs/migration-writer-shell.md`.
* Add a checklist of non-negotiables: Quick Look extension works, `PreviewExtension/Web` assets vendored, `open_documents` command stable, molecular file associations stable, bundle IDs stable.
* Record current command matrix: `npm run check:js`, `npm run test:web`, `npm run test:agent`, `npm run build:macos`, `./scripts/install.sh`.
* Add a small `samples/` smoke matrix for `pdb`, `cif`, `xyz`, `sdf`, `smi`, `csv`, `tsv`.

Verification after phase:

```sh
npm run check:js
npm run test:web
npm run test:agent
npm run build:macos
./scripts/install.sh
```

Then run Quick Look tests from the existing install script output, including forced content-type tests. 

### Phase 1 — Writer-like visual shell, no repo move

Goal: get Burette looking like Writer while preserving current root structure.

Actions:

* Replace the current CSS shell with Writer-style tokens: transparent background, `--chrome-control-height`, `--chrome-drag-height`, `--surface-*`, `--text-*`, cmdk styles, scrollbar behavior.
* Rework `src/components/AppLayout.tsx` to match Writer’s geometry: drag region, sidebar toggle, floating tab strip, resizable sidebar, main stage.
* Keep current Burette state/actions props so behavior is unchanged.
* Do **not** introduce `pnpm`, `apps/desktop`, or Vite+ yet.

Verification:

```sh
npm run build:web
npm run build:tauri
npm run build:macos
```

Manual: app opens, drag/drop opens molecule files, tabs work, settings work, iframe preview works.

### Phase 2 — Split Burette store into Writer-like stores

Goal: reduce the giant `App.tsx` coordination layer without changing UI behavior.

Actions:

* Split current `src/store.ts` into:

  * `src/stores/molecule-store.ts`
  * `src/stores/tabs-store.ts`
  * `src/stores/settings-store.ts`
  * `src/stores/ui-store.ts`
* Keep the persisted preference keys compatible with current `burrete.shell` until a deliberate migration is added.
* Move `openDocuments`, update state, and menu/drop handlers into hooks modeled after Writer’s `useMenuEvents`, `useOpenDrop`, and keyboard hooks.

Verification:

```sh
npm run build:web
npm run check:js
```

Manual: preferences survive restart; opening same file de-duplicates as before; active document selection is correct.

### Phase 3 — Component directory migration

Goal: make source shape match Writer.

Actions:

* Rename/reorganize:

  * `src/components/AppLayout.tsx` -> `src/components/app-layout.tsx`
  * `Sidebar.tsx` -> `components/sidebar/index.tsx`, `molecule-browser.tsx`, `molecule-list.tsx`
  * `EditorTabs.tsx` -> `components/tabs/molecule-tabs.tsx`
  * `ViewerArea.tsx` -> `components/stage/molecule-stage.tsx`, `preview-iframe.tsx`, `welcome.tsx`
  * `SettingsPage.tsx` -> `components/settings/settings-page.tsx`
* Add `components/command-palette/`.
* Keep Burette’s iframe strategy: `convertFileSrc(document.runtimePath)` and sandboxed iframe. 

Verification: same as Phase 2, plus UI regression screenshots if you add Playwright/WebDriver later.

### Phase 4 — Rust modularization, no behavior change

Goal: make Rust source maintainable before package-manager migration.

Actions:

* Split `src-tauri/src/lib.rs` into modules listed above.
* Keep command names and serialized types stable.
* Add Rust unit tests for:

  * `file_args_from_argv`
  * renderer policy resolution
  * grid parsers for SDF/SMILES/CSV/TSV
  * max file size rejection
  * `open_external_url` URL restriction

Verification:

```sh
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cd ..
npm run build:tauri
```

### Phase 5 — Command palette and menu parity

Goal: replace Burette’s sidebar search-only flow with Writer-like command UX.

Commands to add:

* `Open Structure…`
* `Search Open Structures`
* `Switch Renderer: Auto`
* `Switch Renderer: Mol*`
* `Switch Renderer: Fast XYZ`
* `Switch Renderer: xyzrender external`
* `Open Settings`
* `Close Active Structure`
* `Close All Structures`
* `Clear Preview Cache`
* `Reset Quick Look`
* `Open Logs Folder`
* `Check for Updates`

Map existing Burette actions, do not create new Rust commands unless needed. Existing frontend actions already cover most of this: choose files, settings, close/clear, reset Quick Look, logs, update check. 

Verification:

* `⌘P` opens command palette.
* Keyboard command can change renderer preference.
* Active molecule reloads after renderer preference change.
* Quick Look reset still calls the existing Rust command.

### Phase 6 — Move to `apps/desktop` and pnpm/Vite+

Goal: adopt Writer repo skeleton after product behavior is stable.

Actions:

* Move:

  * `src/` -> `apps/desktop/src/`
  * `src-tauri/` -> `apps/desktop/src-tauri/`
  * root `index.html`, `vite.config.ts`, `tsconfig*` -> `apps/desktop/`
* Add root `pnpm-workspace.yaml`.
* Add `apps/desktop/package.json`.
* Convert scripts/build paths:

  * old `src-tauri/target/...`
  * new `apps/desktop/src-tauri/target/...`
  * old `../PreviewExtension/Web` resource path in Tauri config
  * new relative path from `apps/desktop/src-tauri/tauri.conf.json` to root `PreviewExtension/Web`
* Preserve `App/`, `PreviewExtension/`, `Burrete.xcodeproj`, `scripts/`.
* Update `scripts/build.sh` and `scripts/install-local.sh` in the same PR as the move.

This is the phase most likely to break Quick Look. Burette’s current build script explicitly builds Tauri, builds the Xcode project, finds `BurretePreview.appex`, copies it into `Burrete.app/Contents/PlugIns`, and signs the final app. 

Verification must include full macOS build/install/Quick Look, not just `vite build`.

### Phase 7 — Release/updater conventions

Goal: adopt Writer’s release discipline without copying wrong updater identity.

Actions:

* Use Writer’s `docs/releasing.md` as process inspiration: version sync, signed/notarized macOS release, updater artifacts, draft GitHub release. 
* Do **not** copy Writer updater pubkey or endpoint.
* Decide whether Burette keeps its current manual GitHub update check or adopts Tauri updater artifacts.
* If adopting Tauri updater:

  * generate Burette updater key;
  * update `src-tauri/tauri.conf.json` endpoint to Burette releases;
  * decide notarization/hardened runtime for app + `.appex`;
  * add release script checks for embedded Quick Look extension.

Verification:

* Built app is signed.
* Embedded `.appex` is signed.
* `codesign --verify --deep --strict` passes.
* `spctl --assess` passes for notarized distribution.
* `latest.json` points to Burette, not Writer.

### Phase 8 — Docs and tests hardening

Goal: make future migrations boring.

Add tests/specs for:

* renderer routing;
* runtime HTML generation;
* grid parser behavior;
* Quick Look content type support;
* frontend store behavior;
* command palette commands;
* release/version sync;
* vendored asset presence.

---

## 5. What to copy directly, adapt, and never copy

### Copy directly only after license decision

Because Writer is GPL-3.0 and Burette is MIT, “direct copy” has licensing consequences. Technically good direct-copy candidates are:

* `SPECs/` and `docs/` style/conventions;
* command palette structure;
* CSS token philosophy;
* app layout geometry;
* release-doc structure;
* test/e2e directory pattern.

If Burette must remain MIT-only, reimplement these from scratch using Writer as behavioral reference, not copied source.

### Adapt

Adapt these heavily:

* `apps/desktop/src/components/app-layout.tsx` -> molecule app layout.
* `apps/desktop/src/components/sidebar/file-browser.tsx` -> molecule search/list sidebar.
* `apps/desktop/src/components/editor-area/index.tsx` -> molecule stage router.
* `apps/desktop/src/stores/workspace-store.ts` -> molecule session store pattern.
* `apps/desktop/src/stores/editor-store.ts` -> molecule tabs store pattern.
* `apps/desktop/src/stores/settings-store.ts` -> Burette preferences/settings backend.
* `apps/desktop/src-tauri/tauri.conf.json` -> only window/release conventions, not identity/file associations/resources.

### Must not be copied

Do not copy or overwrite:

* Writer’s Markdown editor, CodeMirror/prosemark stack, frontmatter logic.
* Writer’s file tree CRUD: create, rename, delete, trash, duplicate, folder watcher.
* Writer’s md/markdown file associations.
* Writer’s updater pubkey, GitHub endpoint, product identifier.
* Writer’s broad asset protocol scope `"**"` unless you deliberately accept the security tradeoff.
* Writer’s Tauri config as a whole.
* Burette’s `PreviewExtension/`, `App/`, `Burrete.xcodeproj`, `scripts/build.sh`, `scripts/install-local.sh`.
* Burette’s `PreviewExtension/Web` vendored asset assumptions.
* Burette’s current Rust molecular runtime paths.

---

## 6. UI/UX parity plan

Target: Burette should feel like Writer, but say “molecules”, not “documents”.

### Shell

Use Writer’s structure:

* transparent macOS HUD window;
* hidden title;
* traffic lights aligned top-left;
* top drag region;
* sidebar toggle near traffic lights;
* floating tab strip that shifts when sidebar collapses;
* resizable sidebar;
* command palette centered with blur/translucency;
* subtle scrollbars and CSS-variable-driven theme.

Burette’s current Tauri config already has a transparent HUD-like window, hidden title, and `macOSPrivateApi`; Writer’s config has a very similar visual direction, so this is a natural convergence.  

### Sidebar

Replace Writer’s `FileBrowser/FileTree` with:

```text
MoleculeBrowser
├── Search button / command palette trigger
├── Open Structures section
│   ├── molecule title
│   ├── renderer badge: Mol*, Fast XYZ, xyzrender, Grid 2D
│   ├── file extension
│   ├── byte count
│   └── close action
├── Recent Structures section
└── footer: Settings / Logs / Quick Look
```

Keep Writer’s visual search button with `⌘P`, not its directory tree behavior. Writer’s file browser is tightly coupled to workspace root and directory cache, while Burette’s sidebar is already an open-structures list.  

### Tabs

Replace Writer’s Markdown tabs with molecule tabs:

```text
[Molecule title] [renderer badge] [close]
[Settings]
[+]
```

The `+` opens structure files, not a new Markdown tab. Existing Burette tabs already map naturally to documents plus settings. 

### Viewer stage

Use Writer’s `EditorArea` routing pattern, but pages become:

* `launcher`: welcome/open structure;
* `molecule`: preview iframe;
* `settings`: settings page.

The iframe remains Burette’s `PreviewIframe`, fed by `convertFileSrc(document.runtimePath)`. That is the core bridge from Rust-generated runtime HTML to React UI. 

### Preview controls

Add a Writer-looking footer/control bar for active molecule:

```text
Renderer: Auto / Mol* / Fast XYZ / xyzrender
Background: Auto / Black / Graphite / White / Transparent
XYZ style: Default / Wire / Tube / Spacefill
Open in Finder
Reload
Clear cache
```

For grid previews:

```text
Grid 2D
Records: included / total
Search / substructure search
Export
Page size
```

This maps to Burette’s current renderer preferences and grid capabilities, not Writer’s document stats/footer. Burette’s grid runtime already emits capabilities like selection, export, substructure search, and renderer switch. 

### Settings

Make Burette settings visually like Writer but keep Burette sections:

* Appearance;
* Renderer;
* Grid preview;
* Quick Look;
* Updates;
* Maintenance.

Current Burette settings already include appearance, renderer, updates, and maintenance actions. 

---

## 7. Risks

### Tauri / Swift / Quick Look packaging

Highest risk. Burette’s build is not “plain Tauri build”; it builds Tauri, builds Xcode, extracts `BurretePreview.appex`, embeds it under `Burrete.app/Contents/PlugIns`, signs the final app, then install script registers the extension and resets Quick Look. Any move from root `src-tauri` to `apps/desktop/src-tauri` must update those paths.  

### Bundle identifiers and content types

Do not replace `com.local.BurreteV10` / `com.local.BurreteV10.Preview` accidentally. Do not remove molecular UTI declarations or `QLSupportedContentTypes`. A Writer-style md association would be wrong for Burette.  

### Vendored molecular assets

Burette’s build script requires `PreviewExtension/Web/molstar.js`, `molstar.css`, `burette-agent.js`, `viewer.js`, `grid-viewer.js`, `grid.css`, RDKit JS/WASM, and `xyz-fast.js`. Package-manager migration must preserve those asset paths or update every consumer. 

### pnpm / Vite+ migration

Writer uses pnpm 10.32.1, Node `>=22.12.0`, `vite-plus`, and catalog dependencies. Burette currently uses npm scripts and has vendoring/build scripts wired to npm. Move to pnpm only after the build scripts are ready.  

### Release/updater/signing

Writer’s release process is signed/notarized and updater-artifact-oriented; Burette currently has its own update preference/check path and local signing workflow. Copying Writer’s updater config would point to the wrong repo/key.  

### Tests

Writer has stronger app-structure/test conventions; Burette has critical macOS integration tests embedded in scripts. The risk is adding frontend tests but silently losing Quick Look behavior. The verification plan must keep `qlmanage`, `pluginkit`, and codesign checks first-class.

---

## 8. Verification plan

### Lightweight checks

Run after every frontend/store phase:

```sh
npm run check:js
npm run build:web
npm run test:web
npm run test:agent
```

After Rust refactors:

```sh
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cd ..
npm run build:tauri
```

After pnpm migration:

```sh
pnpm install
pnpm ready
pnpm --filter desktop build
pnpm --filter desktop tauri build
```

### macOS-specific checks

Run after every phase that touches `src-tauri`, `PreviewExtension`, scripts, bundle config, assets, or repo layout:

```sh
./scripts/build.sh
./scripts/install.sh
pluginkit -m -p com.apple.quicklook.preview | grep -i Burrete
qlmanage -r
qlmanage -r cache
killall quicklookd || true
```

Forced Quick Look checks, matching the install script:

```sh
qlmanage -p -c com.local.burrete10.pdb samples/mini.pdb
qlmanage -p -c com.local.burrete10.cif samples/mini.cif
qlmanage -p -c dyn.ah62d4rv4ge81u8p4 samples/mini.xyz
```

Normal Finder-style checks:

```sh
qlmanage -p samples/mini.pdb
qlmanage -p samples/mini.cif
qlmanage -p samples/mini.xyz
qlmanage -p samples/<small>.sdf
qlmanage -p samples/<small>.smi
qlmanage -p samples/<small>.csv
qlmanage -p samples/<small>.tsv
```

Bundle checks:

```sh
test -d build/Burrete.app/Contents/PlugIns/BurretePreview.appex
codesign --verify --deep --strict build/Burrete.app
/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' build/Burrete.app/Contents/Info.plist
```

Manual UI checks:

* launch app;
* open via dialog;
* drag/drop molecule files;
* open from command palette;
* switch renderer;
* open settings tab;
* clear preview cache;
* reset Quick Look;
* open logs;
* quit/relaunch and verify persisted preferences;
* verify active preview reloads after renderer/background preference changes.

---

## 9. First implementation slice

The smallest good first PR is **not** “move to monorepo”. The smallest good first PR is:

> **Writer-style visual shell + command palette scaffold, zero changes to Rust, Swift, Quick Look, package manager, or build scripts.**

Touch only:

```text
src/App.tsx
src/styles.css or src/App.css
src/components/AppLayout.tsx
src/components/Sidebar.tsx
src/components/EditorTabs.tsx
src/components/ViewerArea.tsx
src/components/command-palette/index.tsx      new
src/stores/ui-store.ts                        new
src/hooks/useCommandPalette.ts                new
SPECs/migration-writer-shell.md               new
```

What this PR does:

* Introduces Writer-like CSS variables and transparent shell styling.
* Reworks visual layout to Writer geometry.
* Adds command palette opened by `⌘P`.
* Keeps current `useAppStore`, `open_documents`, iframe preview, settings, build scripts, Quick Look extension untouched.
* Adds command entries wired to existing actions:

  * Open Structure;
  * Search Structures;
  * Settings;
  * Renderer Auto/Mol*/Fast XYZ/xyzrender;
  * Clear Cache;
  * Reset Quick Look;
  * Open Logs.

What this PR must **not** do:

* no `apps/desktop` move;
* no pnpm/Vite+ migration;
* no Tauri config rewrite except maybe harmless window geometry tuning;
* no Rust modularization;
* no Swift/Info.plist edits;
* no release/updater changes.

Acceptance criteria:

```sh
npm run check:js
npm run build:web
npm run build:tauri
./scripts/build.sh
./scripts/install.sh
qlmanage -p samples/mini.pdb
qlmanage -p samples/mini.cif
qlmanage -p samples/mini.xyz
```

That first slice gives you visible Writer parity quickly while protecting the hard macOS/Quick Look boundary. After that, the migration can proceed phase-by-phase instead of turning into a “beautiful app, broken Finder previews” situation.
