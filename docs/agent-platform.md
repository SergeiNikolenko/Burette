# Agent Platform

## Revisioned representation layers

Native actions `list_scene_layers` and `patch_scene_layers` use `selectionVersion:1`.
A patch requires the observed `sceneId` and `expectedRevision`, boolean `dryRun`
(optional, false by default), and 1–8 `operations`. Each operation has a unique
`layerId` matching `[a-z][a-z0-9_-]{0,47}` and `type: create|update|delete`.
Create requires an exact loaded `structureId`, selection `expression`, and
`appearance`; update changes any supplied fields but cannot reparent a layer.
An expression always requires `structureId` and is intersected with that object.
Delete accepts only its type and layer ID. Missing/existing-conflicting IDs fail.

Appearance is `{type,color,opacity?}`: type is `cartoon`, `ball-and-stick`,
`spacefill` or `line`; color is `{name:"element-symbol"|"chain-id"}` or
`{name:"uniform",value:"#RRGGBB"}`; opacity defaults to 1 and must be in [0,1].
Optional `label` is 1–80 plain-text characters; optional `visible` is boolean.
Labels here name components, not 3D text. Omitted update appearance is preserved.
Unsupported/inapplicable styles and empty/over-50000-atom selections fail before
commit. At most 32 owned layers and 10000 total state nodes are supported.

The patch updates only tagged Burette component/representation pairs. Foreign
descendants or explicit/resolved dependents prevent updates/deletes. A successful
patch has one Mol* Undo entry; rejected/no-op/dry-run patches leave history alone.
An active outer transaction is rejected. Visibility is committed through the
immutable tree, not a builder parameter-only rebase. Source bytes, upstream
transforms, camera and selection are not edited. This is guarded commit/rollback,
not observer isolation or a shared writer lock for direct UI mutations during
the asynchronous update. `list_scene_layers` returns actual owned refs, atom
counts, representation appearance, cell visibility and representation visibility;
it is not an inventory of every foreign layer or a portable project format.

## Conditional scene-update admission

Both Mol* bundles use the version-locked build adapter in
`scripts/molstar-state-precondition.mjs` (Mol* 5.11.0). It adds synchronous
`burettePrecondition` admission after a command reaches the data-state queue
head, before any tree or Undo bookkeeping. A rejected precondition releases
the queue and preserves its entire Undo history. This is a Burette build
extension, not an upstream Mol* option. Consumers must check
`burettePreconditionVersion === 1`; unadapted runtimes cannot promise it.
The build fails on a changed dependency version or source layout. Real-queue
tests include rejection at full history capacity and subsequent valid work.

## Native action history

Fragment extraction and remove/replace-to-new-file operations create a private
temporary directory per result. Reusing a title, including from concurrent
tasks, never replaces a prior result. The returned path is authoritative;
derived files remain temporary and should be explicitly saved for archival use.

The local MCP queue admits at most 128 pending actions, not 128 lifetime
commands. Completed/failed records are retained immutably under the session's
`actions/history`; heartbeats do not scan their payloads. First completion wins,
and waiting callers read archived results across concurrent publication. Legacy
terminal action files migrate lazily without deleting their results.
Disk history grows with completed results (including captures) for the temporary
session's lifetime; it is not a disk quota. First-completion-wins does not imply
exactly-once execution when two UI instances mount the same session.

Admission and close are serialized across CLI processes. `QUEUE_FULL` means
wait for pending commands in the same session. `QUEUE_BUSY` is a bounded failure
that preserves the session; an interrupted admission lock is never stolen by
age and needs explicit recovery after proving no writer owns it. Automatic
post-crash lock recovery is not implemented. Reload the plugin process when
upgrading: concurrently running old writers do not honor the new queue protocol.

## Exact native atom selection

The native workspace accepts `query_atoms` and `select_atoms` with
`selectionVersion: 1`. An `expression` combines `kind`, exact `fields`, returned
atom `ids`, `allOf`, `anyOf`, and `not`. Explicit auth/label namespaces never
fall back to each other. Atom addresses include structure, model, unit and
element index; coordinates are current scene coordinates in angstroms.

`query_atoms` returns `sceneId`, `revision`, `total`, `atoms`, and `nextOffset`.
Use at most 32 rows per page; later pages require the same `sceneId` and
`expectedRevision`. `select_atoms` always requires both, and supports `mode`
`set|add|subtract|intersect` plus `dryRun`. UI selection, data-state and camera
events invalidate stale revisions. These commands use exact Mol* loci with
residue granularity disabled, unlike the legacy residue-schema adapter.

Expressions are limited to depth 8 / 128 nodes; exact inputs to 250000 atoms.
Oversized or non-atomic inputs fail, not silently truncate. Scene IDs are
session-lifetime identities, not portable project handles. Revision fencing of
legacy style/camera commands and durable project identities remain separate
items in [local visualizer status](local-native-parity.md).

`query_groups` takes the same expression and revisioned pagination, plus
`groupBy: residue|chain`. Its `total` counts matched loaded-unit groups, not
biological chains reconstructed across objects or operators. Exact group IDs
include structure/model/unit and atomic-hierarchy `residue_index` or `chain_index`;
both indices are also available to atom expressions. Author/label identifiers
are metadata, never grouping keys. Metadata lists at most 8 distinct values
per field and reports truncation rather than selecting a misleading first value.

Each group reports `matchedAtoms`, `wholeGroupAtoms` and `partial`.
`wholeGroupAtoms` includes all atoms loaded in that instance, including altlocs
and zero occupancy; it does not promise chemical completeness. `groupExpression`
selects the whole loaded group, deliberately expanding a partial match. To
repeat only matched atoms, intersect it with the original expression via `allOf`.
Output pages contain at most 32 groups, not 32 atoms.

Spatial expressions use `within: { radiusAngstrom, of: <expression> }` with
inclusive Cartesian distance and current transformed coordinates. Reference
atoms themselves are included, as are altlocs, hydrogens and zero/unknown
occupancy unless explicitly filtered. Use `allOf` with `not` to exclude the
reference expression. There is no PBC/minimum-image or chemical-contact policy.
`byResidue` and `byChain` expand an expression to whole loaded unit groups.
At most 4 spatial nodes, 5000 reference atoms per node and 2000000 total spatial
candidate checks per expression are allowed; exceeding a limit fails the query.

`current: true` resolves the actual current Mol* atom selection.
`named: "name"` resolves a frozen set saved through `named_selection` with
`operation: save`, `name`, `expression` and required scene/revision/version
fields. Replacing a name requires `overwrite: true`; save/delete support boolean
`dryRun`. `operation: list` reports ready/stale names and counts without atom
payloads; `operation: delete` removes one name with revision fencing.
Missing saved addresses cause `STALE_SELECTION`, never a partial selection.
Limits are 32 names, 10000 atoms/name and 25000 stored addresses total.
These bookmarks last only for that viewer instance: they survive coordinate
transforms, not pane reload or model replacement, and are not project storage.

`measure_geometry` accepts `selectionVersion: 1`, `sceneId`, `expectedRevision`,
`measurement: distance|angle|dihedral`, and exactly 2/3/4 ordered `atomIds` from
the query. It returns the resolved endpoints, current coordinates, units,
method version and signed-torsion convention. Unknown or duplicate atoms,
nonfinite coordinates and degenerate angle/torsion vectors fail explicitly.
Explicitly selected alternate/zero-occupancy endpoints produce warnings, not
silent filtering. This is geometric measurement, not bond or interaction
classification; it does not create persistent graphical labels yet.

The local Codex plugin builds the shared desktop web UI with
`VITE_BURETTE_AGENT_SHELL=1`. This is a visualization and chemical-editing
profile: no Compute/Tools engine controls, Chemical Space, Jobs, folding panels,
or project sidebar. Bottom/right docks retain viewing tools and Ketcher uses right Text.
In the agent profile, collection filters do not automatically open the right
dock. Ketcher omits the redundant page title, viewer shortcuts and outer zoom
header; its drawing tools and explicit Import/Export remain available. Host
resizes recenter the visible sketch without editing its structure or zoom.
`visualizationOnly: true` carries the profile into shared Mol* and grid previews.
Desktop builds retain their own capabilities. `scripts/build-agent-shell-plugin.mjs`
rebuilds shared grid/UI assets before packaging; rebuilding and installing that
bundle is required to deliver main-app UI updates to the plugin. Do not maintain
a parallel copy of the interface. The plugin boundary rules live in
`plugins/burette-agent/AGENTS.md`.

Burette exposes molecular workspace control through a layered agent platform.
The goal is to let agents open structures, observe workspace state, act on the
active viewer, and render bounded side panels without treating screenshots as
the source of truth.

## Layers

| Layer | Path | Responsibility |
| --- | --- | --- |
| Hosted public plugin | `apps/burette-public-plugin` | Public HTTPS MCP tools for one authorized attachment or public PDB entry, plus the sandboxed Burette workspace. |
| Repository CLI | `scripts/burette-agent.mjs` | Source-of-truth execution contract for open, observe, act, and render-panel workflows. |
| Browser preview server | `scripts/agent-preview.mjs` | Tokenized preview surface for typed browser agent sessions. |
| Browser shell session | `apps/desktop/vite/browser-dev/agent-session.ts`, `apps/desktop/src/hooks/use-agent-session.ts` | Browser-dev shell observe/action files and event delivery. |
| Desktop app session | `apps/desktop/src/hooks/use-agent-session.ts`, `apps/desktop/src/lib/ketcher-agent.ts`, Tauri agent session commands | Desktop file-session observe/action bridge for Mol* and the Ketcher chemical editor. |
| Plugin skills | `plugins/burette-agent/skills/*/SKILL.md` | Workflow routing, preflight, task-specific instructions, and completion gates. |
| MCP registrations | `plugins/burette-agent/mcp/registrations/*` | Stable tools wrapping the CLI and bounded artifact validation. |

Repository-local maintenance skills under `.codex/skills` are not part of the
packaged Burette agent plugin. Use them for development-time PR review, release
readiness, contract checks, and PR body drafting.

## Hosted Public Plugin

The hosted plugin is a separate runtime boundary from the local desktop bridge:

- Plugin documentation: <https://burette-landing.vercel.app/docs/plugin>
- Production MCP: <https://burette-plugin.vercel.app/mcp>
- `preview_molecular_file` accepts one OpenAI-authorized PDB, ENT, PDBQT, CIF,
  mmCIF, SDF, SD, XYZ, or extended XYZ attachment.
- `preview_pdb_structure` accepts one four-character public PDB ID.
- `open_ketcher` and `control_ketcher` expose an isolated revision-checked
  chemical editor surface with bounded inline structures and exports.
- The model receives bounded structured composition data. Raw structure text is
  placed only in result `_meta` for the sandboxed Burette workspace.
- Downloads are capped at 3 MiB and 200,000 lines, redirects are revalidated,
  and HTTPS connections are pinned to DNS addresses already checked as public.
- Attachments are processed in memory and are not written to Burette
  application storage.

The MCP widget mounts the production build of the real Burette browser shell
directly and passes the tool result into its existing inline-document path. The
root deployment URL redirects to the public plugin documentation; it is not a
second standalone product or a persistent web workspace. The local desktop app
remains the primary Burette workspace, while each hosted widget receives only
the current MCP tool result inside the user's chat. The packaged local plugin
continues to use the local MCP and CLI bridge for local files and installed-app
control on the same Mac. The bundle, submission metadata, review tests, and
directory skill live together under `apps/burette-public-plugin`; the main
repository remains the source of truth.

## CLI And Skill Map

The CLI owns execution. Skills decide which workflow to run and how to hand the
result back to the user.

| Surface | Path | Use |
| --- | --- | --- |
| Workspace opener | `bun scripts/burette-agent.mjs open` | Opens browser preview, browser agent shell, or desktop app sessions. |
| Workspace observer | `bun scripts/burette-agent.mjs observe` | Reads typed state from a session directory. |
| Workspace action | `bun scripts/burette-agent.mjs act` | Sends typed shell or Mol* actions and waits for completion. |
| Workspace facade tools | `burette.get_context` / `burette.open_workspace` / `burette.observe_workspace` / `burette.control_viewer` / `burette.render_panel` | Short MCP facade over the CLI for external agents, routed by the `external-agent-contract` skill. |
| Ketcher surface | `burette.open_ketcher` / `burette.control_ketcher` | Opens and controls the active chemical editor with bounded, revision-checked actions. |
| MolViewSpec Story | `story-schema` / `story-template-list` / `story-template-create` / `story-create` / `story-validate`; `burette.get_mvs_authoring_reference` / `burette.list_story_templates` / `burette.create_story_from_template` / `burette.create_story` / `burette.validate_story` / `burette.observe_story` / `burette.control_story` | Discovers the version-matched MVS schema, lists reusable scientific scaffolds, authors schema-valid multi-state MVSJ/MVSX, verifies resources, and exposes typed Story state and playback. |
| Panel renderer | `bun scripts/burette-agent.mjs render-panel` | Opens bounded markdown/table/chart output in a docked panel. |
| Tokenized preview | `bun scripts/agent-preview.mjs` | Starts typed browser preview sessions for direct observe/act checks. |
| Router skill | `plugins/burette-agent/skills/index/SKILL.md` | Routes molecular workspace requests to the right focused skill. |
| External agent contract | `plugins/burette-agent/skills/external-agent-contract/SKILL.md` | Operates the workspace through the short `burette.*` tool facade. |
| User context | `plugins/burette-agent/skills/user-context/SKILL.md` | Performs scoped preflight and capability checks. |
| Open workspace | `plugins/burette-agent/skills/open-workspace/SKILL.md` | Opens files in Browser, browser-shell, or desktop surfaces. |
| Mol* scene | `plugins/burette-agent/skills/molstar-scene/SKILL.md` | Applies or reviews Mol* scene actions and MVS-like operations. |
| MolViewSpec Story | `plugins/burette-agent/skills/mvs-story/SKILL.md` | Builds and verifies an ordered molecular explanation with complete scenes per step. |
| Molecule collection | `plugins/burette-agent/skills/molecule-collection/SKILL.md` | Handles SDF, SMILES, CSV, TSV, and grid workflows. |
| Trajectory review | `plugins/burette-agent/skills/trajectory-review/SKILL.md` | Reviews trajectory or result-bundle artifacts. |
| Workflow results | `plugins/burette-agent/skills/workflow-results/SKILL.md` | Intakes external workflow artifacts and maps them to Burette surfaces. |
| Molecular report | `plugins/burette-agent/skills/molecular-report/SKILL.md` | Builds bounded notes, charts, tables, and report artifacts. |
| Visual QA | `plugins/burette-agent/skills/visual-qa/SKILL.md` | Uses Browser or Computer verification after typed state checks. |

Do not add a new MCP tool or skill until the repository CLI contract is clear.
The Ketcher facade is intentionally separate from Mol* scene actions because a
chemical-editor mutation has different revision, payload, export, and
user-persistence rules. Reuse the workspace session and action-file transport;
do not invent a second local session protocol.

## Surfaces

### Native side-pane and inline MCP App

`burette.open_viewer` opens the full shared visualization workspace through
`ui://burette/native-workspace-v1.html` as a compact native chat workspace.
`burette.open_inline_viewer` retains the separate compact PDB/mmCIF resource
`ui://burette/local-viewer.html`. Both use `observe_inline_viewer` and
`control_inline_viewer` with the returned `sessionId`. The native workspace
loads the same React shell and Mol*/grid/Ketcher components as the application,
with a private MCP adapter instead of HTTP. It mounts in the host's current
placement without a startup expansion request. An explicit `fullscreen`
request maps to the Codex side tab.
The separate bottom-right “Side Pane” / “Back to Chat” button moves the same
session between chat and the side panel. The top menu retains external file
actions with application icons. If the
host declines expansion the full workspace remains in chat at a usable height;
unsupported placement is disabled, without a Browser fallback. Observation
includes the host's current `displayMode`.
The native opener accepts `file` and up to seven `additionalFiles` (deduplicated,
16 MiB total). Document tabs reuse the desktop tab presentation, with switching,
reordering, close/close others/close all, information, and reopening closed tabs.
Both openers accept optional UUID v4 `openRequestId`. Retain the same ID and
paths/options for a retry: cross-process admission returns the same session,
token and source snapshot with `reused: true`, without rereading source files.
Paths are compared as absolute lexical paths in input order (not aliases or
file content); workspace/view/display options are included. A conflicting
request or closed session fails rather than creating a replacement. Without a
key each opener creates a fresh session. A session is published only after its
sources and initial observation. Incomplete initialization fails closed after
a two-second bounded wait and requires explicit recovery if its writer crashed.
Keys live only as long as their temporary session directory, not across OS
cleanup; intentional new workspaces require new keys. This is backend opening
idempotency, not a guarantee that the host renders only one card for retries.
Subsequent requests reuse that task's `sessionId` through the model-facing
`control_inline_viewer` action `{ type: "open_files", paths: [...] }`, not
another UI opener. This action explicitly authorizes new local paths, snapshots
them under a cross-process catalog lock, and queues the normal shared-shell
open-files action. Existing snapshots remain immutable and duplicate paths reuse
their document IDs. The complete session is limited to 8 unique files/16 MiB;
invalid additions do not change the catalog. The private exchange returns the
bounded current catalog before the shell executes queued actions and at remount.
App-only source/file-action calls still cannot authorize caller-supplied paths.
An empty but mounted workspace accepts new files; an unmounted workspace returns
a readiness blocker rather than creating a new pane. Never select another task's
workspace implicitly.
The mounted transport reports `capabilities.addFiles: true`; file additions
fail with a reload instruction on an older pane instead of queuing an action
that its stale document catalog cannot load.
Supported inputs include PDB/mmCIF/PDBQT, XYZ trajectories, MOL/SDF/SMILES/CSV/TSV collections,
and self-contained MVSX Stories. `view: "auto"` opens document tabs;
`view: "ketcher"` seeds the editor from the first molecule input;
`view: "docking"` uses the first file as receptor and extra files as ligands.
The native workspace opens inline at the full available host width. Only height
is negotiated: 280–600 CSS pixels, based on the active grid's rendered content,
loaded molecular atom count, or sketch complexity. Loading uses 320 pixels;
camera rotation and zoom do not resize the chat. A separate shadcn expand button
in the bottom-right row opens the side pane and returns to chat. The top ellipsis
menu is reserved for external file actions.
Side-pane placement is an explicit user choice. Observation includes the actual viewport
dimensions so host clipping is distinguishable from internal canvas layout. Theme follows the
host; native Ketcher hides database, collection and manual-theme controls and
places Import/Export in the right Text dock without overlapping the canvas.
Active-tab text and fill use a paired contrast palette in both host themes.
`color_by_chain` accepts an optional ordered `palette` of 1–32 `#RRGGBB`
colors; it updates live Mol* representation themes without replacing the
workspace. `observe_scene.layers[].palette` reports actual bounded palette
parameters. This is not a named chain-to-color map. Scene requests must use
runtime controls, not repository searches or application-source edits.
`capture_scene` returns the actual current Mol* viewport as an 800×600 PNG image
block through `control_inline_viewer`. Default `scope: "auto"` additionally
returns a 400×400 RDKit 2D PNG when one ligand is selected. `scope: "ligand"`
requires that selection; `scope: "scene"` requests only the viewport. Capture
does not focus or modify the scene. `depiction.status: "unavailable"` is an
explicit partial result, with no substituted projected-3D drawing. Coordinate
inputs may have inferred bond orders. The authenticated acknowledgement permits
at most two PNGs, 1 MiB each and 1024 pixels per dimension, with 64 KiB metadata
and a 3 MiB total envelope. Base64 goes only into MCP image blocks, never the
structured model context. Ordinary observation/action payload limits stay 64 KiB.
Open With resolves bounded PNG icons from registered macOS applications through
the private file-action exchange; image elements never request a loopback URL.
Native XYZRender uses the installed host executable on a source snapshot or
bounded inline sketch, including a selected XYZ frame. Input and SVG are each
limited to 512 KiB, with a 25-second process timeout and temporary-file cleanup.
Built-in presets and standard molecular controls are supported; custom config
paths, arbitrary extra flags and volumetric fields return explicit errors.
Unvisited pages remain cold. Visited pages stay mounted until their tab closes
or the host unmounts the workspace; switching or reordering does not evict them.
Native tab reordering uses pointer capture, including edge scrolling, rather
than relying on host HTML drag-and-drop. Each mounted
page owns its renderer; assets are fetched once per workspace. This is not a
total memory limit. Closing the whole workspace unmounts React, disposes
Mol*/WebGL, terminates workers and revokes loaded blob resources.
The native workspace does not terminate when its last document closes or when
the host changes display mode. An empty workspace stays available for its next
document. Host teardown or page unload releases local renderers, workers and
polling, and clears composer context, but does not mark the session closed or
delete its persisted workspace state. A host remount can reuse that session;
this is not a promise to keep a host-owned pane visible after the host removes it.
Native remounts restore authorized file tabs, active-tab identity, editor drafts
and Mol* data, camera, representations and selection from private session
checkpoints. Scene checkpoints are bounded to eight documents, 512 KiB gzip
each (16 MiB expanded); workspace storage is bounded to 699052 bytes. Checkpoint
data is app-only and never added to model context. Observation reports
`persistence.restoring`, `savedAt` and `warning`; oversize scenes report a warning
instead of claiming restoration. Temporary derived-file tabs and external assets
are not covered by this file-backed resume contract. Session-directory expiry
still ends restoration; it is not durable archival storage.
On a fresh mount, an empty checkpoint response is valid: native hosts can omit
the null `value` field from private metadata. This must not be diagnosed as an
outdated plugin or block workspace startup. Nonempty unexpected responses still
fail closed instead of silently replacing saved state.
There is no idle timeout or automatic window-count eviction. Explicit terminal
close in the compact viewer still ends that session. A closed-session marker is authoritative over
stale heartbeats and replayed tool results. The app-only exchange accepts
`close: true` and returns `{ closed: true, actions: [] }` thereafter, including
source requests. `observe` reports `closed: true`, `ready: false`, empty tabs
and selection; commands require a new explicit opener call. Closing is not
inferred from document visibility, display mode, or host unmount.
If temporary session data has expired, replayed cards receive terminal
`closed: true, expired: true` state, not filesystem errors or a new renderer.
Keep terminal session records when cleaning up visible test cards.
The private exchange also accepts `fileAction` with an authorized `documentId`
and one of `list_apps`, `reveal`, `open_default`, or `open_with` (plus a discovered
`targetId`). It never accepts a caller-supplied file path or executable. On macOS,
application choices come from Launch Services, not a hard-coded installed-app
list. The shared agent shell exposes the same implementation through its
authenticated `/__burette/file-action` endpoint; normal Browser-dev mock targets
remain preview-only. Launch requests use fixed `/usr/bin/open` argument arrays.
Observation includes `activeDocument`, `tabs`, and `closedTabs`. Tab controls are
`activate_tab`, `close_tab`, `close_other_tabs`, `close_all_tabs`, and `move_tab`,
using `tabId` and (for movement) zero-based `toIndex`. Molecular commands are
bound to the observed active document and rejected if it changes before execution.
The app-only source exchange accepts an authorized `documentId`; omitting it
continues to read the initial document for older clients/sessions.
The renderer is the existing preview Mol* runtime,
packaged by `scripts/build-local-viewer.mjs`; generated HTML must not be edited.
This sandbox-specific Mol* build omits MP4 export and replaces its eval-based
string interpolation with named-property substitution. The source entry and
locked Mol* version are shared; the generated JavaScript is intentionally not
byte-identical to the desktop preview bundle. The App needs no `unsafe-eval`.

The CLI owns the embedded transport through `mcp-app '<json-operation>'` with
`open`, `observe`, `act`, and app-only `exchange` operations. Unlike the
Browser/native file-session transport, the sandboxed App cannot read session
files directly; it exchanges bounded messages through the host MCP bridge.
Source snapshots are owner-private, limited to 16 MiB and identified by SHA-256.
Source chunks (192 KiB before base64) and capabilities are returned only in
tool `_meta`, never model-visible content. Source config marks MVSX archives as
binary so preview consumers do not UTF-8-decode the ZIP payload before passing
it to Mol*. The UI resource is self-contained, limited to 4 MiB.
Both resource entry points permit only blob connects/resources, data images,
and blob child frames, not network destinations. Hosts may retain an older
`open_viewer` binding to `ui://burette/local-viewer.html`. That resource dispatches
by the session's `workspace` flag: full sessions start the shared workspace,
while compact sessions retain the inline viewer. The compact payload and chrome
are discarded before starting a full workspace, without inflating their engines
or creating a second MCP connection.
The persistent MCP server imports the same CLI-owned `mcp-app-session.mjs`
implementation; private heartbeats and source chunks do not spawn CLI processes.
`build:native-workspace` packages the shared shell into content-addressed gzip
assets for offline MCP delivery. Its module graph preserves lazy imports;
`asset` requests on the authenticated private exchange read only exact manifest
entries, in 192 KiB chunks. The manifest is limited to 192 KiB, packed assets to
24 MiB each and unpacked assets to 64 MiB each. The component checks size and
SHA-256 before executing a module. This transport does not start a localhost
listener or permit a network fallback. The compact PDB resource remains separate.
The offline profile substitutes synchronous Embind wire wrappers in the locked
RDKit/Indigo glue and Paper's keyword predicate with non-evaluating functions.
WASM and worker URLs are resolved to integrity-checked blob resources. This is
not a general JavaScript evaluator, and does not enable PaperScript or `unsafe-eval`.
Chunk reads allocate only the requested range, not another whole-file copy.
The compact viewer embeds its CSS and removes its packed startup element after
loading. The native workspace loads its packaged CSS before importing the shell.
Its initial cover keeps one spinner and `Opening molecular structure...` while
the shell mounts. Heartbeats refresh both local and host readiness after
asynchronous checkpoint restoration. Mol* reveals only
after the configured preset, required water representation, final camera and a
new committed canvas draw; `agentReady` alone does not reveal the scene. This
completion gate is native-MCP-only; desktop and Quick Look timing is unchanged.
Inline startup requests a stable content height; use the side pane for more room.
The inline widget suppresses the bottom dock, its menu toggle and internal resize
handle, including when restored state says it was open. Side-pane mode retains
the dock state. Loading observations do not renegotiate size. The placement control floats inside
the workspace, inset above the host's bottom-right controls, without a footer row.
Startup errors replace the cover with an explicit retry action.
Molecular summaries are reused until the underlying structure objects change;
acknowledgements run without an extra one-second heartbeat delay.
Composer context is selection-only: a ready, nonempty molecular selection
publishes the bounded card. No selection, tab switching, or closing the document
sends `{ content: [] }` without structured content or presentation metadata,
clearing the previous card. Unselected structure state remains available through
observation; it is not automatically attached to the user's next message.

`ready` requires a recent mounted surface heartbeat: a parsed structure, loaded
collection, ready editor, or loaded Story. Successful session creation or queue
insertion is not rendering or action completion. State/results are limited to
64 KiB; actions to 8 KiB (72 KiB for Ketcher commands with up to 64 KiB inline
structure content), and 128 per session. `lastAction` confirms success or failure. Local snapshots
remain in the OS temporary directory for the session lifetime; no source file
is rewritten. Closing the host view stops heartbeats and makes readiness stale.

Observation additionally reports `lifecycle.status`: `awaiting_mount` before
the first state, `stale` after 15 seconds without a fresh heartbeat, otherwise
`loading`, `empty`, `error`, or `ready`. `heartbeatAgeMs` is null before the first
state. Cached document flags may remain true while lifecycle is stale; they do
not authorize live molecular commands. A freshly reporting empty/loading
workspace still accepts tab, placement and editor-opening controls so users can
recover without creating another pane. Molecular commands retain the ready gate.

The allowlist includes focus ligand/selection, select/clear residues, reset/rotate
camera, representation style, color theme, spin/rock, procedural wiggle,
`observe_scene`, and `set_display_mode` (`inline`/`fullscreen`). Controls wait
up to `waitMs` (0–30 seconds, default 12 seconds in MCP) for the matching action
file acknowledgement. The native workspace also accepts shared tab, file,
Ketcher, docking and Story actions; Ketcher mutations retain their surface ID
and expected-revision checks. `queued` is unfinished; `failed` sets MCP `isError`.
The state includes bounded layers and motion/wiggle settings. Last-action results
larger than 8 KiB are summarized in observation; the acknowledged control response
retains the original result under the existing 64 KiB result limit.
Wiggle is a visual effect, not molecular dynamics or normal modes.
Display requests use the MCP Apps
host API on the same mounted document so camera/selection are not reset by
application code. Host placement and remount behavior still require an actual
Codex smoke test; a Browser harness is not equivalent evidence.

Native `observe_frames` / `control_frames` use the visible pose/trajectory
timeline controller. Operations are next, previous, goto (zero-based global
`index`), play and pause; results include kind, frameIndex, frameCount and
playing. Out-of-range frames and documents without a timeline fail explicitly.
This is playback of supplied coordinates, not docking or MD computation.
Asset loading uses at most four native chunk reads concurrently, including
chunks of a single large engine, and verifies size and SHA-256 before execution.
Independent preview resources are fetched ahead of use while classic scripts
still execute in document order. Static-module loading shares that same read
pool rather than waiting for arbitrary batches of four modules. These scheduling
properties are tested; actual host cold-start timings require a native mount.
Verified immutable source bytes are shared across concurrent reads and retained
until workspace disposal, bounded by the session's 8-file/16-MiB source limit.
Revisiting a tab does not transfer its source again; failed verification remains
retryable and never populates this cache.

| Mode | Use When | Notes |
| --- | --- | --- |
| `auto` | Default. The CLI picks the best available surface. | Used by the plugin skills unless a task pins a surface. |
| `browser-agent-shell` | The user needs the normal app UI in the Browser: sidebar, tabs, docks, command palette, or shell workflows. | Starts a local browser-dev shell with agent-session endpoints. `browser-dev-shell` is accepted as a legacy alias and normalized to this mode. |
| `browser-preview` | The user needs tokenized typed observe/act against a preview surface. | Prints the session URL; the Browser plugin navigates it. |
| `desktop-app` | The user explicitly asks for packaged/native app behavior. | Requires the installed app and a desktop agent session. `--no-launch` skips launching the app when it is already running. |

Browser means the in-app Browser plugin unless the user explicitly asks for an
external browser. Computer/native UI control is a QA fallback, not the primary
state channel.

## Static Browser Shell Authorization

The prebuilt browser agent shell binds to loopback and requires the initialized
session token for its app, file, compute, and session routes. The CLI returns a
URL with `shellToken`; opening that URL sets an HttpOnly, SameSite=Strict session
cookie for subsequent same-origin assets, fetches, and event streams. HTTP clients
can instead send `Authorization: Bearer <session token>`. Keep the returned URL
private. `/healthz` exposes only readiness and does not require a token.

The server rejects mismatched Host and Origin headers even when a token is
present. File allowlists compare canonical paths, and file reads validate the
opened descriptor against the allowed canonical object before reading. Directory
walks exclude symlink escapes and repeated canonical directories. The Amber
preview subprocess receives validated input descriptors rather than reopening
user-provided path names.

Run `node tests/test-agent-shell-security.mjs` for positive and negative HTTP
coverage, and `node tests/test-burette-agent-cli.mjs` for CLI startup and runtime
asset integration. These checks exercise the prebuilt static transport; Vite
browser-dev and native app validation remain separate surfaces.

## Observe And Act Contract

- `observe` is the machine-readable state source for active document, open
  documents, panels, viewer readiness, scene selection, and last action result.
- `act` queues a typed action and waits for the shell or active Mol* viewer to
  report completion or a structured failure.
- `render-panel` opens bounded markdown, table, or chart artifacts in a dock
  panel through the normal text-document path.
- Screenshot interpretation must not replace typed `observe`, validation
  output, or CLI/MCP errors.

## MolViewSpec Story Contract

A Story is standard MolViewSpec multi-state data: `kind: "multiple"`, global
metadata, and ordered snapshots. Each snapshot contains a complete MVS root plus
a unique key, title, markdown or plain-text description, linger duration, and
transition duration. Burette treats Story as the primary agent-to-user surface
for ordered explanations such as overview, binding site, ligand pose,
interactions, comparison, and conclusion.

`story-create` normalizes a compact storyboard or accepts the standard shape,
validates every scene through the Mol* MVS schema, validates unique keys and
bounds, and refuses implicit overwrite. `.mvsx` is the required handoff for
local sidecars: every relative `download.url` must have a matching archive
resource. `.mvsj` may reference only accessible HTTP(S) or data resources;
relative resources require `.mvsx` because the embedded viewer has no portable
filesystem base URL.
Mol*'s standard `./assets/...` paths are normalized safely. `file:` URLs and
absolute filesystem paths are rejected rather than leaking host paths into a
browser scene.

`story-template-list` exposes the installed catalog with declared inputs,
step-by-step scientific purpose, evidence expectations, and caveats.
`story-template-create` performs bounded string substitution, rejects missing
or unknown variables, then follows the same validation and safe-write path as
`story-create`. The source descriptors live in `templates/mvs-story/` and are
packaged under `assets/mvs-story-templates/`. They are starting points, not
analysis engines: contacts, scores, alignment metrics, and biological claims
must be supplied from explicit calculations or observations. In particular,
the docking comparison requires one computed interaction-primitives resource,
one matching receptor-residue annotation, and one evidence-qualified summary
for each pose. Packaged docking Stories therefore cannot silently omit either
the key-contact lines or the endpoint residues those lines refer to.

`story-schema` exposes progressive MolViewSpec authoring help from the same
installed Mol* runtime used by Story validation. Without `--node` it returns a
bounded scene or animation overview, supported node kinds, the MVS spec version,
and official documentation links. With `--node`, it adds that node's exact
parents, parameters, types, defaults, and descriptions. MCP exposes the same
contract as `burette.get_mvs_authoring_reference`. This avoids injecting a full
upstream documentation snapshot into every prompt while preventing agents from
guessing version-sensitive syntax.

After opening, `observe_story` reports the current snapshot and ordered bounded
metadata from Mol*'s snapshot manager. `control_story` supports next, previous,
goto by index/key/id, play, and pause. The visible Story dock mirrors that state
and exposes Previous, Play/Pause, and Next; the Mol* viewer itself also carries
Story step controls with hover previews. Completion requires schema/resource
validation, ready workspace state, typed next/previous checks, and Browser
verification of two nonblank steps.

## Ketcher Agent Contract

The Ketcher surface uses API version `burette-ketcher-agent/v1`. The desktop
controller is registered per tab and reports it through `observe.json` as:

```json
{
  "activeSurface": {
    "kind": "ketcher",
    "tabId": "tab-1",
    "surfaceId": "desktop-ketcher:tab-1",
    "phase": "ready",
    "ready": true
  },
  "chemicalEditor": {
    "surfaceId": "desktop-ketcher:tab-1",
    "structureRevision": 3,
    "interactionRevision": 4,
    "persistedRevision": 2,
    "dirty": true
  }
}
```

`burette.control_ketcher` accepts `set_structure`, `clear_structure`,
`highlight_atoms`, `get_structure`, and `request_persist`. Every action carries
an idempotent `actionId`, the target `surfaceId`, and `expectedRevision`.
Structural edits advance `structureRevision`; highlight/selection changes only
advance `interactionRevision`. A revision mismatch, stale tab, oversized
structure, unsupported format, or unresolved `contentRef` is a typed failure.
Inline content is bounded to 64 KiB, atom-index lists to 256 entries, and
inline exports to 64 KiB. Persistence stops at `awaiting_user` until a user
confirms the file write.

The hosted public plugin mirrors the same action schema through
`open_ketcher`/`control_ketcher` and the resource
`ui://burette/ketcher-editor-v1.html`. Its relay is process-local and ephemeral:
it is suitable for the current MCP widget turn, not a durable shared workspace;
reference-backed content fails closed until an authenticated artifact relay is
added.

## Preview Response And CLI Output Bounds

Tokenized preview observation JSON is capped at 256 KiB. Action results up to
4 KiB retain their existing inline shape. Larger results return
`{ ok, truncated: true, artifact: { url, byteCount } }`. Every completed action
also carries `resultArtifact` with the raw result JSON location, including small
results. URLs are relative to the preview origin and require the same session
token or cookie. They never contain the token themselves.

The preview retains the most recent 100 completions in memory; `completed` and
`failed` counts describe this retained history. Queued and dispatched actions are
preserved. Completed input payloads are released, retaining panel metadata where
needed. A repeated result for a retained completed action returns HTTP 409.
Raw result artifacts remain available after history eviction for the lifetime of
the preview session. They reside in its private temporary directory and are
removed on SIGINT/SIGTERM; disk usage grows with recorded results during that
session. Export needed artifacts before stopping it.

When scene or panel metadata makes the entire observation exceed 256 KiB, the
response sets `truncated: true` and supplies an `artifact` URL for an immutable
full observation snapshot. Basic document identity, scene readiness, endpoints,
and bounded action summaries remain inline; fallback action results use artifact
references. Identical observations reuse a content-hashed artifact, so polling
does not duplicate disk snapshots. Consumers must inspect this marker
and fetch the artifact explicitly when they need the omitted detail.

The MCP CLI bridge limits combined stdout/stderr to 4 MiB, terminates a child
that exceeds the limit, and reports `CLI_OUTPUT_LIMIT` without forwarding partial
output. UTF-8 output is decoded after collection to preserve split characters.

## Agent RCA

| Symptom | Likely cause | Where to look first |
| --- | --- | --- |
| Skill opens the wrong surface | Router chose `browser-preview`, `browser-agent-shell`, or `desktop-app` incorrectly. | `plugins/burette-agent/skills/index/SKILL.md`, CLI `open` arguments |
| MCP tool succeeds but the panel is empty | Widget snapshot is unbounded, malformed, or missing the expected artifact shape. | MCP registration output, `plugins/burette-agent/mcp/registrations/*/register.mjs`, `render-panel` payload |
| `observe` returns no active document | Wrong session directory, closed Browser tab, or desktop session not attached. | CLI `sessionDir`, shell logs, `apps/desktop/src/hooks/use-agent-session.ts` |
| `act` times out | Action was sent to the shell when the active Mol* viewer was not ready, or the action contract changed. | Last `observe` result, `apps/desktop/src/hooks/use-agent-session.ts`, viewer bridge tests |
| Story opens but has no steps | The input is a single-state MVS document, an old runtime is active, or Mol* did not install snapshots. | Run `story-validate`, then `observe_story`; confirm `kind: "multiple"` and restart after plugin updates. |
| Story validation reports a missing resource | A relative `download.url` is absent from MVSX or was used in standalone MVSJ. | Pass the exact archive path through `--asset` / `resources`, then recreate the MVSX. |
| `control_ketcher` returns `REVISION_CONFLICT` | Another edit, selection change, or tab switch advanced the editor state. | Refresh `burette.observe_workspace` and use the returned `surfaceId`/`structureRevision`. |
| `control_ketcher` returns `STALE_TARGET` | The requested surface is no longer the active Ketcher tab or was unmounted. | Reopen Ketcher with `burette.open_ketcher`; do not reuse the old surface id. |
| Plugin preflight fails | Packaged plugin paths, CLI availability, or local runtime capabilities are out of sync. | `plugins/burette-agent/scripts/burette_agent_preflight.mjs`, `plugins/burette-agent/AGENTS.md` |
| Browser screenshot disagrees with typed state | Visual QA inspected the wrong tab or stale runtime while `observe` targeted another session. | Browser URL, CLI JSON metadata, `observe` output |

## Plugin Contract

- Known local PDB/mmCIF files use the router's direct native tool path without
  a separate capability inventory. Run
  `node plugins/burette-agent/scripts/burette_agent_preflight.mjs` for setup,
  Browser/desktop or artifact workflows.
- Skills route workflows. MCP registrations expose tools. The CLI does app
  control. Keep those responsibilities separate.
- Validate molecular artifacts before surfacing reports, tables, trajectories,
  or workspace payloads.

## Validation

For CLI/session changes:

```bash
bun tests/test-burette-agent-cli.mjs
bun tests/test-agent-preview-server.mjs
bun tests/test-burette-agent.mjs
bun tests/test-mvs-story.mjs
```

For plugin changes:

```bash
bun tests/test-burette-agent-plugin.mjs
bun run test:agent
```

For the hosted public plugin:

```bash
cd apps/burette-public-plugin
bun run test
bun run typecheck
bun run build
```

For app-side shell action/session changes:

```bash
bun tests/test-ui-shell-contract.mjs
bun tests/test-viewer-bridge-message-contract.mjs
```
