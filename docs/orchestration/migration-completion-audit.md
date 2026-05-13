# Writer Computer Migration Completion Audit

Date: 2026-05-12

## Objective

Make Writer Computer the Burette skeleton, interface baseline, repository
reference, documentation/spec system, and staged migration model while preserving
Burette molecular rendering and the macOS Quick Look extension.

## Completion Criteria

1. Writer Computer source and review material are represented in local planning
   artifacts.
2. Burette has active specs and docs that adapt Writer concepts without
   replacing Burette's molecular domain.
3. The default app shell is Writer-like: translucent macOS chrome, sidebar, top
   tabs, command palette, compact settings, and Writer-style controls/icons.
4. Writer-like tabs/session/routing replace the old single viewer branch while
   preserving molecule viewer semantics.
5. The command palette exposes Burette molecular actions and keyboard flow.
6. State is split into Writer-like stores/hooks without importing Writer's
   markdown/workspace engine.
7. Repository layout has moved toward Writer's `apps/desktop` shape while
   keeping Burette-owned macOS and Quick Look boundaries.
8. Rust/Tauri runtime modules are organized into clear command and preview
   boundaries.
9. Mol* and other molecular renderers remain available and do not overlap the
   Writer-like shell chrome.
10. Packaging still builds a signed app bundle with the Quick Look extension
    embedded under `Contents/PlugIns`.
11. Verification covers frontend, backend structure, release checks, bundle
    layout, and live browser smoke checks.
12. End-to-end installed Finder Quick Look preview behavior is verified.

## Prompt-to-Artifact Checklist

| Prompt requirement | Artifact or command inspected | Current evidence | Status |
| --- | --- | --- | --- |
| Treat Writer Computer as the skeleton/interface reference | `/private/tmp/writer-computer-ref` at `origin/master` commit `64c20bd`; `docs/pro-reviews/*writer-computer*`; `docs/writer-originals/`; `SPECs/writer-originals/` | Reference clone, Pro review, and Writer docs/spec snapshots are present. | Covered as reference |
| Preserve Burette molecular rendering | `PreviewExtension/Web/`, `apps/desktop/src-tauri/src/preview/`, `scripts/test-web-preview.sh`, `tests/test-agent-preview-server.mjs` | Mol*, Fast XYZ, xyzrender, RDKit/grid assets and renderer contracts remain in source and tests. | Covered by source/static checks |
| Preserve macOS Quick Look extension | `PreviewExtension/`, `apps/desktop/src-tauri/src/commands/quicklook.rs`, `scripts/build.sh`, `scripts/force-preview.sh` | Extension id and forced content types are documented; build embeds `.appex`; installed Finder verification is paused. | Source covered, installed E2E missing |
| Migrate to Writer-like app shell | `apps/desktop/src/components/app-layout.tsx`, `apps/desktop/src/styles.css` | Translucent shell, sidebar, top tab strip, `132px` collapsed tab offset, and dev instance title/sidebar identity are implemented. | Structurally covered, pixel parity weak |
| Migrate tabs/session model | `apps/desktop/src/components/editor-area/`, `apps/desktop/src/stores/molecule-store.ts`, `apps/desktop/src/hooks/use-tabs.ts` | Launcher/settings/file tabs, history navigation, keep-alive page kinds, and molecule session persistence are implemented. | Covered |
| Migrate command palette | `apps/desktop/src/components/command-palette/index.tsx`, `SPECs/command-palette.md`, `docs/keyboard-shortcuts.md` | Molecular commands, renderer switching, recent/open structures, logs, Quick Look reset, settings, and keyboard flow are represented. | Covered by source/static checks |
| Split stores/hooks like Writer | `apps/desktop/src/stores/`, `apps/desktop/src/hooks/` | `ui-store`, `shell-store`, `molecule-store`, and `settings-store` replace the old single app store shape. | Covered |
| Move toward Writer repo shape | `apps/desktop/`, `pnpm-workspace.yaml`, removed old root frontend/Tauri files | Desktop frontend and Tauri package live under `apps/desktop`; npm remains the verified runner. | Covered with pnpm parity deferred |
| Keep packaging/release gates | `scripts/build.sh`, `scripts/ci.sh`, `package.json`, `apps/desktop/src-tauri/tauri.conf.json` | `build:web`, `test:tauri-structure`, and prior signed bundle checks pass; final install verification is paused. | Build covered, install E2E missing |
| Verify end-to-end behavior | `http://127.0.0.1:1421/`, `./scripts/force-preview.sh`, Finder Quick Look | Current dev server serves this worktree; Finder/qlmanage pass is intentionally paused to avoid competing shared app registration. | Incomplete |

## Evidence Matrix

| Criterion | Evidence | Status |
| --- | --- | --- |
| Writer reference material | `docs/pro-reviews/burette-writer-computer-pro-review-2026-05-09.raw.md`, `docs/pro-reviews/burette-writer-computer-pro-review-2026-05-09.md`, `SPECs/writer-originals/`, `docs/writer-originals/` | Covered |
| Active Burette specs/docs | `SPECs/*.md`, `docs/architecture.md`, `docs/renderer-support.md`, `docs/quicklook-debugging.md`, `docs/releasing.md`, `docs/migration-roadmap.md` | Covered |
| Writer-like shell | `apps/desktop/src/components/app-layout.tsx`, `apps/desktop/src/styles.css`, `apps/desktop/src/components/sidebar/index.tsx`, `apps/desktop/src/components/editor-area/editor-tabs.tsx`; top chrome keeps Writer's `132px` collapsed tab offset and sidebar footer is a single Writer-like bottom row using Writer's switcher glyph while dev identity is centralized in `apps/desktop/src/lib/instance.ts` for the window title/sidebar footer | Partially covered |
| Writer-like controls/icons | Hugeicons usage in sidebar/app layout; `components/settings-panel/setting-control.tsx`; browser verified named `Automatic checks` switch and grouped command palette | Covered |
| Tabs/session/routing | `components/editor-area/page-kinds/`, `stores/molecule-store.ts`, `hooks/use-tabs.ts`, `pageKind.keepAlive` checks in `tests/test-ui-shell-contract.mjs` | Covered |
| Command palette | `components/command-palette/index.tsx`, `stores/ui-store.ts`, `hooks/use-command-palette.ts`, `SPECs/command-palette.md`; browser verified `Suggested` and `Renderer` groups | Covered |
| Store split | `stores/ui-store.ts`, `stores/shell-store.ts`, `stores/molecule-store.ts`, `stores/settings-store.ts`, plus hook wrappers | Covered |
| Repository layout | `apps/desktop/`, `apps/desktop/src-tauri/`, `pnpm-workspace.yaml`; old root frontend/Tauri files removed | Covered |
| Rust/Tauri modularization | `apps/desktop/src-tauri/src/commands/`, `preview/runtime*.rs`, `menu.rs`, `startup.rs`; `tests/test-tauri-structure.mjs` | Covered |
| Molecular renderer preservation | `preview/formats.rs`, `preview/runtime_viewer.rs`, `preview/runtime_grid.rs`, `preview/xyz.rs`, `preview/xyzrender.rs`; `npm run ci` includes JS/agent/tauri structure checks | Covered by static/build checks |
| Mol* shell non-overlap | `.molecule-stage { inset: var(--chrome-height) 0 0; }`; `runtime_viewer.rs`, `PreviewExtension/Web/index.html`, and `PreviewExtension/Platform/PreviewViewController.swift` icon-only collapsed toolbar CSS; `tests/test-ui-shell-contract.mjs`, `tests/test-tauri-structure.mjs`, `scripts/test-web-preview.sh --no-open samples/mini.pdb`, and agent-preview browser DOM checks | Covered by static/browser/source checks |
| Packaging | `npm run ci` passed; `codesign --verify --deep --strict build/Burrete.app` passed; app id `com.local.BurreteV10`; embedded appex id `com.local.BurreteV10.Preview`; `scripts/build.sh` now fails if final `build/Burrete.app/Contents/Resources/Web/index.html` contains the legacy toolbar | Covered |
| Live browser smoke | `http://127.0.0.1:1421/` currently served by this worktree with dev label `Burette Dev 8a18`; named settings switch and command palette groups were previously browser-verified | Covered |
| Installed Finder Quick Look preview | Paused for this slice because multiple parallel test instances were active and the user asked not to compete for the shared installed app name/Quick Look registration. Source/build gates cover generated HTML, but installed Finder/qlmanage rendering still needs a coordinated single-instance pass. | Missing |
| Pixel-perfect Writer visual parity | No screenshot/pixel comparison against Writer has been performed; user-provided screenshot path was unavailable. | Weak |
| Full package-manager parity | `pnpm-workspace.yaml` exists, but npm remains the verified build path by design. pnpm/Vite+ parity is not complete. | Deferred |

## Latest Verification

- `npm run test:ui`: passed after adding regression checks for Writer-like top chrome and single-row sidebar footer CSS.
- `npm run check:js`: passed.
- `npm --prefix apps/desktop run typecheck`: passed after restoring Writer-like top chrome, single-row sidebar footer, and Writer switcher glyph.
- `npm run test:tauri-structure`: passed after single-row sidebar footer change.
- `./scripts/test-web-preview.sh --no-open samples/mini.pdb`: passed.
- `npm run build:web`: passed after single-row sidebar footer change.
- `npm run ci`: passed.
- `codesign --verify --deep --strict build/Burrete.app`: passed.
- `test -d build/Burrete.app/Contents/PlugIns/BurretePreview.appex`: passed.
- `/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' build/Burrete.app/Contents/Info.plist`: `com.local.BurreteV10`.
- `/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' build/Burrete.app/Contents/PlugIns/BurretePreview.appex/Contents/Info.plist`: `com.local.BurreteV10.Preview`.
- Current dev server on `http://127.0.0.1:1421/`: source modules expose `Burette Dev 8a18` through `apps/desktop/src/lib/instance.ts`.

## Not Complete Yet

The goal should not be marked complete yet. The strongest remaining gaps are:

- Install the freshly built app and run forced Finder Quick Look previews for
  representative fixtures after the current repo-layout and UI migration.
- Add or run a stronger browser/native E2E path for opening real molecular
  samples through the shell and switching tabs/renderers.
- Perform a visual parity pass against Writer screenshots or a running Writer
  reference, because current checks prove structure and behavior but not
  pixel-level sameness.
- Decide whether the final repo/package-manager target requires actual pnpm
  command parity or whether the current npm-verified path is the accepted
  Burette adaptation.
