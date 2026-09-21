# Desktop Vite Runtime

This directory contains the Vite-side runtime composition for the desktop app
and browser-dev surfaces. `apps/desktop/vite.config.ts` should stay the
composition point: it wires build plugins, shared constants, and browser-dev
route modules, but route bodies belong under `apps/desktop/vite/`.

## Layout

| Path | Owns |
| --- | --- |
| `build-plugins.ts` | Ketcher/Raphael shims, manual chunks, module preload filtering, and build-time plugin helpers. |
| `browser-dev/http.ts` | Shared request parsing and JSON response helpers for local dev endpoints. |
| `browser-dev/files.ts` | File discovery, text reads, file bundles, and browser-dev structure serving. |
| `browser-dev/assets.ts` | RDKit WASM and app icon endpoints. |
| `browser-dev/desmond.ts` | Desmond preview extraction endpoint. |
| `browser-dev/xyzrender.ts` | xyzrender preview endpoint. |
| `browser-dev/descriptors.ts` | Descriptor calculation endpoint. |
| `browser-dev/msbuddy.ts` | MSBuddy endpoint integration. |
| `browser-dev/conformer-inline.ts` | Inline 3D conformer generation endpoint. |
| `browser-dev/conformer-jobs.ts` | Conformer job prepare/run/status/cancel lifecycle. |
| `browser-dev/xtb.ts` | xTB/CREST job status, install, run, and cancel lifecycle. |
| `browser-dev/agent-session.ts` | Browser agent shell observe/action session endpoints. |
| `browser-dev/runtime-doctor.ts` | Read-only runtime doctor report endpoints. |
| `browser-dev/folding-results.ts` | Folding result preview endpoints. |

## Contract Rules

- Do not change browser-dev endpoint paths, methods, status codes, query
  parameters, or response shapes as part of a mechanical refactor.
- Keep job lifecycle logic auditable: process registration, status reads,
  cancellation, and cleanup stay within the job slice that owns the endpoint.
- Keep Quick Look and packaged asset paths stable. Browser-dev conveniences must
  not leak into the packaged preview runtime.
- Keep `vite.config.ts` small. New endpoint bodies should be route modules, not
  inline config code.
- Do not change dev namespace behavior without checking `scripts/dev-namespace.mjs`
  and the Quick Look/dev-flavor scripts.

## Validation

For route or config extraction, start with:

```bash
bun tests/test-ui-shell-contract.mjs
bun tests/test-dev-namespace.mjs
bun tests/test-agent-preview-server.mjs
```

For endpoint groups, add the focused tests that match the touched behavior:

```bash
bun tests/test-browser-dev-maestro-preview.mjs
bun tests/test-folding-results-contract.mjs
bun tests/test-burette-agent-cli.mjs
bun tests/test-runtime-storage-contract.mjs
```

Before release-facing changes, use the project entrypoints:

```bash
vp check
vp test
vp build
```
