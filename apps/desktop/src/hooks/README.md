# Desktop Hooks

This directory owns React hooks that keep `App.tsx` as a composition root.
Hooks may coordinate state, refs, side effects, and callback assembly, but they
must preserve the public shell contracts consumed by layout and viewer code.

## Slice Map

| Slice | Primary Files | Owns |
| --- | --- | --- |
| Shell actions | `use-app-shell-actions.ts`, `use-app-agent-session-actions.ts` | Grouped action slices flattened back to the legacy `ShellActions` surface. |
| Shell view state | `use-app-shell-view-state.ts` | Derived view-state slices flattened back to the legacy `ShellViewState` surface. |
| Opening and drop flow | `use-app-file-open.ts`, `use-app-open-actions.ts`, `use-app-open-drop-controller.ts`, `use-app-drop-actions.ts` | File, text, spectrum, dock payload, clipboard, and drop orchestration. |
| Viewer bridge | `use-app-viewer-bridge-controller.ts`, `use-app-viewer-bridge-messages.ts`, `use-app-*-messages.ts` | `window.message` routing between host, grid, Mol*, xyzrender, and agent actions. |
| Preview/runtime state | `use-app-viewer-runtime-refs.ts`, `use-app-host-runtime-operations.ts`, `use-app-preference-effects.ts`, `use-app-quick-look*.ts` | Runtime refs, preview refresh, Quick Look startup, cache/diagnostic actions, and host operations. |
| Domain workflows | `use-app-chemistry-jobs.ts`, `use-app-conformer-workflows.ts`, `use-app-xtb-workflows.ts`, `use-app-ketcher-actions.ts`, `use-app-grid-*.ts`, `use-app-docking-*.ts`, `use-app-fep-workflows.ts` | Chemistry, grid, Ketcher, docking, pose review, and FEP workflow callbacks. |
| Agent session | `use-agent-session.ts` | Desktop/browser agent observe/action polling and active viewer action relay. |

## Contract Rules

- Keep `ShellActions` and `ShellViewState` public names and flattened shapes
  stable unless the layout contract is intentionally migrated in the same PR.
- `App.tsx` should wire hooks and pass layout-facing values; it should not
  regain domain-specific message handlers or job orchestration bodies.
- Preserve viewer bridge message names, source filters, local storage keys, and
  dispatch order when extracting message handlers.
- Do not move Tauri IPC, browser HTTP calls, or `window.postMessage` side effects
  into pure helpers under `src/lib`; hooks own side-effect orchestration.
- Keep hook extraction behavior-preserving. UI copy, renderer selection, and
  file-routing semantics are separate product changes.

## Validation

Run the smallest contract check for the slice you touched before broader
validation:

```bash
bun tests/test-ui-shell-contract.mjs
bun tests/test-viewer-bridge-message-contract.mjs
bun tests/test-runtime-storage-contract.mjs
bun tests/test-shell-store-behavior.mjs
bun tests/test-docking-documents.mjs
```

For user-visible shell work, also run:

```bash
bun run test:ui
```

Use the Browser surface for visual regressions. Use the desktop app or Quick
Look only when the change touches packaged/native behavior.
