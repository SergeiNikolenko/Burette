# Performance Architecture

Burette optimizes the normal desktop app and Finder Quick Look as separate
runtime paths. The desktop shell remains a visible macOS app. Quick Look remains
the fast Finder preview path. Shared web assets are reused where possible, but
runtime generation, caches, and diagnostics are scoped to the caller.

## Runtime Boundaries

- Desktop runtimes are created by the Tauri preview service under the app cache
  directory, below `viewer/`.
- Quick Look runtimes are created by the Swift extension in its own extension
  cache container.
- The desktop path may use Tauri IPC and SQLite-backed stores.
- The Quick Look path cannot depend on desktop process state and keeps Swift
  fallbacks for bundled helper failures.

Do not make normal app launch hidden to improve cold-start numbers. Registration
or maintenance launches can opt into `BURETTE_LAUNCH_MODE=register`, but user
launch, file-open launch, app reopen, and menu activation must show the app.

## Desktop file writes

`write_text_file` and `write_base64_file` await a blocking worker for directory
creation, decoding and disk writes. A shared asynchronous lock serializes these
commands without blocking the native event loop; this also prevents concurrent
writes from interleaving file contents. Callers still await completion before
reporting a saved path. Request fields, returned paths and ordinary file/decode
errors retain their existing shapes.

## Live panel resizing

Fixed panel sizes use react-resizable-panels' built-in `preserve-pixel-size`
behavior (4.14). Do not add a second ResizeObserver/rAF resize correction to
nested groups: it competes with the requested layout during the gesture.

Measured panel-edge properties belong on the topbar and window drag region,
their only consumers. Publishing them on the app root makes every gesture
invalidate inherited style across the workspace. The observer uses its delivered
bounds, and cached bounds restore chrome after returning from Settings without
forcing a layout read.

Mol* keeps the iframe and chrome geometry live while the compositor presents
its existing drawing buffer. Canvas CSS preserves the old projection's vertical
scale and center without stretching molecules. Resizing/reallocating GL targets
is held for the full explicit host gesture, including pointer pauses, and otherwise
is deferred until 200 ms without a bounds change; the final resize and full-quality
draw run atomically. The plugin's own input/layout resize paths share this deferral.
No quality preferences, coordinates, camera, trajectory position or animation
clocks are changed. Disposal cancels deferral and restores styles and the method.
A hidden tab skips the final draw and catches up when reactivated.

Opt-in journey tracing records `viewer:resize`: up to the last 120 scheduling
costs, p95/max milliseconds, and the final resize/draw cost. These CPU submission
costs are separate from the shell's actual rAF intervals; they do not measure GPU
completion or prove that every presented frame met its deadline.

## Bulk document admission

The desktop open hook publishes the first ordinary molecular document before
processing the remaining paths in sequential batches of at most 32. Combined
pose/grid requests remain atomic. Files whose immediate format fallback is
required, and explicit reloads, keep eager validation. Native path classification
runs on a blocking worker; no filesystem preflight runs in that command's main
thread handler.

The optional `open_documents.deferRuntime` input admits file identities and source
ownership without reading structure contents or generating runtime assets. Such
documents have `runtimeDeferred: true` and an empty `runtimePath`; consumers must
not load that path into an iframe. The shell retains admission renderer overrides
in `runtimeDeferredPreferences`. Mounted viewer frames use a shared serial
preparation queue and the ordinary eager `open_documents` command, replacing the
same document identity when ready. Queued viewers that have been unmounted are
skipped. Results for closed/replaced documents release their provisional claims
and are not installed. Failed preparations expose an explicit retry.

Subsequent batches preserve active selection in the store mutation itself, so
they neither mount unseen scenes nor generate temporary navigation events.
Saved-session restoration prioritizes the selected file before routing the tail;
unhydrated saved tabs remain in their saved order. Opening source editing awaits
the real runtime before capturing its base preview. Cancellation is checked before
each batch and after each native result; an already-running native parse still
finishes before its discarded result can be released.

Combined virtual grids receive a fresh result path and document ID for each
operation. Their visible title and scientific source data are unchanged. Preparing
another combination cannot replace an adopted collection's registry entry or
edited rows. Cancellation releases only unadopted virtual grid result IDs through
the existing batched grid close command; adopted collections use ordinary document
teardown and are excluded from abandoned-result cleanup.

## Asset Profiles

The profile manifest lives at `config/web-runtime-profiles.json`. It is the
source of truth for which web assets belong to each runtime family.

Current profiles:

- `desktop-molstar`: Mol* viewer shell assets for desktop structure previews.
- `desktop-mesoscale`: Mesoscale Explorer runtime assets for desktop mesoscale
  documents.
- `desktop-grid`: grid viewer, grid CSS, and RDKit JS/WASM for desktop
  collection previews.
- `desktop-native-compute`: web assets for the native compute panels.
- `quicklook-molstar`: Mol* viewer shell assets for Finder previews.
- `quicklook-mesoscale`: Mesoscale runtime assets for Finder mesoscale
  previews.
- `quicklook-grid`: grid viewer, grid CSS, and RDKit JS/WASM for Finder grid
  previews.
- `external-artifact`: minimal viewer shell assets for already-rendered
  external SVG artifacts.

`scripts/check-vendor-assets.mjs` validates vendored assets and the profile
manifest. `scripts/size-report.sh` prints profile sizes and asset membership so
large duplicated files have an explicit explanation.

## Bundled Python Footprint

Release builds package the `xyzrender` CLI and RDKit in a relocatable Python
environment (`uv tool install --with rdkit xyzrender`). Datamol is not installed
by the build; missing RDKit is installed directly before native compilation.
The staged copy is reduced to the dependency closure of xyzrender, RDKit, and installed xyzrender file-format
extras, excluding xyzrender's notebook-only `ipykernel` dependency. Shared
requirements such as SciPy (through cclib) are retained. Datamol-only packages
are removed using their distribution RECORDs; pruning never deletes from source environments.

The pruning helper keeps package resources, headers, and test/data directories
because these can be imported or loaded at runtime. It removes bytecode caches
and the interpreter's test suite, IDLE, and ensurepip in both framework and uv
standalone Python layouts. It also removes the immutable bundled interpreter's
pip installation. RDKit `Contrib` is retained because it includes descriptor
models and scoring datasets. The Metal compiler module cache is also excluded
from the app. Dependency metadata checks and pruning fixtures do not replace
smoke rendering and native acceptance of a newly packaged app. Run the pruning
fixtures with the source xyzrender environment's Python:
`~/.local/share/uv/tools/xyzrender/bin/python3 tests/test-prune-xyzrender-runtime.py`.

Set `BURETTE_KEEP_FULL_XYZRENDER_RUNTIME=1` only when diagnosing an upstream
`xyzrender` packaging change. `scripts/size-report.sh` can be used to compare
the resulting `xyzrender-runtime` and `xyzrender-python` directories.

### Shared static resources

Before signing, `scripts/deduplicate-web-resources.py` hard-links identical
non-executable JS, CSS, WASM and JSON files of at least 128 KiB across the
desktop viewer, Quick Look and packaged plugin. Paths and contents remain
unchanged, so each runtime and an independently copied plugin remain usable.
The local installer repeats this step after refreshing viewer resources.
`ditto` preserves the shared files; ZIP extraction may expand them. Report
allocated disk size separately from the sum of file sizes, and do not assume
the same savings for ZIP/updater installations. Run
`python3 tests/test-deduplicate-web-resources.py` to check bytes, permissions,
idempotence and macOS copying.

The browser-agent-shell build emits RDKit WASM as a separate binary shared by
its shell and worker, avoiding repeated base64 copies. Desktop WKWebView and
the hosted widget retain their existing loading policy. Completed Rust app
and helper executables have local symbols stripped before signing; original
unstripped executables remain in Cargo's target directory.

## Runtime Cache Layout

Desktop generated preview runtimes use the app cache directory:

```text
<app-cache>/viewer/
  assets/
  <runtime-id>/
    index.html
    manifest.json
    preview-config.js
    preview-data.bin
    xyzrender.svg
    xyzrender.log
  xyzrender-cache/
```

The `assets/` directory is shared across generated desktop runtimes. Runtime
directories are pruned by the preview service. The external `xyzrender` cache is
keyed by document identity or content, file metadata, renderer preset, controls,
the executable path, and available renderer version information.

Each generated runtime writes a `manifest.json` with schema version, completion
flag, document id, source extension, renderer, byte counts, and asset profile.
The manifest is written atomically after runtime files are staged so diagnostic
tools can distinguish complete runtimes from partial writes.

Quick Look keeps analogous generated files and `xyzrender-cache/` under the
extension cache container. Finder previews must not require the desktop app to
be running.

## Binary Payload Path

Desktop structure previews write the primary payload as `preview-data.bin` and
set `window.BuretteDataURL` in `preview-config.js`. `PreviewExtension/Web/viewer.js`
loads the binary data from that URL and falls back only when the runtime
configuration requires it.

This avoids duplicating large structures as both a binary file and base64
JavaScript. Keep `preview-data.js` as a compatibility fallback rather than the
default desktop path.

## RDKit WASM Loading

Grid runtimes load RDKit from shared assets:

```text
../assets/rdkit/RDKit_minimal.js
../assets/rdkit/RDKit_minimal.wasm
```

The runtime config exposes `rdkitWasmPath`, and `grid-viewer.js` passes it
through RDKit's `locateFile`. Do not inline `RDKit_minimal.wasm` into generated
per-document JavaScript. RDKit assets belong to grid profiles only.

## Grid Ingest And Search

Desktop collection previews use `apps/desktop/src-tauri/src/preview/grid_store.rs`
to parse SDF, SD, SMILES, SMI, CSV, and TSV inputs into SQLite. The initial grid
runtime is created after an early page-sized batch, and the UI receives:

- `indexing`
- `recordsIndexed`
- `recordsTotal`
- `indexReady`

Search semantics are defined by the shared, parameterized `LIKE` predicate.
SQLite FTS5 through `molecules_fts` is used only as a candidate-page fast path
after an exact count proves that the FTS candidates cover the complete `LIKE`
result inside the same read transaction. Substring queries that FTS cannot
cover, and runtimes without FTS, stay on the exact `LIKE` path. Pagination and
sort stay in the desktop grid command path so the web runtime does not need to
hold the entire collection in memory.

Grid bridge page sizes are intentionally split by host. Desktop Tauri and
browser-dev runtimes request 720 rows per page
(`apps/desktop/src-tauri/src/preview/runtime_grid.rs`,
`PreviewExtension/Web/grid-viewer.js`) to keep large-collection scrolling
smooth. Quick Look requests 48 rows per page to keep Finder extension memory
lower.

Local grid filter histograms are cached per column until the column/data catalog
is invalidated. Row edits, undo, derived values, and document reset clear both
the distributions and their effective-row snapshot; selection and scrolling do
not recompute them.

Chemical Space visibility paging requires an active map subscription. The host
sends `chemicalSpaceVisibilitySubscription` with `documentId`, `subscriberId`,
and `active`; each visible dock owns a subscriber and removes it when hidden or
unmounted. Hidden docks still observe source revisions. A grid `ready` event
rebinds subscriptions after runtime replacement. The ID scan reuses the first
page and continues in its sort order, stops when the last subscriber leaves or
the query token changes, and retains the existing 100,000-ID bridge limit.
`tests/test-grid-filter-performance.mjs` exercises these production paths with
bounded fixtures and counts accesses/requests without chemistry calculations.

`scripts/perf-smoke.sh` includes an opt-in FTS perf smoke:

```bash
BURETTE_PERF_RUN_GRID_FTS=1 ./scripts/perf-smoke.sh
```

## Journey Trace

A packaged app writes `PerfTrace.jsonl` to its cache directory
(`~/Library/Caches/<bundle id>/`, next to `BuretteApp.log`) and rolls it into
`PerfTrace.1.jsonl` at 8 MiB. Every line carries `at`, the Unix time in
milliseconds when the interval started. The webviews stamp the same clock as
`performance.timeOrigin + performance.now()`, so one journey reads across the
shell, the viewer frames and Rust.

By default the app records only IPC handlers that held their thread for 50 ms or
longer. With `BURETTE_PERF_TRACE=1` in the app environment it records every IPC
call, samples the main dispatch queue every 50 ms, and the shell loads
`apps/desktop/src/lib/perf-journeys.ts` to send its journey marks:

| `source` | Lines |
| --- | --- |
| `ipc` | One line per command with `name`, `window`, `ms` and `mainThread`. For synchronous commands, `ms` measures the handler itself. For async commands it measures dispatch only, not worker execution. `mainThread` identifies the dispatching thread. |
| `main-queue` | `main-queue:late` when a block queued on the main queue ran 17 ms or more late. It also catches main-thread work outside IPC, such as window setup, modal panels and menu tracking. |
| `native` | `app:setup` and `open:request` with the paths Launch Services passed in. |
| `web` | `frames` (rAF intervals of each second with the React commits, shell DOM mutations and viewer messages by type in it), `document:added`, `tab:switch`, `document:visible`, `document:ready`, `journey:timeout`, `iframe:mount`, `iframe:load`, `iframe:unmount`, `viewer:status`, `viewer:ready`, `viewer:error`, `input:*`, `mark:*`, and `agent:action` for each desktop agent action. |

Web marks carry a monotonically increasing `seq` and a `stream` identifying the
page's time origin; combine them with `window` to identify an event. The transport
keeps at most 2,000 unacknowledged marks, including the in-flight batch, and sends
serialized batches of at most 400. Native rejects an oversized batch in full
instead of silently truncating it. Failed requests retain their marks and retry
after one second. Overflow rejects newer marks and advances their sequence
numbers; `trace:transport` diagnostics report dropped marks and failed requests.
Their `totalDroppedEntries` and `totalFailedBatches` are cumulative per stream,
so replayed diagnostics must not be summed twice. These aggregate diagnostics
have no event sequence. A lost acknowledgement can
replay already accepted marks, so reducers must deduplicate `(window, stream,
seq)` before counting events. Page-hide flushing is best effort: closing the
webview or terminating the app can interrupt IPC, and the writer retains only
the live file and one archive. The benchmark reader drains a matching archive
on rotation and reports `rotationGaps` if an unread inode is no longer available.
Retain both files and allow drains to settle
before ending a measurement; this trace is not a durable event journal.

WebKit has no Long Tasks API, so frame intervals are the frame metric. Viewer
frames share the WebContent main thread with the shell, so a long shell frame
is a long viewer frame too. WebKit throttles occluded windows, so measure with
the window visible.

`scripts/perf-journeys.mjs` drives a perf build through a desktop agent session
and reduces the trace to p50 and p95 per journey:

```bash
mkdir -p build
nice -n 19 swiftc scripts/perf-host.swift -o build/perf-host
BURETTE_DEV_FLAVOR=perf BURETTE_TAURI_DEVTOOLS=1 ./scripts/build.sh
node scripts/perf-journeys.mjs --runs 10 --large-dir ~/perf-files \
  --out build/reports/perf-journeys-before.json
# After the change, on the same Mac:
node scripts/perf-journeys.mjs --runs 10 --large-dir ~/perf-files \
  --compare build/reports/perf-journeys-before.json
```

The native Swift helper inventories displays and app processes without
AppleScript. Compile it before running a journey or scalability benchmark.
The visibility timing is a native WKWebView rAF/iframe observation, not proof
of an OS-presented molecular frame.

`scripts/perf-scalability.mjs` also records explicit switch-action intervals,
requires 24 matching visibility journeys, and reconciles document-add marks
with independently observed totals at 1/10/100/1,000 documents. Its `integrity`
record fails on missing marks, incomplete switches, trace errors or legacy
unsequenced instrumentation; zero legacy error counters do not prove no loss.
Keep timing budgets separate from this measurement-integrity result.

For repeated admission/ready latencies without memory sampling, use
`node scripts/perf-scalability-repeat.mjs --app <dev.app> --out <fresh.json>
--runs 10 --fixtures build/perf-scale-fixtures`. Each repetition owns a fresh
process/session, opens 1/10/100/1,000 incremental documents and emits a
`<report>.run-NN.json.ready` rendezvous for CUA File > Close All Tabs. The next
launch requires an independently observed empty workspace. Per-run traces and
hashes are retained. `observed` p50/p95 includes exploratory/legacy samples;
`validated` includes only complete runs with sequenced, conserved traces.
The required ready endpoint matches the first new requested path and document
identity, rather than accepting an already-ready previous active viewer.

| Journey | Measures |
| --- | --- |
| `launch` | New process to the first shell rAF mark, then main-thread work until the app settles. OS file caches are not flushed. |
| `open` | Per sample file, cold and warm: `Rendered` status, `ready`, parsing status messages, iframe loads and main-thread IPC. Status messages are not a count of actual scientific parses. |
| `tab` | Warm switches between four open files: time to the first visible frame, blank frames, iframe reloads and React commits. |
| `pose`, `trajectory` | Completion of one SDF pose or trajectory setter per agent action; not input-to-presented-frame latency. |
| `spin` | Frame intervals while the large CIF spins. |

`--large-dir` names a directory with `moses_10k.smi`, `moses_10k.sdf` and
`4UG0.cif`; missing journey fixtures are reported explicitly and fail the run. The script waits until the
keyboard and mouse have been idle before the app takes focus, hands focus back
as soon as the window shows by default. Use `--foreground` for frame measurements
so the test window retains focus. It quits only the build it launched. It prints the
journeys over the budgets below, and with `--compare` it exits with status 1
when a p95 rises beyond run-to-run noise. A timeout always fails. `--enforce-budgets` also fails on absolute budgets. The report records the executable SHA-256 and writes the raw events to `<report>.trace.jsonl`.

Reports include fixture byte counts and SHA-256 hashes, skipped journeys and
runtime failures. The harness commit identifies the runner, not the app source
revision. Keep the build source revision alongside each executable hash when
comparing saved app bundles. A loaded Mac run is exploratory, even with ten
repetitions; it does not certify the unloaded-Mac performance targets.

`renderedStatusMs` is the viewer progress notification, not an OS screenshot or
proof of a displayed frame. `readyMs` ends at the viewer ready handshake;
`visibleMs` only describes the iframe becoming visible. Do not interchange them.
The runner refuses production bundles and existing sessions, and terminates
only processes launched with its own agent session.
The runner rejects locked-screen runs because WebKit stops presenting frames.
Keep the screen unlocked throughout a series; process-scoped `caffeinate -di`
can prevent idle display sleep without changing persistent system preferences.

## Performance Budgets

Use these budgets as guardrails for future changes:

- Normal app launch remains a visible full-window app launch.
- Opening a regular non-grid PDB must not copy RDKit assets.
- Grid previews may load RDKit, but RDKit JS/WASM must be shared from the
  profile assets directory.
- Generated desktop structure runtimes should prefer `preview-data.bin` and
  avoid base64 JavaScript for large payloads.
- Reopening the same external-renderer preview with unchanged settings should
  hit the `xyzrender` cache.
- Large grid files should show the first page before complete indexing when the
  streaming store can parse the format.
- Quick Look smoke remains separate from desktop launch smoke.
- Preview runtime changes should preserve `manifest.json` and
  `preview-trace.jsonl` diagnostics.
- No IPC handler or other main-thread work holds the main thread for 100 ms or
  longer during launch, a tab switch or a pose step.
- A warm tab switch shows its viewer within 100 ms, with no blank frame and no
  iframe reload.
- A pose or trajectory step takes 100 ms or less.
- While a large structure spins, the p95 frame interval stays within 16.7 ms on a
  60 Hz display.

## Do Not Regress

- Do not restore removed renderer paths as a performance shortcut.
- Do not make Burette a background-only helper to improve launch metrics.
- Do not inline RDKit WASM or molecule payloads into per-document JavaScript by
  default.
- Do not make Quick Look depend on a running desktop process.
- Do not bypass `config/web-runtime-profiles.json` when adding or removing web
  assets.
- Do not remove diagnostics, cache metadata, or perf smoke hooks when changing
  runtime generation.

## Checks

Lightweight checks:

```bash
bun tests/test-tauri-structure.mjs
bun tests/test-ui-shell-contract.mjs
bun tests/test-bun-installer-behavior.mjs
```

Measurement scripts:

```bash
./scripts/size-report.sh
./scripts/perf-smoke.sh
```

Full macOS runtime verification still requires building and installing the app,
then running forced Quick Look previews as described in
`docs/quicklook-debugging.md`.

The scheduled GitHub workflow `.github/workflows/nightly-smoke.yml` keeps the
full packaged-app and Quick Look smoke path out of fast PR validation while
still exercising the build, install, forced preview, and perf report scripts on
`main`.

The normal desktop and browser-dev Generate 3D, ensemble, and geometry
optimization actions use the native Metal compute path. Metal errors are
reported without retrying Python generation. The retired engine preference is
removed on settings rehydration and snapshot restore. The legacy Python command
remains available to older clients using direct RDKit (the old `datamol` request
name is accepted as an alias); explicit external CREST preparation also uses
RDKit directly.
