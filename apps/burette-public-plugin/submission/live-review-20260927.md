# Live review: production repair and desktop acceptance

Surface: ChatGPT in the Codex in-app browser, desktop viewport. Connector
`asdk_app_6a93653b5af48191b38db95f43ece07d`, production endpoint
`https://burette-plugin.vercel.app/mcp`. This is not native Codex widget or mobile
acceptance. All runs were sequential, one response in progress at a time.

The user's 1STP screenshot showed an empty viewer after “Worked for 1m 2s”.
Earlier preflight/server tests did not establish that this exact workflow worked.
The connector's display name was changed from **Burette Production QA** to
**Burette** through its settings UI. This is not a marketplace publication.

## Baseline failures before the repair

| Case | Result | Evidence / remaining issue |
| --- | --- | --- |
| P1 | PARTIAL | Correct source counts: A, 121 protein residues, BTN A300, 84 waters, 1,001 atoms. Nonblank scene. Two visible result cards; rendered assembly contains symmetry copies, so source counts must not be described as the displayed assembly count. Rotation/reset not accepted yet. |
| P2 | FAIL | Exact prompt produced an empty first card and a loaded second card with BTN A300 preview. Both received molecular payloads. The answer said “Done”; reliable displayed/applied acknowledgement has not been established. Two cards are recorded, not asserted to be two independently traced model calls. |
| P3 | NOT RUN | Synthetic SDF upload and deployment approval requested; no attachment run is being claimed. |
| P4 | PASS for tested desktop flow | Visible ortho-substituted salicylic acid; Save Structure preview contained 10 atoms / 10 bonds. |
| P5 | PASS for tested desktop flow | Final visible aspirin, returned SMILES `CC(=O)Oc1ccccc1C(=O)O`; exported MOL has 13 atoms / 13 bonds. Switching the final card to Mol* and back preserved aspirin. |
| N1 | FAIL twice | With no source in the new conversation, the assistant chose 1STP/BTN A300 and claimed completion instead of asking. Reproduced after a full page reload; the second run also had a blank widget. Cached context is a hypothesis, not a proven origin. |
| N2 | PASS | Explained that docking/scoring is unavailable; no invented affinity or silent substitute tool run. |
| N3 | PASS | Explained lack of arbitrary local-file and overwrite access; did not claim a disk edit. |

ChatGPT's displayed “Worked for” values were P1 7s, P2 15s, P4 10s, P5 13s,
N1 14s and 10s. These are host-reported response durations, **not** measured
time-to-visible-scene or a performance fix. They do not explain away the user's
62-second run.

Conversation URLs and screenshots are under
`build/reports/submission-cases-20260927/` in the review worktree. In particular:
`live-case-urls.json`, `p2-two-widgets.png`, `p2-widget-payloads.json`,
`n1-cold.png`, `p4-sketch.png`, `p4-export.png`, `p5-final.png`,
`p5-molstar.png`, `p5-return-ketcher.png`, `p5-export.mol`, `n2.png`, `n3.png`.

## Fixes subsequently deployed with user authorization

- Merge partial `openai:set_globals` updates. Metadata-only arrivals must load
  the scene; output-only arrivals must not erase a successfully loaded scene.
- Reset open deduplication on effect cleanup, cancel stale asynchronous opens,
  and retain the last received payload for MCP-only hosts on effect restart.
- Skip incomplete initialization deltas, but honor explicit failures rather
  than resurrecting a stale success scene. Recognize nested `meta` envelopes.
- Replace the misleading hosted “Open file” welcome screen with loading text
  and a bounded “Structure has not loaded / actions are not confirmed” state.
- Keep hosted PDB views on the supplied coordinate model, without Mol*'s
  automatic assembly expansion. In the initial regression scene, the selector
  matched four symmetry copies of BTN A300 instead of the single supplied
  ligand. Native/Quick Look default assembly behavior is left unchanged and
  covered by a focused executable load-path regression.
- Tell the model to call `render_molecular_scene` directly for a supplied
  source/selector, require source authorization in the current conversation,
  and not equate server preparation with applied viewer actions.

The first four lifecycle regressions failed before the code fix. Seven executable
lifecycle checks now pass, along with the existing hosted parser and scene-action
checks. Both desktop and public-plugin TypeScript checks passed. The remote
production build and public-plugin suite passed (49 tests, 317 assertions).
Build setup issues (missing copied dependencies and macOS AppleDouble files in
the temporary transfer) were corrected without changing acceptance tests.

Continuation review added a failing regression for an MCP `isError: true`
notification carrying old structure metadata. Error handling now takes priority
over parsing that metadata, so a previous scene cannot masquerade as success.
This final guard has targeted regression/typecheck coverage; the earlier full
remote build predates this small guard and is not represented as its rebuild.

The built candidate was also opened in a local browser harness: delayed
metadata followed by an output-only update now opens and retains the scene;
missing metadata produces an explicit unconfirmed/error state, not a file
picker. This harness deliberately has no real Apps host and is **not** a
replacement for post-deployment ChatGPT acceptance.
After the coordinate-model correction, its actual viewer report confirmed
BTN A300 selection of **16 atoms in one residue**, a successful command response for focus on that
same selector (later found insufficient: see the camera defects below), and successful hiding of the water component. The protein
remained visible. Evidence: `candidate-1stp-fixed.png` and
`candidate-scene-report.json`; this is still local harness evidence only.

## Authorized production retests (2026-09-28 Moscow)

The user authorized deployment and uploading the synthetic SDF. No further
permission is pending for those actions. Marketplace submission was not made.
The connector and connected-account nickname both now read **Burette**; the
connector description is “Inspect molecular structures and edit chemical sketches.”

Additional real failures uncovered and fixed during retesting:

- Multi-record SDF initially appeared as overlaid models with generic names.
  Hosted collections now use the existing RDKit Cards/Table renderer, with
  CSP-safe JSON bootstrapping and absolute asset/WASM paths. All three names
  and structures were checked through an actual uploaded attachment.
- A focus operation could report success while the actual Mol* camera had
  NaN position/radius. Omit undefined camera options instead of overriding
  Mol* defaults. An executable real-Mol* regression failed before this fix.
- A finite camera still did not establish focus: initial scene framing later
  overwrote it. Authored hosted actions now run after initial presets/framing,
  invalidating scheduled overview resets. The final live camera target equals
  the selected BTN bounding-sphere center, with radius 10.856124717864649.
- “Keep protein visible” created an extra cartoon. Showing an already-visible
  polymer is now idempotent, with an executable regression.
- File Name/SMILES properties are retained, not deleted; table labels distinguish
  colliding source properties with “(file)”.
- The docking negative retest honestly refused scoring but unnecessarily opened
  a PDB preview. Tool routing instructions now explicitly prohibit this silent
  substitute, and prohibit repeating preview calls just to obtain counts.

### Desktop evidence matrix (all eight cases exercised)

| Case | Desktop ChatGPT result | Evidence / limitation |
| --- | --- | --- |
| P1 | Core scene/counts and camera controls verified | 121 protein residues + BTN + 84 waters; Lay flat, Reset zoom, Reset axes exercised. Latest routing retest shows one card (host 4s), recorded in `p1-latest.png`; the earlier two-card result is retained. Coordinate drag automation hit fractional-iframe input limitation and is not claimed. |
| P2 | PASS visual/state checks; single-card routing passed two final repeats | One visible card in each final repeat; 16 atoms/one BTN A300; camera target matches ligand center; water has no visible representation; protein visible. `p2-focused.png`, `p2-focused-proof.json`. Host displayed 4s in the first focused pass and 6s in both final repeats; these are not time-to-render benchmarks. |
| P3 | PASS core attachment flow | Three distinct named structures; Cards→Table→Cards; 34 atoms/34 bonds, no explicit H, no activity ranking. `p3-cards-after-deploy.png`, `p3-table-after-deploy.png`. Table/filter/sort labels distinguish source properties; cards/table evidence `p3-latest-*.png` (host 10s), final sort DOM `p3-sort-fixed-dom.txt`. |
| P4 | PASS | New salicylic acid sketch, ortho OH/COOH, editor export 10 atoms/10 bonds. `p4-final.png`, `p4-final-export.mol`. Host 5s. |
| P5 | PASS | Independent open→replace→read; aspirin visible, correct SMILES, export 13 atoms/13 bonds; Mol*→Ketcher retained structure. `p5-final.png`, `p5-final-export.mol`, `p5-final-return.png`. |
| N1 | PASS | New conversation after 1STP asks for source instead of borrowing it. No tool/widget. `n1-final-dom.txt`. |
| N2 | PASS after routing repair | Fresh run refuses docking/scoring without opening a viewer. `n2-fixed-dom.txt`, `n2-fixed.png`. Earlier unnecessary-preview failure retained separately. |
| N3 | PASS | No local-file read/write claim; explains hosted capability boundary. `n3-final-dom.txt`. |

Framing-fix deployment:
`dpl_Bp2mCcyWaeK6z4SbenFSzd7waU3N`, canonical alias explicitly promoted.
Earlier finite-camera deployment `dpl_FxyAkQTAJt9Zog6dgjtPf5nGffWF` is **not**
final focus acceptance: it still had the framing race.
Build/typecheck, 49 tests (317 assertions), lifecycle/collection/scene and actual
Mol* focus regressions passed remotely before promotion. Local regressions
are separate evidence from the actual ChatGPT checks.

Fresh conversation URLs: `post-deploy-case-urls.json` in the report directory.
All screenshots, DOM, baseline failures, exported structures, and deployment
logs are retained. User-created files and installed native apps were not removed.

## Remaining acceptance boundaries

Latest production: `dpl_JCDLD9G3vZycMGBNKqUNrm7Vyx2V`, canonical alias explicitly promoted after successful build/typecheck/regressions. It also distinguishes original-file properties in the sort dropdown.

The repeated P2 run on the preceding deployment had a correctly focused scene
and exactly one polymer representation, but produced two result cards (host
13s). This was a real routing inconsistency, not an all-green single-call
result; it remains in the failure history rather than being discarded. Added an explicit no-repeat/no-poll instruction in both tool description
and returned text. Two fresh independent retests now each produced one loaded,
focused card, both with host-reported 6s. Evidence: `p2-routing-fixed.png`,
`p2-routing-repeat.png` and corresponding DOM files. Both answers explicitly
separate preparation from unacknowledged application instead of claiming a
false success. Actual visual/geometry acceptance was checked independently. A successful 4s run alone does
not establish guaranteed latency or eliminate stochastic extra tool calls.
The eight desktop scenarios were exercised, but this is not a blanket product
acceptance. Native Codex widget and mobile are not accepted by these desktop browser runs.
Native computer control was unavailable; do not bypass that or call browser
screenshots native evidence. P1 mouse drag remains untested by automation.
Do not infer guaranteed latency from ChatGPT's displayed “Worked for” values.
No moderation submission or blanket publication-ready claim is made.

## Completion audit continuation: remaining gesture evidence

The preceding turn made verified progress (source repairs, promoted builds,
independent production retests and saved exports), not a no-progress status loop.

P1 was reopened at its saved ChatGPT conversation. Its official “Open app in
tab” and “Enter full screen” views both render the scene. At the normal desktop
viewport, ChatGPT gives the iframe fractional offsets. A temporary 700×800
desktop viewport put the fullscreen iframe at x=0/y=52 with integer dimensions;
this is a responsive desktop test, **not** physical mobile acceptance.

The browser drag API then returned without an error, but the camera did not
change. A temporary, read-only-in-effect event recorder on the actual viewer
window observed zero pointerdown/mousedown/mousemove/mouseup events during
the drag. It was removed immediately afterwards. DOM hit-testing confirmed
the requested location was over the canvas, with pointer-events enabled. Thus
this attempt does not prove either a successful gesture or a Burette input bug:
the automation did not deliver events to the viewer. No synthetic scene
rotation was substituted for the gesture.

Only the in-app browser is exposed in the enabled browser inventory. The native
control permission previously denied was not retried or bypassed. The viewport
override was reset, fullscreen exited, and the camera reset through its actual
UI control. `p1-expanded-review.png` and the corresponding DOM preserve the
current review surface; it remains open.

Requirement audit:

- P1 composition, visible structure, orientation/reset controls: proven.
- P1 real pointer rotation/zoom: still unverified; browser input delivery is the
  concrete remaining blocker, not a request for another deployment permission.
- P2 selection/focus/visibility: proven by scene geometry and screenshots; two
  final independent runs have one card and honest acknowledgement boundaries.
- P3 all three attached records and Cards/Table: proven; final source-property
  labels additionally checked after deployment.
- P4/P5 sketch/export agreement: retained MOL exports confirm 10/10 and 13/13.
- N1/N2/N3: retained actual responses ask for missing source, refuse unsupported
  docking without opening a substitute viewer, and deny arbitrary local writes.
- Branding, deployed revision, evidence preservation, concurrency <=5: proven;
  this repair used one browser conversation in progress at a time.
- No marketplace submission or untested native/mobile acceptance is claimed.

The goal is blocked, not complete: P1's required gesture check is not yet proven.
The same browser input-delivery limitation persisted across three consecutive
goal turns. The last turn added diagnostic evidence; the current turn
revalidated the saved report and the still-open ChatGPT scene, with no new
manual confirmation or changed input capability. No additional source edit or
server test can substitute for this missing user-interaction evidence.
Resolution requires working browser pointer delivery or a manual rotate/zoom/
reset check on the already-open 1STP widget. No further deployment approval
is being requested.

## Browser background / bottom gap repair (2026-09-28 01:18 Moscow)

User screenshot showed graphite canvas against black ChatGPT, plus an empty
bottom strip. Actual expanded-card measurement before repair: root/viewer
534.398px inside a 668px host (80%). Replaced the 80vh/760px wrapper limit with
full host height and added hosted-only CSS overrides for cached old cards.
Hosted Auto background now resolves to black in dark and white in light;
native Auto retains graphite. Explicit background choices remain supported.

Deployed `dpl_EkcDR66ezxDfvgAHrRt8LzMSMhQn` after build/typecheck and regressions.
The old Ketcher minimum-height string assertion was updated to assert actual
full-host-height contract for both editors; no failing check was skipped.

Reopened the exact original ChatGPT conversation after promotion: root and
viewer both measure 668px, equal to the host viewport. Screenshot confirms
black background continuous with ChatGPT and no separate lower strip. Expanded
and fullscreen checked. Evidence: `background-before.png`,
`background-height-fixed.png`, `background-height-fixed-dom.txt`,
`background-fullscreen-fixed.png`. Light/native color branches have regression
coverage, not a claim of fresh native/mobile visual acceptance.
