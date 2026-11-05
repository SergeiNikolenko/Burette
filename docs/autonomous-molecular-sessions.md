# Autonomous molecular sessions

The native MCP plugin has two execution surfaces. Live scene/editor controls
are handled by the mounted app. Scientific operations and publication images
use server-owned immutable snapshots and an on-demand worker, independent of
panel presence. `observe.ready` retains its existing UI meaning;
`observe.molecular.dataReady` identifies available autonomous source data.

## API and ownership

- `open_molecular_session`: durable PDB/mmCIF snapshots, optional RCSB download,
  stable sessionId and document IDs; no UI resource.
- `add_molecular_files`: snapshot explicitly authorized comparison inputs.
- `run_molecular_operation`: inspect, contacts, buried_area, align or render;
  explicit UUID requestId binds immutable inputs and action for retry.
- `molecular_job`: retained status/result and explicit cancellation.
- `show_molecular_session`: present the existing sources and optionally a
  completed export's self-contained scene in the native workspace.

New autonomous sessions live under `~/.burette/molecular-sessions`. Existing
native sessions retain their temporary location and remain usable for analysis
while their snapshots exist. Removing temporary snapshots still expires them.
Source files are never mutated. Interactive viewer selection is not implicitly
used as an analysis selection; requests name their document/chain explicitly.

Jobs live inside their session and have queued, running, completed, failed,
cancelled or interrupted states. `~/.burette/molecular-runtime` owns admission
and global scheduling across MCP server processes. An on-demand supervisor runs
one heavy task at a time, drains the bounded queue, and exits when idle. No
renderer or compute process is maintained just to keep a panel alive.

## Resource and scientific contracts

Data jobs use a 512 MiB V8 heap budget, rendering uses 1024 MiB for its Node
process; these are not total RSS caps. Chromium memory is separate. One-thread
numeric environment settings, lowered worker priority, bounded input/work,
timeouts and cancellation limit impact. Measure full process-tree RSS for
render acceptance instead of claiming the V8 budget limits browser memory.

Source snapshots retain the existing 8-file/16 MiB session limit. The engine
limits source atom count, selected atoms, contact pair comparisons, TM-align
dynamic-programming cells and SASA work. Contact results retain total count
and explicit truncation. Coordinate models/author numbering are validated;
no arbitrary model or alternate C-alpha is chosen silently.

TM-align uses pinned Mol* 5.11.0. SASA uses explicit Bondi element radii,
midpoint Fibonacci sphere samples and declared probe radius. One-sided
interface area is half the total partner SASA loss. Results carry source
SHA-256, method parameters, counts and operation resource metrics.

## Export and recovery

Render jobs use the packaged Mol* runtime and a temporary installed Chromium
controlled by pinned playwright-core. The browser is a detected prerequisite;
execution never downloads it. `BURETTE_CHROMIUM_EXECUTABLE` selects an explicit
installation when standard discovery cannot find one. The renderer has no
network dependency: source bytes and runtime assets are supplied locally.

The same self-contained MVSJ describes both export and native reopening.
`nativeAttachment` reports whether originals plus that scene fit the native
8-document/16 MiB limit; a successful image export alone does not imply that
the scene fits the existing panel. Presentation queues an explicit scene-open
action so restored earlier tabs do not hide the newly exported scene.
PNG and scene are published without replacement; the `.render.json` sidecar
is the completion marker. A hard crash before that marker may leave incomplete
artifacts; they must not be reported as completed or overwritten by a retry.
Job result publication is atomic. Repeated request IDs recover retained results
and reject changed inputs. Interrupted work is not silently rerun.

## Validation

Focused tests: `test-molecular-analysis.mjs`, `test-molecular-jobs.mjs`,
`test-molecular-session.mjs`, `test-molecular-render.mjs`. Job tests exercise real
processes, submitter exit, supervisor failure, cancellation, timeout, concurrent
admission and idle shutdown. Session tests run with no app exchange or panel.
Use `scripts/check-molecular-background.mjs` for pinned 1YCR, 4AKE/1AKE and
1EMA acceptance and retained artifacts/metrics. Native mounted-scene acceptance
is a separate check; successful headless export does not prove host mounting.

## Focused package delivery

Build the server and autonomous worker with `bun scripts/build-agent-shell-plugin.mjs
--mcp-only --playwright-root /path/to/playwright-core-1.58.2`. The supplied npm
package is verified against the exact manifest version and vendored intact;
browser binaries are not included. `stage-molecular-plugin.mjs --base-plugin
/path/to/installed/burette --output /new/staging/path` composes this backend with
the previously installed native/browser/preview UI, preserving those assets
byte-for-byte. Its build metadata records the source commit, base package version
and native asset manifest digest. Install the staged package through its normal
`scripts/install-local.mjs`; never overwrite an installed cache manually.
