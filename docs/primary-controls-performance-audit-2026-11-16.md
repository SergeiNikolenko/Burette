# Primary controls performance audit — 2026-11-16

This follows the [application interaction audit](performance-audit-2026-11-16.md), with priority on the controls used directly over a molecular scene. The user requested discovery and testing without having to identify the problematic controls.

The confirmed slider and menu defects are fixed, including native proof that Match background opacity changes while the mouse remains held. Repeated WindowServer/GPU panics prevent whole-application native performance acceptance.

## Changes

Source stage `7311ef2f1bee`:

- Inspector background opacity sends the latest value once per animation frame instead of waiting for a 150 ms quiet period. Pointer release and keyboard changes persist the final value. Closing a document preserves the value without sending to a removed viewer. External viewer updates do not suppress a later return to a previously used value.
- Docking-scene background opacity enters the existing coalescing appearance queue.
- Representation, opacity and measurement queues retain the latest value per object and parameter. Moving a second control no longer overwrites the first control's pending final value.
- Symmetry scale updates during the gesture. Undo and Redo wait for the accepted slider updates before capturing or restoring scene state, preventing a queued write from overwriting an undo.
- Floating-menu placement uses its untransformed dimensions. The entrance animation no longer changes the dimensions used to reposition the menu and trigger another layout pass. Visibility helpers read each rectangle once.

Source stage `3bcb9a338b23`:

- The shared Mol* settings controls apply FOV, fog intensity, clipping radius and near clipping during movement. These changes send only the affected canvas settings and skip unrelated layout/context work.
- Other settings retain the original mapping. Geometry parameters were not globally changed to update immediately.
- Mol* and Mesoscale bundles, packaged mirrors and the vendor lock were regenerated from the pinned source on Gauss.

The normal desktop Camera popup exposes Reset zoom, Lay flat and Reset axes, not the four shared settings sliders. The shared-settings change is not evidence that those controls are reachable through the desktop Camera popup.

Stage `c6fbca2a95c0` regenerates the packaged agent's `viewer.js` and `grid-viewer.js` mirrors, including the earlier collection fixes. The documented agent-shell build and full mirror check passed against clean source on Gauss (36 runtime files and 12 scripts). The local working copy additionally contains a pre-existing, unrelated CSS edit; it was preserved and excluded from these commits and build inputs.

Stage `18401c364260` fixes an additional defect discovered in the native test: docking All-background **Match** ignored opacity when matching the default/illustrative scene style. Its control sent values, but the renderer forced all representations to alpha 1. Match now fades the existing representations, retaining their types, component identity, colours and relative opacity. Pose changes and Single restore the appropriate base appearance. Later explicit representation colour/opacity edits become the new base, so the background control cannot erase them. Match-only changes do not reload the scene or recreate water representations. Explicit non-Match style changes retain their existing rebuild/restoration behavior.

## Browser evidence

The diagnostic surface was isolated Chromium on Gauss, Vite browser-dev, viewport 1440 × 1000. It complements native acceptance; it is not a production or physical-paint benchmark. Fixtures included `mini.pdb` (9 atoms), `1htb.pdb` (about 491 KB), and a multi-record SDF.

| Scenario | Before | Patched source |
| --- | --- | --- |
| Inspector opacity, 18 real pointer steps from 40% to 83% | No actions or intermediate scene alpha before release; final alpha at release +152.1 ms | 18 actions and intermediate scene alpha before release; final alpha at release +4.3 ms |
| Camera popup rectangle reads, three openings | 128 / 140 / 52 | 25 / 31 / 31 |
| Camera popup computed-style reads | 72 / 81 / 27 | 18 / 27 / 27 |

The opacity check inspected actual representation alpha, including the unchanged foreground alpha of 1. Renderer selection used the existing typed bridge; the All button and opacity slider used real UI input.

A separate causal experiment changed only popup dimension measurement, reducing eight or nine layout passes to two or three. The final source also removes duplicate visibility measurements. Patched Camera input-to-two-animation-frames observations were 73 / 64 / 61 ms, without long tasks in those samples. The small sample and scheduling-based milestone do not support a precise general latency speedup claim.

Style, Camera, Screenshot and Animate popups remained within the viewport in an isolated reduced-motion context. Select-query profiling located repeated geometry reads; creating its React query controls took about 11 ms in the warm sample, while menu styling took about 0.2–0.3 ms.

Actual host context-menu Scale dragging changed `sizeFactor` from 0.15 to 0.26 through six intermediate values, retaining opacity 1 and the final scale. Animate speed changed through 0.31 / 0.39 / 0.47 / 0.54 in the actual canvas; wiggle amplitude changed through 1.5 / 1.9 / 2.3 / 2.7 in representation parameters before release. These checks produced no page errors.

The shared settings panel was also tested diagnostically: its hidden original Settings / Controls Info button was invoked programmatically, then visible controls were operated with real pointer input. FOV, fog, clipping radius and near clipping all updated actual canvas properties before release while retaining unrelated values. This bypass is explicitly not a normal desktop navigation acceptance result.

The additional docking Match test used a supported `open_docking_view` setup with `mini.pdb` and `mini.sdf`, followed by real All/Inspector interaction. Before the fix, all eight delivered opacity values left both representation alphas at 1. After the fix, background alpha followed every value down to 0.22 before release, while foreground alpha remained 1. Representation refs/types and the camera were unchanged throughout the drag. A later explicit red colour survived the same updates. Line → next active pose → Match restored the appropriate foreground/background styles and opacity. Camera position/target/up stayed unchanged apart from floating-point noise on style changes, while the bounding radius changed with the geometry; exact camera equality is claimed only for opacity gestures.

## Rendering limitation

Gauss Chromium used ANGLE / Vulkan / SwiftShader, with a 1099 × 960 drawing buffer. A real scene-opacity scrub became slow after the opaque-to-transparent transition, around 0.9–1.1 seconds per step. Counters showed one initial program creation; subsequent opacity changes did not compile or link more shaders. CPU samples were dominated by native graphics work rather than React.

The live Inspector fix performs real intermediate rendering, so it does more work than the former delayed update. Its browser test proves continuous feedback and final-value correctness, not an FPS improvement. Native GPU behavior must be evaluated separately.

Opaque Scale and animation controls were also slow under this software renderer, so the limitation is not specific to transparency.

## Native VM checkpoints

The dedicated `burette-controls-1116` VM used 4 CPUs and 8 GB RAM on Orion's Linux boot. The user's `mac` VM and the pre-existing `burette-qa` VM were left untouched.

The baseline `8f5c93f7ffde` loaded `mini.pdb`. Its native AppKit context-menu opacity slider was dragged from 100% to 24% over 0.5 seconds and held for four seconds. A screenshot taken while the mouse was still down showed both 24% and the translucent molecule; release retained the same appearance. This disproves a general claim that native menu tracking prevents live opacity updates until mouseup.

Candidate `3bcb9a338b23` opened the docking fixture through the supported agent action, then used real UI input for All and the Inspector. Its explicit Ball+Stick background changed to alpha 0.21 while the mouse remained held. A native `workspace_scene_snapshot` completed before release and confirmed foreground alpha 1 and background alpha 0.21. Style, Camera and Animate popups were also observed. The Match mode's separate no-op was identified during this run and led to stage `18401c364260`.

The small VM experienced four automatic system restarts, including during a native file-menu operation and while idle waiting for a build. The collected reports identify WindowServer and `AppleParavirtResource::free` / `IOGPUDevice::delete_resource`, with additional GPU restart reports. These are system failures; exact application causation is not established. Successful control checks do not establish a stable native frame-rate benchmark.

The combined desktop-only x86_64 test archive was built locally from `3bcb9a338b23` with the isolated identifier `com.local.BuretteV10.Dev.orionperf1116`. Deep strict code-signature verification passed. Archive SHA-256: `05530dc9771814710f762fe909f95749ea96b9c22ee9c2f6838dd2b595e05c45`. It excludes Quick Look extensions, bundled Python rendering and Metal compute kernels; those surfaces are not certified by this test build.

The native bundle's widget is separately pinned through `stage-native-widget.mjs`; it is not built from the current `plugins/burette-agent` mirror. Its pin was preserved. This audit does not claim that an installed or mounted widget was updated.

The subsequent Match-fixed archive is built from `18401c364260`, with the same isolated bundle identifier. Its viewer bytes match that source commit, and signature verification passed. Archive SHA-256: `97658d4bb4a2f0c8cf2875345e8a214525ef2f6d512127da0448a96bf77dcaf8`.

That archive passed the final native Match check. Match and Colored were visibly selected before the drag. A scene snapshot completed at 13:40:59.932 UTC, while the mouse remained held until 13:41:05.490 UTC. It contains two Ball+Stick representations with foreground alpha 1 and background alpha 0.66. The fourth restart followed this checkpoint; further GUI testing stopped.

Earlier host JavaScript frame windows had p95 values of 18–20 ms, but windows containing diagnostic capture work also had maxima of 284–326 ms. These are exploratory scheduling samples, not physical GPU FPS or a controlled before/after benchmark. The planned clean drag was cancelled after repeated system failures. Native Scale and an exhaustive action-by-action acceptance sweep remain unverified; the corresponding browser and source checks are listed separately above.

## Regression coverage

- Actual React Inspector controls: keyboard commits, a real external viewer event followed by another pointer change, and final persistence.
- Actual sender and iframe resolver: document ownership and removal before effect cleanup.
- Actual scene queue functions: 100 rapid inputs coalesce per key, distinct fields and objects survive, and Undo/Redo restore the expected state after blocked updates finish.
- Actual DOM symmetry handlers: intermediate updates and one history entry per gesture.
- Actual Mol* slider, parameter control and settings mapping: four live drags, narrow canvas payloads, no repeated layout/context updates, final-value retention, and full-path fallback for mixed changes.
- Menu geometry and real selection controls: visibility, zero-sized elements, scaled/reduced-motion placement, viewport bounds and query behavior.
- Existing scene operations, native-menu contracts, shell contracts, resize adapters, build-plugin checks, JavaScript syntax and vendor-lock checks.

The scene-recovery test initially failed under Bun while passing under Node. Its fixture replaced a VM-context property after evaluation, but Bun's internal binding still called the original function, so the test awaited `undefined` and asserted before the UI update. The wrapper now lives in the same VM evaluation and asserts that the real reload promise is observed. The missing animation-frame binding in another DOM fixture was also supplied. The complete scene-recovery test passes in both runtimes; no production workaround was introduced.

Focused tests are registered in the Vite+ contract suite. No public action payload, path contract, app identifier or release namespace changed.

## Audit inventory and remaining scope

The audit traced Inspector background opacity; representation opacity, scale, thickness and surface parameters; measurement dimensions; symmetry scale; trajectory position; animation speed and wiggle controls; shared camera settings; grid ranges; and Chemical Space controls.

Secondary candidates remain separate from the corrected primary scene controls: xyzrender's backend-rendered fields use a 120 ms trailing delay, and Chemical Space clustering restarts when its cutoff changes. These source observations are not measured native performance conclusions. Shared upstream Mol* mouse-drag listeners also warrant a separate close-while-dragging check; normal release followed by close is covered.

Raw scripts, profiles, counters, screenshots and before/after JSON are retained in the local experiment directory `primary-controls-audit-20261116`. The browser report distinguishes diagnostic bridge operations from user-reachable UI paths.

## Cleanup

The dedicated test VM was powered off and removed. Orion remains on Linux; the pre-existing `mac` and `burette-qa` VMs remain stopped and unchanged. Audit SSH/VNC ports are closed. Owned browser sessions and servers on Gauss were stopped and their ports checked. Temporary build trees, local native build cache, staged app copies and scratch helpers were removed; archives, build recipes and review evidence were retained. No release installation, pinned-widget migration or change to the user's existing desktop was performed.
