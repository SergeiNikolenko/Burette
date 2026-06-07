---
date: 2026-06-06
feature: agent-operable-workspace
service: Burrete
status: active
---

# Agent-Operable Molecular Workspace

## Goal

Burrete should expose a small, reliable interface that lets an agent operate the
application as a molecular workspace. The interface is about display,
inspection, scene state, local artifacts, and user-visible workspaces. It is not
an internet fetch layer: agents can download or generate files outside Burrete
and then hand local artifacts to the app.

The first-class operations are:

- open local structure, collection, trajectory, and result-bundle artifacts;
- observe the current app/viewer state as structured JSON;
- perform allowlisted high-level scene actions;
- verify the visual result with screenshots when needed;
- render adjacent notes, tables, charts, and reports;
- accept externally prepared or server-produced artifacts;
- export diagnostics and image artifacts.

## Operating Modes

### Browser Preview Mode

Browser preview mode uses the existing `scripts/agent-preview.mjs` server. It
serves `PreviewExtension/Web` assets, generates `preview-config.js` and
`preview-data.js` in memory, and prints a tokenized localhost URL.

Use this mode when the user asks for the Codex built-in browser, fast visual QA,
Mol* canvas checks, grid checks, screenshots, or trace-like browser debugging.

Required properties:

- localhost-only by default;
- token required for HTML, config, data, and agent endpoints;
- readable observe endpoint;
- visual verification through the Browser plugin or Playwright-style tooling;
- no arbitrary filesystem writes.

### Desktop App Mode

Desktop app mode targets the real installed Burrete application. It should work
in regular builds and dev-flavored builds, but only after an explicit local
agent session is enabled.

Use this mode when the user asks to display work in the real app, use the main
window, use app panels, compare with Quick Look behavior, or leave results open
for the user.

Required properties:

- explicit opt-in agent session;
- local IPC or `127.0.0.1` only;
- short-lived per-session token;
- audit log for agent actions;
- release builds must not expose an always-on unauthenticated port.

## Primary Contract

The source-of-truth contract should be a readable CLI. MCP can wrap the same
contract later, but MCP should not be the only way to operate or test it.

Initial CLI shape:

```bash
burrete-agent open --mode browser-preview /tmp/1htb.pdb
burrete-agent open --mode desktop-app /tmp/1htb.pdb
burrete-agent observe --json
burrete-agent act '{"type":"focus_ligand","selector":{"label_comp_id":"NVP"}}'
burrete-agent snapshot --output /tmp/scene.png
burrete-agent render-panel --kind markdown --file /tmp/notes.md
burrete-agent render-panel --kind chart --file /tmp/properties.json
burrete-agent diagnostics --output /tmp/burrete.diagnostics
```

The MVP can start with `scripts/agent-preview.mjs` endpoints and a thin CLI
wrapper after the server contract is stable.

## Research Inputs

The interface follows a few established agent-control patterns instead of
inventing a large custom API surface:

- MCP separates executable tools from readable resources and reusable prompts,
  with discovery and execution over a transport layer. Burrete mirrors that
  shape with a small command set, readable `observe`, explicit transports, and
  room for a future MCP wrapper.
- Browser automation systems such as the Chrome DevTools Protocol use typed
  command names and structured arguments/results. Burrete should expose
  `act`/`observe` as typed JSON and leave screenshots as verification evidence,
  not as the only machine-readable state.
- Tool-use systems return a tool request, execute it outside the model, then
  return a result block. Burrete follows the same queue/result model in both
  browser-preview HTTP mode and desktop file-session mode.
- Mol* already models selections as `Loci`, provides serializable bundles, and
  exposes `PluginCommands` and viewer interactivity helpers. Burrete should keep
  high-level actions such as `focus_ligand`, `select_residues`,
  `hide_waters`, and `show_surface` mapped onto those Mol* concepts instead of
  exposing arbitrary JavaScript execution.

Reference sources:

- https://modelcontextprotocol.io/docs/learn/architecture
- https://chromedevtools.github.io/devtools-protocol/
- https://docs.anthropic.com/ko/docs/agents-and-tools/tool-use/overview
- https://molstar.org/docs/plugin/viewer-state/
- https://molstar.org/docs/plugin/selections/

## Observe Shape

`observe` must return readable state. Screenshots are useful, but they are not
enough.

Example:

```json
{
  "apiVersion": "burette-agent-control/v1",
  "mode": "browser-preview",
  "transport": "http-local-token",
  "activeDocument": {
    "title": "1HTB.pdb",
    "path": "/tmp/1HTB.pdb",
    "format": "pdb",
    "byteCount": 123456,
    "viewer": "molstar",
    "ready": true
  },
  "viewerAgent": {
    "apiVersion": "burette-agent/v1",
    "available": true,
    "commands": ["capabilities", "summary", "focusLigand", "contacts", "screenshot"]
  },
  "scene": {
    "known": true,
    "structures": 1,
    "chains": ["A", "B"],
    "ligands": [{"id": "NVP", "chain": "A"}],
    "waters": 342,
    "ions": ["NA"],
    "representations": ["protein-cartoon", "ligand-sticks"]
  },
  "selection": {
    "focused": "ligand:NVP"
  },
  "panels": ["viewer"],
  "errors": []
}
```

If the server cannot inspect the live viewer process directly, it should still
return known server-side state and mark live viewer state as unavailable rather
than pretending a screenshot is enough.

## Action Model

Avoid many tiny endpoints. Use one allowlisted action surface:

```json
{"type":"focus_ligand","selector":{"label_comp_id":"NVP"}}
{"type":"hide_waters"}
{"type":"show_surface","target":{"kind":"protein"}}
{"type":"color_by_chain"}
{"type":"select_residues_near_ligand","radiusA":4}
{"type":"reset_camera"}
{"type":"export_image"}
```

The existing `PreviewExtension/Web/burette-agent.js` already exposes the first
Mol* agent seam through `window.BurreteAgent`:

- `capabilities`
- `summary`
- `select`
- `selectResidues`
- `focusSelection`
- `colorSelection`
- `showLigands`
- `focusLigand`
- `contacts`
- `resetCamera`
- `screenshot`
- `loadMVS`
- `exportMVS`

The next implementation steps should wrap and expose this seam rather than
starting over.

## Workspace Panels

The app should be able to show adjacent generated artifacts:

- Markdown notes and molecule descriptions;
- property tables;
- molecule grids;
- charts such as score histograms, scatter plots, RMSD/RMSF trends, and contact
  frequencies;
- result reports for externally run workflows.

Panel rendering can start in browser preview mode or desktop app mode. The
important invariant is selection linkage: a selected molecule, ligand, frame, or
row should be visible in the viewer when possible.

## External Workflows

Heavy workflows such as protein preparation, ligand preparation, docking,
molecular dynamics setup, production MD, trajectory cleanup, and bulk property
calculation can run outside Burrete, usually on a server. Burrete's job is to
accept and display the resulting local artifacts:

- prepared structures;
- filtered SDF/CSV files;
- trajectory bundles;
- representative frames;
- metric tables;
- plots;
- run reports.

Burrete may store job metadata as workspace artifacts, but it does not need to
become a general job manager in the first implementation.

## Security Rules

- No internet fetching requirement inside the app-level agent interface.
- No arbitrary shell execution from the app bridge.
- No wildcard filesystem write.
- Token-gate every local HTTP agent endpoint.
- Prefer local IPC or loopback-only HTTP.
- Log every command with timestamp, action type, arguments summary, result
  summary, warnings, and errors.
- Do not mutate source files in place; write derived artifacts separately.
- Require explicit confirmation outside this interface for irreversible actions,
  server submissions, or overwrites.

## Capability Test Matrix

The test plan should measure both supported and unsupported workflows.

### Contract Tests

- `tests/test-burette-agent.mjs`: verify `window.BurreteAgent` capabilities,
  summary, ligand focusing, contacts, screenshots, and typed failures against a
  fake Mol* structure.
- `tests/test-agent-preview-server.mjs`: verify token gating, static asset
  serving, generated config/data, health checks, and observe endpoints.
- `tests/test-ui-shell-contract.mjs`: keep static regression checks for viewer
  injection, shell integration, Mol* readiness notification, and agent asset
  inclusion.

### Browser Preview Smokes

Run against small fixtures first:

- `samples/mini.pdb`: structure loads, observe returns known document state, and
  Browser screenshot shows nonblank viewer.
- `samples/mini.cif`: format inference and Mol* load path work.
- `samples/mini.xyz`: expected renderer path is exposed.
- an SDF fixture: grid loads and observe reports collection mode when supported.

### Desktop App Smokes

Use dev flavor for packaged local tests unless explicitly testing the release
app:

- build/install with `BURRETE_DEV_FLAVOR=<slug>`;
- open a local PDB in the real app;
- connect an explicit agent session;
- run `observe`;
- focus ligand or report a typed `SELECTION_EMPTY` when no ligand exists;
- export diagnostics.

### Quick Look / Finder Smokes

Use existing forced preview scripts and per-request log matching:

- `BURRETE_DEV_FLAVOR=<slug> ./scripts/force-preview.sh samples/mini.pdb`;
- verify the matching request block reaches `ready`;
- collect the same diagnostics surface when a preview fails.

### Domain Capability Probes

Each probe should say `supported`, `partial`, or `unsupported`, with a reason:

- open local PDB/CIF/XYZ;
- detect chains, ligands, waters, ions;
- focus ligand;
- select nearby residues;
- compute lightweight contacts;
- reset camera;
- export image;
- open SDF grid;
- filter or sort collection;
- render markdown/table/chart panel;
- open structure + trajectory bundle;
- show trajectory controls or explain why the bundle is incomplete;
- load prepared/server-produced result bundle.

### Negative Tests

- invalid token returns `403`;
- missing structure returns typed `NO_STRUCTURE`;
- missing ligand returns typed `SELECTION_EMPTY`;
- ambiguous ligand selector requires disambiguation unless explicitly allowed;
- unsupported action returns typed `NOT_IMPLEMENTED`;
- oversized or unsupported files fail with a useful reason;
- observe never claims live scene details when it only knows server-side config.

## First Implementation Cut

1. Extend `scripts/agent-preview.mjs` with a token-gated readable observe
   endpoint. Status: done for server-side browser-preview state.
2. Extend `tests/test-agent-preview-server.mjs` for that endpoint. Status:
   done.
3. Keep the existing `window.BurreteAgent` Mol* API as the first live viewer
   command surface.
4. Add a thin CLI wrapper only after the server contract is stable. Status:
   done for `scripts/burrete-agent.mjs open --mode browser-preview`,
   `scripts/burrete-agent.mjs open --mode desktop-app`,
   `scripts/burrete-agent.mjs observe`, and `scripts/burrete-agent.mjs act`.
5. Design the desktop app session bridge after the browser-preview contract is
   proven. Status: done for the explicit file-backed local session bridge,
   including startup parsing, observe/action files, Mol* iframe relay, and
   docked workspace panels.

## Current Gaps

- `scripts/burrete-agent.mjs observe` reads browser-preview server state. After
  the browser runtime loads Mol*, `PreviewExtension/Web/viewer.js` reports
  `window.BurreteAgent.capabilities` and `window.BurreteAgent.summary` back to
  `scripts/agent-preview.mjs`, so subsequent observe calls can include live
  scene summary.
- Browser-preview `act` is implemented as an allowlisted queue:
  `scripts/burrete-agent.mjs act --url <url> '<json-action>'` posts an action,
  `PreviewExtension/Web/viewer.js` polls for queued actions, executes supported
  mappings through `window.BurreteAgent.run`, and reports action results back to
  `scripts/agent-preview.mjs`.
- `desktop-app` mode uses an explicit file-backed local session directory.
  `scripts/burrete-agent.mjs open --mode desktop-app` writes `session.json` and
  `actions.json`, launches the app with `--burrete-agent-session`, and the
  desktop shell writes `observe.json` while polling queued actions. It supports
  `open_files` directly in the shell and relays viewer actions to the active
  Mol* iframe through `postMessage`.
- The desktop runtime bridge serves Mol* preview payloads through a Tauri
  command instead of relying on direct `asset://` fetches from the webview.
  Parent/iframe messages are scoped to known document ids, runtime paths are
  normalized inside the generated viewer runtime directory, and the iframe
  reports readiness back through the same agent observe contract.
- `scripts/burrete-agent.mjs render-panel --session-dir <dir> --kind
  markdown|table|chart --file <path>` is implemented for `desktop-app` sessions.
  The desktop shell opens the artifact as a text document and places it in the
  right or bottom dock through the existing `TextFileViewer`.
- `scripts/burrete-agent.mjs render-panel --url <tokenized-preview-url> --kind
  markdown|table|chart --file <path>` is implemented for browser-preview
  sessions. The server reads small text artifacts into the queued action, and
  `PreviewExtension/Web/viewer.js` renders a read-only right-side overlay panel
  for Markdown text, tables, and simple bar charts.
- Browser-preview `observe` now reports agent-rendered panels through both the
  compatible `panels` string array and a structured `workspacePanels` array with
  area, kind, title, file, byte count, status, and source action id.
- High-level scene actions such as `hide_waters`, `show_waters`,
  `show_surface`, and `color_by_chain` are accepted by browser-preview `act`
  as best-effort Mol* scene actions. Runtime success or failure is reported
  through the action result because exact support depends on the loaded Mol*
  component and representation APIs.
- Workspace panels for Markdown, tables, and charts are implemented for both
  browser-preview and file-backed desktop sessions. Browser-preview has a small
  built-in table/chart renderer; desktop sessions use docked text-document
  panels and report those docked panel documents in `observe.workspacePanels`,
  so richer desktop chart rendering beyond text/Markdown display is still a
  follow-up.
- Desktop-app visual smoke is proven in this run against the installed
  `Burrete-d7f70.app` dev flavor. A CLI-launched session opened
  `samples/mini.pdb`, reported `activeDocument.ready: true` and
  `viewerAgent.available: true`, completed `reset_camera` and `hide_waters`,
  rendered a Markdown side panel, and reported that panel through
  `observe.workspacePanels`.
- Full molecular workflow automation is intentionally outside this first cut:
  server-side MD preparation/submission, docking, trajectory cleanup, bulk SDF
  property calculation, and rich native chart widgets should be implemented as
  separate workflow producers that hand local artifacts back to this workspace
  contract.

## Validation Status

Last checked on 2026-06-06:

- `bun run test:agent` passes and covers `window.BurreteAgent`,
  browser-preview token gating, `observe`, `report`, action queueing, action
  result reporting, browser-preview `render-panel` payload preparation, desktop
  file-session CLI behavior, and `render-panel` action queueing.
- `bun tests/test-ui-shell-contract.mjs` passes and pins the viewer-side
  reporting, polling, action mapping, scene-action wiring, browser-preview
  `render_panel` overlay renderer, and panel CSS.
- `bun tests/test-tauri-structure.mjs` passes and pins the desktop startup
  command, agent-session hook, file-backed observe/actions paths, and iframe
  action relay contract. It also pins `render_panel` opening text documents in
  the dock.
- `cargo fmt --check` passes for the Tauri crate.
- `cargo check` passes for the Tauri crate, including the new startup,
  shell-command, and runtime bridge code.
- `bun run check:js` passes for `PreviewExtension/Web/viewer.js`,
  `scripts/agent-preview.mjs`, `scripts/burrete-agent.mjs`, and the existing JS
  syntax targets.
- `vp install` completed and restored `node_modules`. The postinstall
  `lefthook install` step could not replace a hook in the separate main
  checkout, so it was skipped by the existing package script.
- `vp exec tsc --noEmit` passes for the desktop TypeScript sources.
- `bun run build:web` passes through the repository's ordinary Vite web build
  path and writes the expected ignored build artifacts.
- `vp check` and `vp build` were attempted after dependency installation, but
  both fail before reaching project analysis/build output because Vite+ native
  bindings cannot be loaded on this machine. `vp check` fails in `oxfmt` or
  `oxlint`; `vp build` fails in the Vite+ rolldown binding. The observed macOS
  loader error is a code-signing Team ID mismatch while loading the native
  `.node` files from `node_modules`, not a project TypeScript or runtime error.
- `git diff --check` passes.
- A live Codex Browser smoke passes against the tokenized `127.0.0.1`
  browser-preview URL for `samples/mini.pdb`. The browser-visible page loads one
  Mol* canvas, `observe` reports live `window.BurreteAgent` capabilities and
  scene summary, `render-panel` opens a right-side Markdown panel, and
  `observe.workspacePanels` reports that panel. The no-ligand fixture also
  returns the expected typed `SELECTION_EMPTY` result for `focus_ligand`.
- A live desktop-app smoke passes against
  `/Users/nikolenko/Applications/Burrete-d7f70.app` launched through
  `scripts/burrete-agent.mjs open --mode desktop-app samples/mini.pdb
  --session-dir /private/tmp/burrete-agent-desktop-7f70-final`. `observe`
  reported the active Mol* document as ready, `reset_camera` completed through
  the iframe relay, `hide_waters` completed with `componentCount: 0` on the
  no-water fixture, and `render-panel` created a docked Markdown panel visible
  in `workspacePanels`.
