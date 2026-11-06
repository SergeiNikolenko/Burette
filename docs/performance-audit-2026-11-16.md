# Interaction Performance Audit — 2026-11-16

## Scope and evidence

This audit covers Burette's interaction latency: menus, panels, sliders,
resizing, collections, search, and molecular views. The requested acceptance
surface is the packaged macOS app in a macOS virtual machine on Orion.

The inventory below distinguishes source, isolated and runtime evidence:

- **Source-confirmed:** the implementation establishes the mechanism, but not
  its contribution to an observed native delay.
- **Focused test or microbenchmark:** production functions or components were
  exercised in an isolated harness. CPU timings exclude native event delivery,
  layout, painting, GPU completion, and VM presentation unless stated otherwise.
- **Runtime observations:** native VM and production/browser-dev measurements
  are labeled separately. A passing browser or component test does not prove
  packaged native behavior; unverified workflows remain explicit in the matrix.

This document records measured fixes and explicit coverage limits, not
whole-application performance acceptance. Existing [performance architecture](performance.md) and
[interaction principles](interaction-principles.md) remain the implementation
and acceptance references.

## Coverage matrix

| Surface / interaction | Evidence and result | Remaining limit |
| --- | --- | --- |
| Settings sliders | Native matched drags: 13 → 1 persistence calls; component tests cover Undo, keyboard, external reset and cancellation | Only two native matched gestures; no universal latency claim |
| Appearance sliders | Live preview retained; component tests pass; final native light theme and retained molecular view verified | Live-history/persistence fan-out remains a profiling candidate |
| Trajectory / pose slider | Debounce starvation fixed; scheduler tests cover continuous input/slow rendering; native XYZ Next verified | A 120-frame XYZ loaded, but the guest panicked before continuous drag; that native test is unverified |
| Command palette | Localized query subscription and windowed large results; production browser keyboard, scrolling, first/last results and threshold transitions verified | Browser timing is not native WebKit timing |
| Native menus | Ten application menus (Burette and File through Help) visually opened in the VM; scene tree and Style dropdown also exercised | Commands and every contextual submenu were not exhaustively executed |
| Scene tree | Two quadratic traversals corrected; shape/complexity tests and native small-tree opening pass | Large-tree DOM replacement remains a separate profiling target |
| Panels / docking | Native bottom-panel transfer/resize and right Inspector verified; molecular content retained | Full docking/comparison workflow and every popout not covered |
| Resize | Native window/sidebar/bottom-divider gestures completed; GL-buffer protocol test passes | Native window resize remained slow in the unstable virtual GPU environment |
| Grid cards / table scroll | Rail churn/cache corrections tested; real browser 1,000-record Grid scroll and rail navigation pass | Native large-grid timing and remote paging not established |
| Grid virtual window | CPU benchmark confirms full-list copy/filter; no additional cache redesign | Profile larger real collections before further complexity |
| Sidebar / file tree | Production actual Show more: 1,000 controls → 32; End/Home, full selection anchors and scroll geometry retained | Lightweight anchors remain O(N); broad query stress is labeled synthetic |
| Collection search | Synchronous local SMARTS path identified in source | No confirmed production timing; no claimed SMARTS optimization |
| CSV / XLSX | Browser 10,000-row CSV scroll keeps bounded row window and header | Native Find indexing and XLSX path not timed |
| Collection inspector | Native Inspector shows matching PDB atom/chain counts; retained-iframe implementation inspected | Rapid collection-row switching/popout not exhaustively covered |
| Tabs / settings return | Host-only settings classification corrected; final VM roundtrip has no iframe mount/unmount/load and the molecule stays visible | High-tab-count residency and every navigation history path were not benchmarked |
| Sequence panel | Closed-panel observer fan-out reproduced; visible-width guard prevents hidden option serialization | Visible long-sequence layout cost not measured |
| Other document views | Browser Ketcher ring placement/Undo, Markdown scroll, PNG zoom and MSP controls pass | Ketcher Redo was not established; no all-format/scientific-compute acceptance claim |
| Finder Quick Look | Shared-runtime contract checks pass | Extensions absent from desktop-only VM bundle; native Quick Look not established |
| iPhone / hosted plugin | Shared source unchanged at public boundaries | Separate products were not performance-tested |

## Implemented changes

### Grid navigation rail

Owner: `PreviewExtension/Web/grid-viewer.js`.

Previously, scroll could update the active rail marker through two listeners.
Even when the virtual row range had not changed, `renderVirtualWindow()` called
`updateChrome()`, rebuilding the rail's buttons through `innerHTML` and then
reading card geometry. Finding the active row also scanned the loaded rows.

The patch:

- Uses the existing animation-frame scheduling for scroll updates and removes
  the duplicate rail scroll listener.
- Updates only the active marker when the retained virtual range is unchanged.
- Reuses rail buttons when their generated markup is unchanged, preserving
  keyboard focus and avoiding repeated lens style writes.
- Caches source-index positions by result-array identity and length.
- Avoids DOM writes when a marker's active state is unchanged.

The index cache was audited against the current mutation paths. Sorting in
`refresh()` follows creation of a new result array. Replace, delete, merge,
filter, and undo replace the array. Remote page appends and duplicate/split
inserts change its length. Source indexes are not reassigned in place. No
current cache-invalidation regression was found. This conclusion is about the
current implementation, not permission for future in-place reorder/reindexing.

`tests/test-grid-rail-performance.mjs` executes production functions with a DOM:
20 unchanged updates produce zero DOM mutations and retain focus; moving the
active row across indexes 4901–4919 performs zero additional row-index reads
after cache creation. It also covers replacement/sort, append, filtering,
renaming, and 20 scroll events coalesced into one scheduled frame. These are
operation-count checks, not native frame-rate measurements.

### Scene tree construction

Owner: `PreviewExtension/Web/viewer.js`.

Sibling type counts are now computed once per parent instead of filtering the
sibling list for each displayed row. Measurement target lookup reuses the
already-built children map. This preserves the existing tree and selection
semantics while reducing repeated computation.

The focused regression test covers ordinary and measurement rows. The measured
CPU construction cost is recorded below. The open scene tree still replaces
its DOM after state commits; that separate cost has not been removed.

### Continuous pose scrubbing

Owner: `PreviewExtension/Web/viewer.js`.

The 24 ms pending slider flush is no longer cancelled and restarted by every
input event. New input updates the pending pose while the already-scheduled
flush remains due. This prevents uninterrupted input from starving live
scrubbing. `tests/test-trajectory-loop-timing.mjs` covers the scheduling path.
Native pose latency and camera interaction remain pending.

### Settings and command palette

Owners: `apps/desktop/src/components/settings-panel/setting-control.tsx`,
`apps/desktop/src/components/command-palette/index.tsx`, and
`apps/desktop/src/App.tsx`.

Settings ranges retain a local displayed draft during dragging and commit the
preference once at gesture completion. Explicit live-update mode remains for
appearance controls. Previously, repeated preference changes could repeatedly
capture workspace-history snapshots, compare history state, persist storage,
rerender the app, and synchronize native settings.

The real slider integration test checks five gesture updates with no history
entry before release, one entry on release, Undo, keyboard changes, external
updates, and live appearance behavior. The settings and UI-shell focused checks
passed in the implementation agent's validation.

Command-palette query subscriptions were moved out of App, and project-item
construction no longer depends on the query. This narrows the render/update
scope while preserving command construction from the current query. The real
React/cmdk test uses 40 project records and three query changes: shell render
count and project-item reads remain unchanged, all 40 matching structures stay
reachable, and external query updates and document actions are verified. This
is operation-count evidence; native typing latency remains pending.

### Returning from compute settings

Owner: `apps/desktop/src/hooks/use-app-preference-effects.ts`.

Native inspection found a separate delayed remount after returning from
Settings: the retained scene appeared first, then was replaced after editing
conformer candidates from 128 to 232 and back. The preference effect classified
unlisted keys as runtime-preparation changes. Both conformer defaults were
unlisted, so either edit queued every open path for a rebuild on activation;
restoring the original value did not remove that queued rebuild.

Conformer defaults, Open In destination and shortcut overrides are now explicitly
host-only preferences. Equivalent preference snapshots also leave loaded
runtimes intact. Renderer/preparation changes retain their existing rebuild
path, and appearance changes retain live updates. The focused hook regression
failed before the fix with an unexpected `/a.pdb` reopen after the exact
candidate-count round trip, then passed with the fix. Existing dirty-scene,
renderer-switch, live-appearance and superseded/closed-request checks pass.
Native acceptance of this additional fix remains pending.

## Large-search follow-up

A real Chromium run on Gauss confirmed the remaining mounting cost with a
synthetic project containing 1,000 tiny PDB files. The controlled baseline
closed all molecular documents before typing, separating list work from
renderer startup. Earlier exploratory timings with overlapping startup are
not used for the comparison.

The command palette now windows large search results while retaining every
result and the selected option. Arrow, Page, Home/End, Enter, numeric shortcuts,
scrolling and pointer selection are covered. Small grouped menus keep their
existing path. Stable option IDs and controlled-selection normalization keep
the active descendant valid when a result disappears or the list changes size.

Sidebar search keeps lightweight navigation anchors for every matching file,
so existing keyboard and Shift-range semantics still see the complete list.
An IntersectionObserver shared by the scroll container mounts file controls
only near the viewport (240 px overscan), when focused, or retained during a
shared drag. This bounds expensive components, not the total number of DOM
anchors. Folder hierarchy and existing row actions remain intact.

Real-component tests include 1,000 results, selecting and opening the last
result, keyboard range selection, cancellation/focus ownership, scrolling, and
query transitions. Browser before/after measurements and native smoke results
are recorded separately below when complete.

## Production browser comparisons

Gauss ran headless Chromium at 1440 × 1000 against production desktop bundles
served through the repository's prebuilt browser transport. The fixture project
contains 1,000 on-disk copies of `mini.pdb`; all molecular documents were closed
while measuring search. Real input events were used. Times end after two
animation-frame callbacks, not an OS-presented paint. This is one exploratory
before/after sequence, not a p95 benchmark.

| User action | Before | After | Mounted controls before → after |
| --- | ---: | ---: | ---: |
| Palette query `m` | 174.1 ms | 44.0 ms | 1,014 → 19 |
| Palette query `mo` | 109.9 ms | 41.3 ms | 1,011 → 19 |
| Palette query `mol` | 114.3 ms | 26.6 ms | 1,005 → 19 |
| Palette query `mole` | 105.8 ms | 27.2 ms | 1,005 → 19 |
| Palette query `molecule-` | 149.5 ms | 43.1 ms | 1,000 → 19 |
| Sidebar Show more, empty query | 614.5 ms | 119.6 ms | 1,000 → 32 |

The five large-result palette queries had 64–126 ms long tasks before and none
at least 50 ms after. Sidebar expansion reduced settled DOM nodes from 11,333
to 1,685; its 30,222 px scroll height remained exact. One 51 ms long task remained
after expansion. End reached file 0999 and Home restored the header and scroll
position zero. No page errors were observed.

A separate direct-store sidebar-query stress test was not a normal general-search
workflow: the header search button opens the palette. React development profiling
(`addObjectDiffToProperties`) dominated a delayed approximately one-second task
in that stress test. Its early paint is not used to claim a production speedup.

A browser-dev 1,000-record SMILES Grid kept 72 cards while scrolling; the last
sampled rail destination (position 976) produced a window containing 948–999.
The 10,000-row CSV moved its row window from 2–39 to 149–186, retaining header 1.
These establish browser behavior, not native Grid/Find performance.

### Other renderer-family smoke

In the browser-dev surface, a real Ketcher template/canvas interaction produced
six atoms and six bonds; Undo returned the document to zero atoms. Redo was not
established and is not certified. A 50-section Markdown document rendered and
scrolled 1,800 px. A PNG rendered on the image canvas and Zoom out changed 500%
to 417%. A three-peak MSP spectrum rendered and its Normalize/Top labels controls
responded. No page errors were recorded. These are functional samples, not
production startup budgets or native acceptance.

## CPU microbenchmarks

### Grid virtual-range calculation

Production `virtualWindowRange()` and `cardViewRows()` were executed in Node
on the local Mac. Layout measurement was replaced with fixed geometry to
isolate the collection-processing cost. The fixture used one invalid-card
record per 1,000 rows, 10 warm-up calls, and 120 measured calls per size.

| Loaded rows | Invalid-card membership checks, 120 calls | p50 | p95 | Maximum |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 120,000 | 0.023 ms | 0.028 ms | 0.048 ms |
| 10,000 | 1,200,000 | 0.200 ms | 0.300 ms | 1.066 ms |
| 50,000 | 6,000,000 | 0.984 ms | 1.480 ms | 1.852 ms |

The full collection is copied/filtered even when the visible window is small.
An actual changed window repeats this work during row selection, and remote
load checks can repeat it again. These timings do not measure native scrolling
or establish that this is the dominant bottleneck in the VM.

### Scene tree construction

The viewer implementation agent measured production tree functions in Node on
the Mac with synthetic flat scenes; times are medians of five runs.

| Scene rows | Map reads before → after | CPU time before → after |
| ---: | ---: | ---: |
| 100 | 10,400 → 500 | 0.96 → 0.52 ms |
| 500 | 252,000 → 2,500 | 12.67 → 0.77 ms |
| 1,000 | 1,004,000 → 5,000 | 48.82 → 0.97 ms |
| 2,000 | 4,008,000 → 10,000 | 219.40 → 1.78 ms |

Before child-map reuse, 1,000 measurement rows additionally caused 1,002,001
cell visits when constructing child maps. The regression now checks linear
visit growth. DOM creation, layout and native presentation are excluded.

## Remaining source-confirmed mechanisms and profiling targets

1. **Grid full-list filtering during scrolling.** `virtualWindowRange()`,
   `renderVirtualWindow()`, and `maybeLoadMoreForRenderedRange()` each use
   `cardViewRows(state.rows.slice(...))`. Defer further optimization until VM
   evidence determines its priority. A narrow fast path for collections without
   invalid cards would avoid broad cache invalidation. A general cache must
   account for invalid-card changes and in-place SMILES enrichment in
   `rowSmiles()`, not only array identity.
2. **Synchronous local SMARTS.** `filterBySMARTS()` loops over the collection and
   `substructureMatch()` constructs and deletes an RDKit molecule per row. The
   120 ms search debounce does not make that loop interruptible. Confirm the
   sizes and frequency of local-mode collections before selecting worker,
   server, or cooperative-yield changes.
3. **Sidebar search mounting.** `filterSidebarProjects()` returns the complete
   project when its title matches. `ProjectGroup` removes collapsed-item limits
   and force-expands folders during search. This can mount thousands of rows at
   once. Check the actual project workload before changing result presentation.
4. **Native Find indexing.** `FixedGridNativeFindIndex` delays readiness, then
   builds up to 250,000 cells synchronously in `useMemo`. Idle scheduling of
   readiness does not split the subsequent React computation.
5. **Viewer observer fan-out.** `observeMolstarViewportPanel`,
   `installMolstarFloatingPanelTracking`, and `installLeftPanelVisibilityGuard`
   observe broad DOM mutations. A focused happy-dom harness executed the actual
   left-panel observer and its helper functions with a hidden sequence panel.
   Sixty unrelated hover-element `transform` changes caused 60 sequence sync
   requests, 60 corner-layout scheduling requests, and 120 document-wide queries
   (60 each for left regions and sequence tooltips). These are operation counts,
   not browser layout or native latency measurements. The sequence adapter's
   `refresh()` returns when `panel.clientWidth` is zero: a closed sequence does
   **not** serialize select options or scan wrapper geometry. An open sequence
   does perform that work. Measure callbacks and forced layouts during actual
   menus, hover, sequence and panel interactions before narrowing observers.
6. **Floating layout and resize release.** `updateFloatingLayoutOffsets` mixes
   CSS writes and geometry reads. The resize interaction script retains input
   suspension until the deferred restore. Measure the first camera interaction
   after divider release before altering the resize protocol.
7. **Eager viewer control bundles.** `browser-dev-documents.ts` emits blocking
   script tags for the sequence and native-viewer control adapters before
   `viewer.js`. Their generated files are approximately 412 KiB and 712 KiB in
   this checkout; both are independent IIFE builds importing React and
   `react-dom/client`. The Mol* bundle is approximately 5.2 MiB and `viewer.js`
   1.5 MiB. These on-disk sizes do not measure transferred bytes, parse time or
   retained memory. Profile cold opening versus retained-view activation before
   choosing lazy control initialization or shared bundle changes. The primary
   generated HTML preloads Mol* with a stable asset URL; the timestamped dynamic
   loader is a fallback, so it does not prove repeated Mol* downloads on that
   primary path.

Existing optimizations should be preserved: grid DOM virtualization, cached
search text and histogram statistics, lazy closed sidebar branches, hovered-only
marquee measurement, retained inspector iframe, and hidden-viewer render-loop
suspension.

## Validation inventory

Passed focused checks reported during this audit:

- `bun tests/test-grid-rail-performance.mjs`
- `bun tests/test-grid-filter-performance.mjs`
- `bun tests/test-grid-paging-contract.mjs`
- `bun tests/test-grid-remote-load-ownership.mjs`
- `bun tests/test-grid-card-scheduling.mjs`
- `bun tests/test-scene-tree-presentation.mjs`
- `bun tests/test-trajectory-loop-timing.mjs`
- `vp test -t 'test-command-palette|test-ui-shell-contract|test-settings-controls'`
- `bun tests/test-viewer-bridge-message-contract.mjs`
- `bun tests/test-cross-platform-preview-contract.mjs`
- `bun tests/test-molstar-resize-interaction.mjs`
- `bun tests/test-preference-runtime-refresh.mjs`
- `vp test -t 'test-sidebar-virtual-items|test-sidebar-tree-render|test-sidebar-tree-collapse'`
- `bun run typecheck` on Gauss after preparing the pinned Mol* source declarations.
- JavaScript syntax checks for the touched grid/viewer runtime files.

The cross-platform static contract still expected the old direct `spawn` call;
it now checks the existing `startAgentServer` owner after the preceding server
lifecycle refactor. No application code was changed to satisfy that stale check.

## Native acceptance record

Baseline, stage-one and final desktop-only x86_64 development bundles were
cross-compiled on the local Mac and ad-hoc signatures verified. The isolated
VM is `burette-perf-1116` on Orion (12 vCPUs, 24 GiB RAM, macOS 26.7.2,
Reims paravirtual GPU on RTX 3080). The bundle identifier is
`com.local.BuretteV10.Dev.orionperf1116`; the baseline source is `12912fa2`.
This build omits Quick Look extensions, the Python renderer, and Metal compute
kernels; it is not a release-package acceptance build.

A guest kernel panic occurred at 02:09 Moscow time in WindowServer, with
`AppleParavirtResource::free` / `AppleParavirtGPUIOGPUFamily` in the backtrace.
GPU-reset reports already existed at 02:01 for Setup Assistant, before the
Burette launch. This establishes graphics-environment instability; it does not
identify an application-level cause. Preserve the panic and GPU-reset evidence
and exclude reboot/graphics-failure intervals from latency comparisons.
Following reboot, the baseline opened the PDB and the File menu visibly.

### Matched native settings gestures

The same two-second pointer drags changed **Conformer set candidates** from
128 to 232 and back. Each gesture sent 60 pointer updates per second. The table
uses the gesture interval plus a 500 ms settle window; frame intervals are
reconstructed with the repository's `perf-journey-metrics.mjs` reducer.

| Gesture | Native preference syncs, before → after | Frame p95, before → after | Main-thread IPC total, before → after |
| --- | ---: | ---: | ---: |
| Increase | 13 → 1 | 28 → 18 ms | 46.62 → 2.32 ms |
| Restore | 13 → 1 | 23 → 18 ms | 17.95 → 1.89 ms |

Both final values were visually checked. This is two matched exploratory VM
gestures, not a statistically powered latency benchmark or evidence that every
interaction meets a budget. Commit/mutation counters were zero in these
production traces and are not interpreted as absence of React work. The two
covered intervals contained no frames longer than 50 ms, before or after.
Uncovered trace windows are explicitly marked unavailable by the reducer.

### Final native settings-return regression

Final source `8f5c93f7ffde` repeated the 128 → 232 → 128 settings roundtrip.
Each drag still produced one preference-sync call (1.225 / 1.126 ms). From the
first drag through the post-return observation, the trace contained no iframe
mount, unmount or load. The immediate screenshot showed the retained molecule.
The tab visibility handshake was 75 ms, with `remounted: false`; it is not an
OS-presented-frame measurement.

The final archive SHA-256 is
`9998202366ce3f74dd276ddf73561ff8c6f21bdec6f89c09541c4706e156a69a`;
its x86_64 executable SHA-256 is
`ca7a8f420c892616379b94dd0ac55a22c9b2e4b8a9cef3fe5b07518265140aca`.
Ad-hoc deep/strict signature verification passed. All changes are on the
`perf/interaction-audit` branch in three focused implementation commits.

Baseline native-window resizing remained slow (frame p95 637/470 ms in two
exploratory drags); the current patches do not claim to fix that cost. The
unstable guest GPU prevents attributing it solely to Burette. Baseline also
experienced a second guest panic at 02:22:43 Moscow time; affected runs are
excluded from comparisons. A third guest panic was recorded at 02:50:20 during
an idle interval before the final build launched.

The final pass also verified native palette query/keyboard navigation and light
theme settings/viewer output. A synthetic 120-frame water XYZ loaded and showed
frame 1/120, but a fourth guest kernel panic at 03:14 occurred before the
continuous drag.
That drag is explicitly unverified; native load success does not prove scrubbing.
No VM GPU or host configuration was changed to conceal this limitation.

Representative native fixtures include `mini.pdb` (829 bytes, 9 atoms), the
196-byte two-frame `trajectory.xyz`, and the separate synthetic 120-frame XYZ.
Full fixture hashes, screenshots, native traces, gesture timestamps, browser
results, build fingerprints and the three application archives are retained in
the local `performance-audit-20261116` evidence package. `REPORT.md` is its
illustrated entry point. Native and browser reports label their distinct surfaces.

The remaining prioritized work is native-window resize in a stable GPU
environment, full continuous-trajectory native acceptance, local SMARTS/main-thread
Find profiling, and broader contextual/editor workflows. These are not presented
as completed fixes or as failures caused by the reviewed patch.
