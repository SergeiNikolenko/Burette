# Testing Surfaces

Use this guide when an agent needs to start a dev server, verify Quick Look in a
browser surface, or run the repository contract checks. Keep the surfaces
separate: browser-dev, browser Quick Look, tokenized browser preview, desktop
app, and native Finder Quick Look are different runtimes.

## Rules

- Use the in-app Browser plugin for local browser URLs. Do not use macOS `open`,
  Chrome, Safari, Arc, or another external browser unless the user explicitly
  asks for an external browser.
- Use a fresh explicit port with `--strictPort`. Do not reuse an old localhost
  tab or an unknown server from another worktree.
- Keep the server process visible or record its `processId` and `logPath`.
  Stop the server after the check.
- Set `BURRETE_DEV_FS_ALLOW` when the browser-dev server must read files outside
  the repository root.
- Browser success does not prove packaged desktop app or Finder Quick Look
  success. Native checks still need the packaged app and Quick Look scripts.

## Surface RCA

When behavior differs between surfaces, identify the runtime first instead of
debugging the renderer generically.

| Symptom | Likely cause | Where to look first |
| --- | --- | --- |
| Browser-dev works but packaged desktop fails | Tauri bundle resources, asset protocol scope, or generated frontend bundle differs from dev server state. | `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/dist`, `scripts/build.sh` |
| Browser Quick Look works but Finder Quick Look fails | Native extension registration, Launch Services, app install location, or Quick Look cache is stale. | `docs/quicklook-debugging.md`, `PreviewExtension/AGENTS.md`, `scripts/quicklook-preview-smoke.sh` |
| Native forced preview works but normal Spacebar preview does not | Launch Services routed the public file type to another generator. | `config/preview-formats.json`, `PreviewExtension/Info.plist`, `scripts/force-preview.sh` |
| Agent session opens but observe returns stale or empty state | Wrong session directory, old dev server, or missing browser shell agent endpoint. | CLI JSON `sessionDir`, `logPath`, `processId`; `apps/desktop/vite/browser-dev/agent-session.ts` |
| Tokenized preview works but full browser shell actions fail | Preview transport and shell session contracts are different surfaces. | `scripts/agent-preview.mjs`, `scripts/burrete-agent.mjs`, `apps/desktop/src/hooks/use-agent-session.ts` |
| External file fails only in browser-dev | Dev server file allowlist excludes the file path. | `BURRETE_DEV_FS_ALLOW`, Vite server logs, CLI `logPath` |

## Dev Server: Full Browser Shell

For agent-owned Browser shell testing, prefer the CLI. It allocates a fresh
port, starts `vp dev`, writes a session directory, and prints JSON with `url`,
`sessionDir`, `logPath`, and `processId`.

```bash
bun scripts/burrete-agent.mjs open --mode browser-dev-shell samples/mini.pdb
```

Then navigate the in-app Browser to `result.url` from the JSON output.
Machine-readable checks use the returned session directory:

```bash
bun scripts/burrete-agent.mjs observe --session-dir <sessionDir>
bun scripts/burrete-agent.mjs act --session-dir <sessionDir> '{"type":"reset_camera"}'
```

Stop the returned `processId` when the Browser check is complete.

Use this surface for normal app UI work: sidebar, tabs, docks, command palette,
agent session actions, file opening, and browser-dev endpoint behavior.

## Dev Server: Manual Foreground

Use a foreground server when you need direct log visibility or a custom URL such
as `quickLookFile`.

```bash
PORT=1438
BURRETE_DEV_FS_ALLOW="$PWD/samples" \
  vp dev apps/desktop \
    --host 127.0.0.1 \
    --port "$PORT" \
    --strictPort \
    --config apps/desktop/vite.config.ts
```

Keep this command attached in its terminal and stop it with `Ctrl-C` after the
test. If the port is already in use, choose another explicit port instead of
attaching to an unknown server.

## Browser Quick Look Surface

Browser Quick Look is the browser-dev standalone Quick Look debug mode. It is
opened with `?quickLookFile=<absolute path>`. It exercises the browser-dev
Quick Look document opening path, not Finder's native Quick Look extension.

Start the manual foreground server above, then generate the URL:

```bash
python3 - <<'PY'
from pathlib import Path
from urllib.parse import urlencode

port = 1438
file_path = Path("samples/mini.pdb").resolve()
query = urlencode({"quickLookFile": str(file_path)})
print(f"http://127.0.0.1:{port}/?{query}")
PY
```

Navigate the in-app Browser to that URL. Use this surface to test quick-look
document routing, browser-dev preview generation, spectrum/text fallback, and
viewer layout without rebuilding the packaged app.

For external files, set `BURRETE_DEV_FS_ALLOW` to the containing directory
before starting the server:

```bash
BURRETE_DEV_FS_ALLOW="/absolute/folder/with/files" vp dev apps/desktop --host 127.0.0.1 --port 1439 --strictPort --config apps/desktop/vite.config.ts
```

## Tokenized Browser Preview

Use tokenized browser preview when the task needs the agent preview transport
instead of the full app shell:

```bash
bun scripts/agent-preview.mjs samples/mini.pdb --port 5177 --host 127.0.0.1
```

Navigate the in-app Browser to the printed localhost URL. This surface is for
typed preview QA and `agent-preview` transport checks, not normal shell UI.

## Native Finder Quick Look

Native Finder Quick Look requires a packaged app and registered extension. Use a
dev flavor in agent-managed worktrees:

```bash
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/build.sh
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/install.sh
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/quicklook-preview-smoke.sh samples/mini.pdb samples/mini.cif samples/mini.sdf
```

For all sample files:

```bash
BURRETE_DEV_FLAVOR=<worktree-slug> ./scripts/smoke-samples-quicklook.sh samples
```

Use native Quick Look scripts for bundle identifiers, content types, extension
container logs, trace/manifest validation, Launch Services behavior, and
semantic preview evidence. The all-samples smoke requires format-specific
signals such as spectrum peaks, RDKit grid images, FEP molecule atoms,
multi-frame trajectory evidence, and xyzrender SVG artifacts.

Native Finder Quick Look is not the authoritative grid test for public
`.csv`/`.tsv` files. macOS can route `public.comma-separated-values-text` and
`public.tab-separated-values-text` to the system table generator before Burrete's
extension sees the file. `quicklook-preview-smoke.sh` reports those inputs as
`SKIP`; verify Burrete grid rendering through browser-dev or the packaged
desktop app instead.

## Contract Checks

Run the smallest focused contract first. Common narrow checks:

```bash
bun tests/test-ui-shell-contract.mjs
bun tests/test-viewer-bridge-message-contract.mjs
bun tests/test-runtime-storage-contract.mjs
bun tests/test-dev-namespace.mjs
bun tests/test-quicklook-preview-smoke-contract.mjs
bun tests/test-agent-preview-server.mjs
```

Use package groups when the change crosses a subsystem:

```bash
bun run test:agent
bun run test:update
bun run test:ui
bun run test:tauri-structure
```

For all repository contract tests and static checks without a production build:

```bash
bun run check
bun run test
```

For Vite+ contract coverage:

```bash
vp check
vp test
```

For full readiness, including frontend build and repository check/test groups:

```bash
vp run ready
```

`vp run ready` is the broadest local pre-merge command. Use focused commands
first while developing so failures stay attributable.
