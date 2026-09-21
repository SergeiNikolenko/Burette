# Plugin host integration

The plugin reuses the main Burette interface under the visualization-only agent
build profile. Browser workspace, inline MCP App, and native host attachment are
different surfaces; passing one does not establish support for another.

## Lessons from Molecular Structure Viewer

The installed reference inspected for this work was OpenAI's
`structure-viewer` 0.1.80. Its server registers the chat-open operation around
`dist/server.mjs:69480`, constructs open/readiness results around line 70200,
and constructs its HTML resource around line 104112. Its UI implementation is
packed in `dist/views/viewer.bundle`; the observations below are from that
implementation, not merely its README.

| Mechanism | Implication for Burette |
| --- | --- |
| One open intent owns one logical session; display-mode changes reuse it. | Expanding a card must preserve source, camera, selection, and scene revision. Do not create a second workspace just to change placement. |
| Session creation, mounting, and rendered readiness are separate states. | Require both typed readiness and a nonblank visible scene. A successful open call is not render proof. |
| `updateModelContext` is capability-gated and publishes bounded structured state. | Publish actual UI selection, including clears. A custom button or assistant message is not a native attachment. |
| Context publishing deduplicates updates and the reference serializes/retries them. | Burette's inline polling now publishes changed context serially and retries failures on the next poll. It does not yet reproduce the reference's full generation-guarded publisher. |
| Scene mutations use expected revisions, rollback, and bounded history. | Extend Burette's existing Ketcher revision guards and Mol* undo/transactions where needed; do not assume these mechanisms are absent or rewrite them wholesale. |
| Source identity, recovery metadata, and offline resource delivery are explicit. | Preserve source provenance and verify packaged assets independently of the desktop build. |

The reference also uses native `scientificViewers` / family-process capabilities.
Those are host-specific contracts, not evidence that a general MCP App can create
the same native file pane or composer chip. Do not copy private capability names
and claim native integration without an actual host handshake and rendered test.

## Implemented shared behavior

- Agent UI hides project-sidebar/bottom-dock toggle buttons, calculation engine
  menus, Jobs, and Ketcher's property-calculation button. Inspector, molecular
  selection, Ketcher editing, and import/export remain available.
- Plugin packaging rebuilds the shared grid UI and copies the same viewer source.
  Main-app changes reach the plugin through rebuild and installation, not through
  an independent UI fork or automatic mutation of an installed desktop app.
- User selection reaches the active document's `observe.scene.selection`.
  Context carries model/unit/operator and atom identity samples, capped at 96
  entries and 24 KiB UTF-8, with explicit truncation. Deselection clears it.
- The inline MCP App uses the same bounded context formatter and publishes with
  `updateModelContext` only when the host advertises that capability.
- `manage_burette_tabs` is the dedicated internal tool for listing, focusing,
  opening, closing, and reordering workspace tabs.

## Verification boundaries and remaining work

The Browser workspace was checked with 1HTB: visible rendering, selection of all
5,799 atoms, clear, ion and NAD 2D cards, preview navigation, transfer into Ketcher,
and its export panel. A benzene SMILES/MOL round trip and tab switching were
checked through the real bundled MCP server. The MCP protocol fixture received
selected atom identities and then `activeSelection: null` after clearing.

Native Codex mounting and selection acknowledgement were verified separately on
2026-09-05: session `384cda91-d800-46a5-b463-a46059cef716`, action
`d0d15cbe-37e8-4c50-90a5-36744b9d6c13`, revision 4, selected NAD A 377,
44 atoms and one residue. The user-visible native context contains the filename,
residue identities, and counts. The later text-only publisher removes automatic
PNG attachments: Codex renders image content separately, while the composer icon
comes from the plugin manifest. It requests `composerAttachmentLayout: "card"`
and a filename label through Codex's optional presentation extension. Standard
MCP text/structured content remains usable by other hosts.

The expanded context includes composition, chain ranges, ligands, representation
layers, camera and selection. It is capped at 48 KiB UTF-8 with explicit structured
truncation, at most 8 structures, 24 chains/ligands per structure and 24 layers;
human-readable text is capped at 8 KiB UTF-8 and summarizes fewer entries.
The protocol fixture verified actual 1HTB context (5,799 atoms, 899 residues,
four organic ligands and four representation layers) with no image attachments.
The revised single-card presentation still requires a fresh native-host check;
the earlier native selection acknowledgement does not prove this new layout.

For a single PDB/mmCIF structure, `burette.open_viewer` now requests native
side-pane placement using standard MCP Apps `requestDisplayMode(fullscreen)`.
The installed Codex host routes that mode to its MCP App panel. This is not a
Browser tab, localhost iframe, or use of private `scientificViewers` APIs. It
keeps the same session when switching inline/fullscreen. Unsupported or rejected
placement is reported visibly; there is no automatic Browser fallback.

The native App reuses the molecular preview interface, not the full React file
workspace. Ketcher, independent file tabs, combined scenes and other file formats
still use explicit `open_workspace` in Browser. Multiple files open as independent
Burette tabs; `scene: "structureAll"` combines them, with alignment opt-in.
The updated auto-open side-pane route still requires a fresh native-host smoke
after plugin reload; the protocol fixture alone does not prove native placement.

### Internal MCP audit (2026-09-06)

The bundled server exposes 34 tools. Registration/bundled-server, viewer,
tab, Ketcher, Story, structure-summary and output-bound contract tests passed.
This is not a claim of end-to-end execution of every tool or every format.

| Capability | Full Browser workspace | Compact inline MCP App |
| --- | --- | --- |
| Selection, focus and reset | Live selection/focus checked on VAL A 203 (7 atoms); reset is registered | Select, ligand focus, reset and clear are allowlisted |
| Color themes | Live element-symbol and chain-id changes checked | `color_by_chain` exposes the same shared theme action |
| Representation styles | Shared action now awaits preset application and propagates failure; source reload reads requested configuration and restores it on failure | Same awaited style action is allowlisted |
| Camera, spin, rock and procedural wiggle | Typed rotation/motion/wiggle actions use the existing viewport controls | Same actions are allowlisted; observation returns actual camera, motion, animation settings and bounded layers |
| Trajectory and Story playback | Dedicated trajectory-frame and Story tools exist; contract tests passed, not a new live playback check | Not exposed |

Native/inline control waits for the mounted viewer's acknowledgement by default.
`queued` means unfinished, not success. Failed execution returns an MCP error.
Regression tests cover deferred/failed style application, source-reload ordering,
appearance reset, motion validation, camera geometry, uncertainty with no spread,
native placement requests and bounded context. Procedural wiggle is not molecular
dynamics or normal modes.

### Native proxy serialization regression

The native host can omit the terminal `nextOffset: null` field when relaying a
source chunk. Treat a missing cursor as completion too; otherwise the download
requests an undefined offset after already receiving the whole file. Outbound
exchanges must also normalize internal viewer results to JSON: optional
`requestId`, `warnings`, and pre-load camera fields can be undefined, which the
native proxy rejects even though ordinary JSON transport would omit them.

The original protocol fixture tested the server directly and never exercised
this client/host serialization boundary. `tests/test-local-viewer-startup.mjs`
now executes the production download and exchange code with a missing terminal
cursor and a real viewer success-result shape against a JSON-only proxy fixture.
It is included in `test:agent`; native rendering and selection acknowledgement
still require a host smoke check.

Chemical provenance remains a separate limitation: the existing
`standalonePreviewSdfFromAtoms` path infers connectivity from coordinates and
writes single bonds. The PDB-derived NAD transfer therefore establishes UI
transport, not chemically faithful bond-order/aromaticity recovery. Exact export
needs authoritative bond metadata or a separately validated reconstruction path;
do not present the current coordinate-derived SDF/SMILES as chemically exact.
