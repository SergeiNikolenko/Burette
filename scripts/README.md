# Repository Scripts

Root scripts are the public command surface for agents and maintainers. Prefer
these entrypoints over nested app or Xcode commands unless a task explicitly
requires lower-level debugging.

Use `docs/tools/testing-surfaces.md` before starting a dev server, browser
Quick Look URL, tokenized preview server, native Quick Look smoke, or broad
contract run.

## Public App Commands

| Command | Use When | Notes |
| --- | --- | --- |
| `vp install` | Installing frontend dependencies through Vite+. | Retry with a normal system Node if Codex-bundled Node cannot load native Vite+ bindings. |
| `vp dev` | Running the frontend development loop. | Use the Browser plugin for local browser surfaces. |
| `vp check` | Frontend/static validation. | Preferred over ad hoc package-manager checks. |
| `vp test` | JavaScript test validation through Vite+. | Use focused Bun tests when a script documents a narrower contract. |
| `vp build` | Frontend production build validation. | Run before release-facing frontend changes. |

## Packaged App And Quick Look

Always use a dev flavor for local packaged testing:

```bash
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/build.sh
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/install.sh
```

Remove a dev flavor with `BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/uninstall-dev.sh`.
Development installation replaces only that flavor. It preserves the release
app, legacy app bundles, and extensions belonging to other development flavors.
Deleting the bundle by hand leaves its Launch Services record behind; clean
existing leftovers with `./scripts/prune-launch-services.sh [--dry-run]`
(`install.sh` also runs it).

Preview checks:

```bash
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/force-preview.sh samples/mini.pdb
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/quicklook-preview-smoke.sh samples/mini.pdb samples/mini.cif
BURETTE_DEV_FLAVOR=<worktree-slug> ./scripts/smoke-samples-quicklook.sh samples
```

`quicklook-preview-smoke.sh` is the focused CI-style smoke.
`smoke-samples-quicklook.sh` enumerates a samples directory and writes TSV and
Markdown reports under `build/reports`. It also runs
`quicklook-semantic-check.mjs` against the extension log so empty or wrong
renderers fail even when Quick Look reports a lifecycle `ready`.

Native Quick Look smoke skips public CSV/TSV files because macOS normally routes
those UTIs through the system table generator. Use browser-dev or the packaged
desktop app for Burette grid rendering checks.

## Agent Platform

Use the CLI as the execution contract:

```bash
bun scripts/burette-agent.mjs open --mode browser-preview samples/mini.pdb
bun scripts/burette-agent.mjs open --mode browser-agent-shell samples/mini.pdb
bun scripts/burette-agent.mjs observe --session-dir /tmp/burette-agent-session
bun scripts/burette-agent.mjs act --session-dir /tmp/burette-agent-session '{"type":"reset_camera"}'
```

See `docs/agent-platform.md` and `plugins/burette-agent/AGENTS.md` before
changing CLI, MCP, or skill behavior.

## Validation And CI Helpers

| Command | Use When |
| --- | --- |
| `bun run ci:fast` | Fast PR validation equivalent. |
| `bun run ci` | Broader repository validation. |
| `bun run check` | JavaScript, vendor, format registry, Rust format/clippy, Tauri structure, and compute Metal checks. |
| `bun run test` | Mesoscale, agent, update, and UI test groups. |
| `bun scripts/check-preview-format-registry.mjs` | Preview format registry or content type changes. |
| `bun scripts/check-vendor-assets.mjs` | Vendored runtime asset checks. |
| `python3 scripts/check-blob-size.py --base <sha> --head <sha> --max-bytes 512000 --allowlist .github/blob-size-allowlist.txt` | GitHub blob-size policy checks for accidental large files. |
| `./scripts/perf-smoke.sh` | Non-GUI/Quick Look performance smoke reporting. |
| `node scripts/perf-journeys.mjs` | Journey benchmark for a perf build: p50/p95 per user journey from `PerfTrace.jsonl`, budgets, and `--compare` against an earlier report. |
| `node scripts/benchmark-chemical-space.mjs --input <csv> --runtime-root <ComputeMetal>` | Reproducible RDKit Morgan plus native Metal chemical-space benchmark. |

## Internal Helpers

`prepare-xyzrender-bytecode.py` runs with the staged app's bundled Python from
`build.sh`, after runtime pruning and before signing. It precompiles only imported
renderer startup modules into checked-hash caches; it must not run against a
source environment. Validate relocation and read-only cache invalidation with
`python3 tests/test-prepare-xyzrender-bytecode.py`.

`molstar-surface-field-cache.mjs` adapts the version-locked Mol* unit-surface
calculation during vendoring. Its 64 MiB LRU stores CPU scalar/group fields,
never GPU resources or molecule objects. Exact coordinates, radii, atom/group
indices, bounds and effective resolution/probe parameters invalidate entries;
color and opacity do not. Eviction releases the arrays. A weak tombstone bypasses
readmission for an evicted unit so repeated scans larger than the budget retain
a useful subset; new units can still displace old fields. The cache accelerates
repeat Surface visits, not a cold calculation, and never combines molecules.
Run `bun tests/test-molstar-surface-field-cache.mjs` and `vp run vendor:molstar`
after changes; rebuild the agent-shell mirror and check the vendor lock.

`molstar-surface-loop.mjs` also patches the version-locked cold calculation: it
resolves each atom pair's group IDs once and skips nonpositive grid cells before
distance arithmetic. Probe/grid traversal, distances and group assignments stay
unchanged. `bun tests/test-molstar-surface-loop.mjs` compares fields and meshes
bit-for-bit with upstream, including sparse selections and cancellation.

Scripts such as `dev-namespace.mjs`, `preview-content-type.mjs`,
`patch-web-assets.sh`, vendor scripts, and release signing helpers are
implementation details for the public commands above. Use them directly only
when debugging that specific script boundary.

`sync-codex-tokens.mjs` regenerates `apps/desktop/src/styles/codex-tokens.css`
from the Codex desktop stylesheet in a local InterfaceAtlas checkout
(`--atlas <path>`, default `~/Documents/Projects/InterfaceAtlas`). Both sync
scripts read that checkout's `snapshot-26.1007/assets`. Run it when
that snapshot changes and commit the regenerated file.

`node scripts/sync-atlas-primitives.mjs --atlas <path>` extracts the original
Button, Checkbox, RadioGroup and LoadingIndicator CSS modules from that same
snapshot into `components/ui/*.atlas.css`. Each output records its source hash;
only class/keyframe names and mapped attributes are adapted. React adapters
retain Burette's props and Radix interactions; adjacent non-generated CSS adds
reduced-motion, invalid-state and alignment support. Compare
`/dev/codex-theme.html` with Atlas's `original.html?story=<component>` in both
themes after changing these adapters. This does not change the classic shell.

### Viewer controls

`vp run build:viewer-controls` bundles `apps/desktop/src/preview-controls/`
into `PreviewExtension/Web/native-viewer-menus.js` and its plugin mirror.
Rebuild after editing the adapter, standalone Menu behavior, shared Menu/Popover CSS or
theme engine/tokens. The generated bundle retains the existing runtime filename
and message contracts; do not edit it by hand.

## Release

Release work uses:

```bash
./scripts/release.sh
bun run check:release
./scripts/check-release-signature.sh build/Burette.app
```

Release builds should not use `BURETTE_DEV_FLAVOR`.

### Sequence preview controls

`vp run build:sequence-ui` bundles `apps/desktop/src/preview-sequence/adapter.js`
and `controls.tsx` into `PreviewExtension/Web/sequence-panel.js`. Rebuild after
changing these sources or their shared Select/Resizable components. The runtime
uses the same primitives as the desktop docks with preview theme tokens.

## Local diagnostics capture

Run `python3 scripts/collect-diagnostics.py --output build/reports/<new-directory>`
after an app failure. The parent directory must already exist; existing captures
are never overwritten. For a development installation, pass its exact bundle
identifier with `--app-id com.local.BuretteV10.<suffix>`.

This local-only capture reads the app cache's current action journal, newest
journal archive, and app log. It keeps at most 256 KiB and 500 recent lines per
source, with timestamps, source sizes, truncation and missing-file status in
`summary.json`. Journal targets are omitted; only event metadata and scalar detail fields
`id`, `durableJobId`, `operation`, `status`, and `error` are retained for job
correlation. All other detail fields are omitted. URLs, credentials and absolute paths (including percent-encoded paths)
are redacted, and multiline log payloads are omitted. The capture directory is
private (0700), its files are 0600. No databases or molecular files are copied,
and nothing is uploaded. Arbitrary free-text messages may still contain sensitive
context; review captures before sharing. This captures persisted desktop logs;
browser-only failures and events never written by the app cannot be recovered.

Validate with `python3 tests/test-collect-diagnostics.py`.
