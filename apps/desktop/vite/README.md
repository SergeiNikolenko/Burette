# Desktop Vite Runtime

This directory contains the Vite-side runtime composition for the desktop app
and browser-dev surfaces. `apps/desktop/vite.config.ts` should stay the
composition point: it wires build plugins, shared constants, and browser-dev
route modules, but route bodies belong under `apps/desktop/vite/`.

## Layout

| Path | Owns |
| --- | --- |
| `build-plugins.ts` | Ketcher/Raphael shims, manual chunks, module preload filtering, and build-time plugin helpers. |
| `ketcher-csp-validation.ts`, `ketcher-schema-catalog.ts` | Hosted-only build-time extraction and Ajv standalone compilation of the installed Ketcher forms and saved settings. |
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

The browser-dev app icon route keeps converted PNGs under
`~/Library/Caches/Burette/app-icons` on macOS (`~/.cache/Burette/app-icons`
elsewhere). It reads a saved icon before looking for the application, so suite
updates and repeated dev sessions do not trigger discovery or conversion.
Delete an individual PNG to refresh that application's artwork. Missing images
fall back to initials in menus and the Open In trigger.

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

Hosted Ketcher uses Paper Core (no PaperScript interpreter) and precompiled Ajv
validators, keeping the widget's CSP free of `unsafe-eval`. Schema extraction
reads only the pinned package's trusted declaration dependency closure at build
time. Runtime custom-format closures, serializers and error-message functions
remain Ketcher's own. Unknown schema shapes fail closed; upstream upgrades must
pass the differential and actual browser-bundle test before publishing:

```bash
bun tests/test-ketcher-csp-validation.mjs
```

Also test the built hosted card under its production CSP: load a seeded sketch,
open Settings, reject invalid input, save a valid setting and reload, open Atom
and Bond Properties, and validate/export the current drawing. Desktop and the
standalone web demo retain their existing validation path.

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
