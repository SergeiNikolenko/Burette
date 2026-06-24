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
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/build.sh
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/install.sh
```

Preview checks:

```bash
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/force-preview.sh samples/mini.pdb
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/quicklook-preview-smoke.sh samples/mini.pdb samples/mini.cif
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/smoke-samples-quicklook.sh samples
```

`quicklook-preview-smoke.sh` is the focused CI-style smoke.
`smoke-samples-quicklook.sh` enumerates a samples directory and writes TSV and
Markdown reports under `build/reports`. It also runs
`quicklook-semantic-check.mjs` against the extension log so empty or wrong
renderers fail even when Quick Look reports a lifecycle `ready`.

Native Quick Look smoke skips public CSV/TSV files because macOS normally routes
those UTIs through the system table generator. Use browser-dev or the packaged
desktop app for Burrete grid rendering checks.

## Agent Platform

Use the CLI as the execution contract:

```bash
bun scripts/burrete-agent.mjs open --mode browser-preview samples/mini.pdb
bun scripts/burrete-agent.mjs open --mode browser-dev-shell samples/mini.pdb
bun scripts/burrete-agent.mjs observe --session-dir /tmp/burrete-agent-session
bun scripts/burrete-agent.mjs act --session-dir /tmp/burrete-agent-session '{"type":"reset_camera"}'
```

See `docs/agent-platform.md` and `plugins/burette-agent/AGENTS.md` before
changing CLI, MCP, or skill behavior.

## Trajectory Preview Extractors

Use the small format extractors when an external trajectory bundle is not a
direct Mol* structure file:

```bash
python3 scripts/amber_nc_preview_extract.py reference.pdb trajectory.nc --output preview.pdb
python3 scripts/biokinema_preview_extract.py /path/to/BioKinema/run --output trajectory.cif
```

The BioKinema extractor reads the `*_pred_coordinates.npy` coordinate array and
the first prediction CIF as topology, then writes a multi-model mmCIF that Mol*
can open as a trajectory.

## Validation And CI Helpers

| Command | Use When |
| --- | --- |
| `bun run ci:fast` | Fast PR validation equivalent. |
| `bun run ci` | Broader repository validation. |
| `bun run check` | JavaScript, vendor, format registry, Rust format/clippy, and Tauri structure checks. |
| `bun run test` | Agent, update, and UI test groups. |
| `bun scripts/check-preview-format-registry.mjs` | Preview format registry or content type changes. |
| `bun scripts/check-vendor-assets.mjs` | Vendored runtime asset checks. |
| `python3 scripts/check-blob-size.py --base <sha> --head <sha> --max-bytes 512000 --allowlist .github/blob-size-allowlist.txt` | GitHub blob-size policy checks for accidental large files. |
| `./scripts/perf-smoke.sh` | Non-GUI/Quick Look performance smoke reporting. |

## Internal Helpers

Scripts such as `dev-namespace.mjs`, `preview-content-type.mjs`,
`patch-web-assets.sh`, vendor scripts, and release signing helpers are
implementation details for the public commands above. Use them directly only
when debugging that specific script boundary.

## Release

Release work uses:

```bash
./scripts/release.sh
bun run check:release
./scripts/check-release-signature.sh build/Burrete.app
```

Release builds should not use `BURRETE_DEV_FLAVOR`.
