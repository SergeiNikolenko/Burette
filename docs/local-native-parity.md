# Local visualizer status

The local plugin is a visualization and chemical-editing workspace, not a new
molecular-analysis engine. It reuses the Burette UI and Mol* viewer.

## Implemented

- Packaged offline workspace and local-file opening, with tab management.
- Ketcher editing and existing Story workflows.
- Camera, style and color controls, scene observation and image capture.
- Exact atom/residue/chain and spatial selection, current selection and
  viewer-instance named bookmarks.
- Numerical distance, angle and dihedral measurement.
- Named visual layers with bounded edits, revision checks and Mol* Undo.
- Persistent session action history so completed commands do not fill the queue.

Automated contract and Mol* integration coverage exists for these paths.
This does not by itself qualify the installed native UI.

## Remaining acceptance work

September 13 widget revision: the bottom dock toggle and its internal resize
handle are removed in native inline mode, while side-pane mode preserves the
dock state. The placement menu and trigger use the shared themed shadcn/Radix
components, including the application-shell portal. The September 11 manual
card-resize experiment is withdrawn; inline height is fixed during startup.
These changes require fresh packaged/native acceptance, not the old screenshot.

- Verify the refreshed installed plugin in an unlocked native pane: local open,
  tab switching, selection, style/layers, measurement and capture.
- Verify ordinary save/export through the real native file handoff and its
  acknowledgement. Do not describe an offered download as a saved file.
- Check reopening the intended saved artifact; named selection bookmarks are
  instance-local, not a portable project format.

## Local hardening candidate — 2026-09-10

Installed candidate: `0.2.2+codex.20260910025443`. No public release was made.

- Fixed loading-overlay CSS specificity so a hidden overlay cannot cover the
  ready workspace; added computed-style coverage for loading, ready and error.
- Added explicit awaiting-mount, stale, loading, empty, error and ready lifecycle
  states. Commands no longer treat an old heartbeat as a live renderer.
- Prefetch independent preview assets while preserving script execution order;
  static module downloads share a four-request pool without batch barriers.
- Cache immutable, integrity-checked source snapshots within the existing
  eight-file/16 MiB limit. Concurrent reads and tab revisits reuse a transfer;
  failed transfers remain retryable and disposal releases the cache.
- Isolate extract/remove/replace outputs in private per-operation directories;
  concurrent equal-title operations cannot overwrite each other's results.
- Reject oversized, unsupported and malformed report blocks before rendering.
- Full remote agent-shell packaging and `vp run test:agent` passed on Gauss.
  The expanded native workspace group passed 69/69 tests after packaging.
  Local plugin validation, packaged-mirror and release-alignment checks passed.
- Installed native HTML SHA-256:
  `602c76f0affb8bb933d5735c79a23a4c5d3551b730cd44dc80a0e22eacfc2304`.
  Installed server bundle SHA-256:
  `d434d3a7186305fd9db9d1e074a362ff6892ed7b2d088b13a65e4df69e3b2c85`.
  Both match the rebuilt source package.

Native acceptance is still pending, not passed. The task's pre-update opener
never published a renderer state (revision zero), and Computer access to Codex
was unavailable. A fresh plugin-enabled task is required to load the updated
tools and UI. Opening, commands, export/save acknowledgement and reopening must
be verified there. No native time-to-visible measurement or speedup percentage
is claimed; the tests prove reduced transfers and concurrency, not host latency.

Post-install live check: all seven running `server-bundle.mjs --stdio`
processes still have their working directory in the previous
`0.2.2+codex.20260909102000` cache backup. None uses the new installation.
The task's existing session remains `ready: false`, revision zero; observing
it through the newly installed session module reports `awaiting_mount` with
no heartbeat. This confirms the runtime pickup/host-mount gate is still open;
it does not establish why the host has not mounted the pane. Existing processes
and other tasks were not interrupted to force a reload.

September 11 re-entry check found a different installed package: plain `0.2.2`,
with installation metadata pointing to `/Applications/Burette.app/Contents/Resources`.
All seven live plugin processes used that package, and the exposed tool catalog
lacked `open_viewer` and `observe_inline_viewer`. Thus reopening Codex alone did
not load the candidate. The application updater contains bundled-plugin install
paths; this is a possible overwrite route, not proof of which action replaced it.
The unchanged candidate was restored with its repository installer; CLI install
succeeded, and a checksum-based recursive comparison found no differences from
the source package (excluding local install metadata and dependencies).
Native acceptance still requires the host to load the restored tool catalog.

September 11 fresh-task acceptance (`bf981438-5d16-4b75-821c-4363f4f04a6c`):
the current tool catalog exposes `open_viewer`, `observe_inline_viewer` and
`control_inline_viewer`. Installed manifest version is the restored candidate;
checksum-based recursive comparison of source files against the cache found no
differences (excluding dependencies and install metadata). Both bundle hashes
above remain unchanged. Source is still `fix/local-plugin-workflow` at
`077ed1eb2fa942df8d0508b62b92a1bce5469c1f` with the existing staged changes.

Exactly one native opener was called for `samples/structures/proteins/1htb.pdb`.
The tool returned in 75 ms, which measures session creation only. Observations
at approximately 6 and 26 seconds both reported `ready:false`, revision zero,
`lifecycle.status:awaiting_mount` and no heartbeat. Time to ready or visible
canvas therefore remains unmeasured. No duplicate workspace was opened.
Computer rejected native Codex access with
`Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.`
No alternative capture/CDP route was used. Native action acknowledgements,
tabs, selection, styles/layers, measurements, capture, Ketcher, collections,
Story/frames, reports and ordinary save/export/reopen remain unverified in this
fresh session. Continue with this same session after its pane is mounted and
native visual access becomes available; do not infer a renderer defect from
the missing mount alone.

## Release preparation — 2026-09-08

Local candidate: `0.2.2+codex.20260908154846`. This is a development candidate,
not a published stable release. The visual runtime is unchanged from the
previous cleanup build; this update only fixes plugin/skill metadata.

- Plugin validator passes: skills have display metadata, the unsupported
  manifest supportURL field is removed, and invocation policies are unchanged.
- Release-version alignment, plugin contract and packaged-mirror checks pass.
- Ten focused transport/checkpoint/packing tests pass, including snapshot
  restoration in the test host. This is not native-host acceptance.
- Normal local CLI installation succeeds; the installed source is checked
  against the candidate package.
- Native acceptance remains pending: the existing workspace reports not ready,
  and Computer access to the Codex app is unavailable. No duplicate workspace
  was opened to substitute for this test.
- File export/reopen remains pending. Browser download initiation is not a
  confirmed native file save.

Before publication, record native evidence against this candidate (or its
unchanged runtime), then choose the stable plugin version and distribution
target. Desktop app signing/notarization and the hosted public plugin are
separate release surfaces; neither is certified by these local checks.

## Removed from this scope

Custom SASA/BSA calculations, contact-report sorting, bonded-graph query
extensions and explicit paired-atom fit/apply/reset APIs were removed.
The unfinished classified-interaction implementation was also discarded.
Existing Mol* features, including its own visualization and analysis controls,
are unchanged. Do not expand this checklist into a scientific-analysis roadmap.
