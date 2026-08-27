# Burette production manual review checklist

## Evidence status before this run

- [ ] Record the production deployment URL, deployment ID, Git commit, UTC deployment time, reviewer, ChatGPT web version/date, and iPhone model/iOS/ChatGPT version below.
  - Production deployment URL: `________________________________________`
  - Deployment ID: `________________________________________`
  - Git commit: `________________________________________`
  - Deployed at (UTC): `________________________________________`
  - Reviewer: `________________________________________`
  - ChatGPT web checked at (UTC): `________________________________________`
  - Physical iPhone / iOS / ChatGPT version: `________________________________________`
- [ ] Confirm the deployed Git commit contains the intended submission bundle and no later unreviewed runtime changes.
- [ ] Treat the current production deployment of that commit as **not verified** until every production preflight item below passes.
- [ ] Treat the ChatGPT connector rescan as **not verified** until the rescan and fresh-chat checks below pass.
- [ ] Treat physical-iPhone behavior as **not verified** until the physical-device checks and evidence below pass.
- [ ] Do not reuse July evidence, an old ChatGPT card, a local preview, the standalone web demo, a simulator, or source-level tests as proof for this run.

## Production URL, origin, and MCP preflight

- [ ] `GET https://burette-plugin.vercel.app/` returns `308` with `Location: https://burette-landing.vercel.app/docs/plugin`.
- [ ] `GET https://burette-plugin.vercel.app/api/health` returns `200`, `Cache-Control: no-store`, and exactly the current health identity: `status=ok`, `service=burette-public-plugin`, `version=0.1.0`.
- [ ] `GET https://burette-landing.vercel.app/docs/plugin` finishes at `200` over HTTPS.
- [ ] `GET https://burette-landing.vercel.app/support` finishes at `200` over HTTPS.
- [ ] `GET https://burette-landing.vercel.app/privacy` finishes at `200` over HTTPS.
- [ ] `GET https://burette-landing.vercel.app/terms` finishes at `200` over HTTPS.
- [ ] `GET https://burette-plugin.vercel.app/.well-known/openai-apps-challenge` returns `200` and the exact portal challenge token configured in `OPENAI_APPS_CHALLENGE`; do not copy the token into screenshots, logs, this file, or a shared conversation.
- [ ] `OPTIONS https://burette-plugin.vercel.app/mcp` returns `204` with `Access-Control-Allow-Origin: *`, methods `GET, POST, DELETE, OPTIONS`, and the declared MCP request/exposed headers.
- [ ] A stateless `tools/list` POST to `https://burette-plugin.vercel.app/mcp` returns `200` as `text/event-stream` and contains exactly these five tools:
  - [ ] `preview_molecular_file`
  - [ ] `preview_pdb_structure`
  - [ ] `render_molecular_scene`
  - [ ] `open_ketcher`
  - [ ] `control_ketcher`
- [ ] Every listed tool has a non-empty input schema, output schema, top-level `securitySchemes: [{"type":"noauth"}]`, and matching `_meta.securitySchemes`.
- [ ] The rescanned descriptors expose these exact annotations:

  | Tool | `readOnlyHint` | `openWorldHint` | `destructiveHint` | `idempotentHint` |
  | --- | ---: | ---: | ---: | ---: |
  | `preview_molecular_file` | `true` | `false` | `false` | `true` |
  | `preview_pdb_structure` | `true` | `true` | `false` | `true` |
  | `render_molecular_scene` | `true` | `true` | `false` | `true` |
  | `open_ketcher` | `false` | `false` | `false` | `false` |
  | `control_ketcher` | `false` | `false` | `true` | `false` |

- [ ] `resources/list` and `resources/read` expose `ui://burette/molecular-viewer-v21.html` and `ui://burette/ketcher-editor-v1.html` with MIME type `text/html;profile=mcp-app`.
- [ ] Both resources declare the exact app origin `https://burette-plugin.vercel.app` in `ui.domain` and `openai/widgetDomain`.
- [ ] Both resources declare only `https://burette-plugin.vercel.app` in `ui.csp.connectDomains`, `ui.csp.resourceDomains`, `openai/widgetCSP.connect_domains`, and `openai/widgetCSP.resource_domains`.
- [ ] Neither resource declares a frame domain; the widget contains no nested application iframe. Stop if the portal CSP values disagree with the rescanned resource metadata.
- [ ] `GET https://burette-plugin.vercel.app/viewer-shell/index.html` returns `200` with this effective CSP and no weaker duplicate policy:

  ```text
  default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' data: blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'none'
  ```

- [ ] The production viewer-shell and viewer-runtime asset responses return `200`, `Access-Control-Allow-Origin: *`, `Cross-Origin-Resource-Policy: cross-origin`, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.
- [ ] Browser developer tools show no CSP violation, blocked asset, mixed content, unexpected third-party origin, unhandled exception, or failed WASM/worker load during a viewer or Ketcher run.

## ChatGPT connector rescan

- [ ] Open the same rejected app record and confirm its app/submission identity before changing the connector.
- [ ] Enter exactly `https://burette-plugin.vercel.app/mcp`, complete domain verification, and rescan after the production deployment above.
- [ ] Confirm the card is named `Burette`, not `Burrete`, and shows the current subtitle and listing copy.
- [ ] Confirm the rescan shows exactly the five production descriptors, annotations, no-auth schemes, output schemas, and two resource URIs checked above.
- [ ] Start a fresh ChatGPT web conversation after the rescan; do not use a card or conversation created before it.
- [ ] Start a fresh physical-iPhone ChatGPT conversation after the same rescan.
- [ ] Record the connector rescan time (UTC): `________________________________________`.

## Five submitted review cases

- [ ] Run every case independently in a fresh conversation on ChatGPT web and again on the physical iPhone.
- [ ] For every run, record the exact assistant text, tool invoked, structured counts, widget load result, interaction result, conversation URL or evidence ID, and any deviation.

| Case | Exact input | Expected result | Web | Physical iPhone |
| --- | --- | --- | --- | --- |
| Attached PDB | `https://raw.githubusercontent.com/SergeiNikolenko/Burette/e4a701b953a08f4a12ae03d8d1184502fd43d5f5/samples/mini.pdb` with prompt “Preview this PDB file in the full molecular viewer and summarize its chains, residues, and atoms.” | `preview_molecular_file`; `1` chain, `2` residues, `9` atoms; nonblank interactive `mini.pdb` viewer | [ ] | [ ] |
| Attached mmCIF | `https://raw.githubusercontent.com/SergeiNikolenko/Burette/e4a701b953a08f4a12ae03d8d1184502fd43d5f5/samples/mini.cif` with prompt “Open this mmCIF structure and show its chain and element summary.” | `preview_molecular_file`; chain `A`, `1` residue, `4` atoms; elements `C 2`, `N 1`, `O 1`; nonblank viewer | [ ] | [ ] |
| Attached SDF | `https://raw.githubusercontent.com/SergeiNikolenko/Burette/e4a701b953a08f4a12ae03d8d1184502fd43d5f5/samples/mini.sdf` with prompt “Preview this SDF and summarize the molecules and elements it contains.” | `preview_molecular_file`; `2` molecules, `9` atoms, `8` bonds; elements `C 6`, `H 2`, `O 1`; nonblank viewer | [ ] | [ ] |
| Public PDB | Prompt “Open PDB 1CRN in the full molecular viewer and summarize its composition.” | `preview_pdb_structure`; RCSB `1CRN`; `1` chain, `46` residues, `327` atoms; nonblank interactive viewer | [ ] | [ ] |
| Ketcher seed | Prompt “Open a Ketcher editor and seed it with ethanol using the SMILES CCO.” | `open_ketcher`; visible valid ethanol sketch; `3` atoms; structure revision `1`; no file write or persistence claim | [ ] | [ ] |

- [ ] No case relies on a count inferred by the assistant when that count is absent from structured output.
- [ ] No attachment case uses mutable `main` URLs, a local path, a private URL, or a fixture other than the immutable URLs above.
- [ ] The widget remains nonblank and interactive after the assistant text has finished streaming and after one collapse/expand cycle.

## ChatGPT web: Ketcher end-to-end flow

- [ ] Use one fresh post-rescan ChatGPT web conversation for the entire flow and record the active card/result after every step.
- [ ] Ask: “Open a Ketcher editor and seed it with ethanol using the SMILES CCO.” Confirm a visible ethanol sketch, `3` atoms, structure revision `1`, and no user-visible continuation token.
- [ ] Edit the sketch directly in the visible Ketcher canvas from ethanol (`CCO`) to ethylamine (`CCN`) without asking the agent to replace it.
- [ ] Ask: “Read the structure currently visible in Ketcher and return its SMILES.” Confirm the agent returns the manually edited `CCN`, not the original `CCO`, and the visible sketch is not cleared or reverted. **Stop if direct editor changes and agent state diverge.**
- [ ] Ask: “Replace the current Ketcher structure with acetic acid using SMILES CC(=O)O.” Confirm `control_ketcher` uses the current surface/revision, the visible sketch changes to acetic acid, and structure revision advances exactly once.
- [ ] Ask: “Highlight atom indexes 0 and 2 in the current Ketcher structure.” Confirm both atoms are visibly highlighted, the structure remains acetic acid, structure revision does not change, and interaction revision advances.
- [ ] Ask: “Export the current Ketcher structure as inline SMILES.” Confirm the result contains `CC(=O)O` or a chemically equivalent canonical SMILES explicitly identified as equivalent; the editor remains populated and is not reset to an earlier seed.
- [ ] Collapse and expand the result, then reload the ChatGPT conversation and remount the latest Ketcher result. Confirm the acetic-acid structure, highlight state, surface identity, and current revisions rehydrate without a blank editor or `STALE_TARGET`.
- [ ] Ask: “Clear the current Ketcher sketch.” Confirm the editor becomes empty, structure revision advances exactly once, and the result reports an empty structure without claiming that a source attachment or local file was deleted.
- [ ] Ask for `get_structure` after clear. Confirm the bounded export is empty, the widget stays mounted, and no previous structure silently reappears.
- [ ] Confirm ordinary assistant prose never exposes `surfaceId`, `continuationToken`, token fragments, encryption details, raw `_meta`, stack traces, internal hostnames, or local paths.

### Operator-only negative state checks

- [ ] Run these checks only through the MCP/Developer inspector; do not paste raw tokens into prompts, screenshots, videos, shared conversations, or the submission portal.
- [ ] Modify one character in a valid continuation token and call a non-destructive `get_structure`. Confirm `isError=true`, structured error code `STALE_TARGET`, a bounded generic “invalid state token” message, no stack trace/secret/token echo, and no mutation of the valid surface.
- [ ] Keep an unused continuation token for more than `15` minutes, then call non-destructive `get_structure`. Confirm `isError=true`, structured error code `STALE_TARGET`, a bounded generic “state token has expired” message, no token echo, and no mutation.
- [ ] Pair a valid token from one Ketcher surface with another surface ID. Confirm `STALE_TARGET`, no state disclosure from either surface, and no user-facing internal diagnostic.
- [ ] In a normal ChatGPT recovery turn after an expired state, confirm the assistant asks to reopen Ketcher in plain language and does not reveal token internals.

## ChatGPT web: molecular scene actions

- [ ] In a fresh `1CRN` conversation, ask to select chain `A`, residues `10–20`, and focus the selection. Confirm `render_molecular_scene` is used, the selection and camera focus are visible, and the widget reports both requested actions as applied before the assistant claims success.
- [ ] Ask to clear the selection and reset the camera. Confirm both effects are visible, the molecule remains nonblank, and the model-visible active selection is cleared.
- [ ] Ask to hide the polymer. Confirm the polymer disappears while the canvas and controls remain responsive; do not accept an assistant-only acknowledgement.
- [ ] Ask to show the polymer again. Confirm the structure returns without reopening an unrelated or stale card.
- [ ] Repeat one scene action against the authorized `mini.pdb` attachment. Confirm the same attachment is supplied again, the source file is not changed, and the action is applied in the new result.
- [ ] Request a selector that matches nothing. Confirm the widget reports a bounded non-applied/failed action and the assistant does not claim that a residue was selected.
- [ ] Lasso or select a visible residue in the viewer, then ask what is selected. Confirm the answer comes from bounded `burette.activeSelection` context and matches the visible chain/residue, without exposing raw structure text.

## Physical iPhone evidence

- [ ] Use a physical iPhone, not Simulator, responsive desktop emulation, an Android emulator, or an older recording.
- [ ] Record the iPhone model, iOS version, ChatGPT version, orientation, appearance, connection type, and UTC time in the evidence log.
- [ ] Run all five submitted cases in fresh post-rescan conversations and check their exact counts in the table above.
- [ ] In portrait, confirm the molecular widget is nonblank, fits the ChatGPT card width, has no clipped canvas/status text, no horizontal page scroll, no black background regression, and no overlap with ChatGPT composer or card controls.
- [ ] Rotate and zoom the molecule with touch; confirm gestures stay inside the widget and do not trap or unexpectedly scroll the conversation.
- [ ] Expand the visible toolbar grip and confirm the promised viewer controls are reachable, legible, and tappable.
- [ ] Confirm sequence, selection, representation, and measurement controls are available on the physical iPhone if they remain claimed in listing copy. **Stop or correct the listing if any claimed control is intentionally absent on mobile.**
- [ ] Select a residue and confirm visible selection plus bounded conversational context; clear it and confirm both the highlight and context clear.
- [ ] Switch at least one representation and create/remove one measurement without layout breakage.
- [ ] Verify portrait and landscape in both light and dark appearance, including one collapse/expand and one app background/foreground remount.
- [ ] Open the Ketcher seed case and confirm the editor loads, the initial sketch is centered, basic edit controls are tappable, the keyboard does not cover the active canvas/control, and collapse/expand does not blank the editor.
- [ ] Record a continuous physical-iPhone screen capture that shows the ChatGPT app frame, fresh Burette invocation, exact count response, nonblank viewer, toolbar expansion, touch rotation/zoom, selection, representation or measurement control, and successful remount.

## Required submission evidence

- [ ] Save a web screenshot from the rescanned production connector showing the `Burette` name, exact `1CRN` counts, nonblank molecule, and expanded toolbar.
- [ ] Save a web screenshot showing the attached SDF exact counts and nonblank interactive result.
- [ ] Save before/after web screenshots for the Ketcher direct-edit/read/replace/export/clear flow, with raw tokens and internal metadata excluded.
- [ ] Save physical-iPhone portrait and landscape screenshots showing the real ChatGPT frame, exact result, nonblank molecule, and reachable controls.
- [ ] Save a physical-iPhone Ketcher screenshot after a visible edit and remount.
- [ ] Record a short ChatGPT web video using the production connector only; do not show localhost, a direct viewer-shell URL, the standalone web demo, or the local macOS app as proof.
- [ ] Record the continuous physical-iPhone video required above; do not substitute generated footage, responsive emulation, or an older device recording.
- [ ] Create a fresh reviewer-accessible shared ChatGPT conversation from the rescanned production connector containing at least one exact-count viewer case, one verified scene action, and the successful Ketcher continuation flow.
- [ ] Open the shared link in a signed-out/private browser and confirm the conversation is accessible, the evidence is understandable, and no attachment authorization, private data, token, local path, or internal metadata is exposed.
- [ ] Record the final evidence paths/URLs below.
  - Web viewer screenshot: `________________________________________`
  - Web SDF screenshot: `________________________________________`
  - Web Ketcher evidence: `________________________________________`
  - iPhone portrait screenshot: `________________________________________`
  - iPhone landscape screenshot: `________________________________________`
  - iPhone Ketcher screenshot: `________________________________________`
  - ChatGPT web video: `________________________________________`
  - Physical-iPhone video: `________________________________________`
  - Reviewer-accessible conversation: `________________________________________`

## Stop / go decision

- [ ] **STOP** if the current Git commit is not the exact production deployment under review.
- [ ] **STOP** if health, challenge, root redirect, MCP status, no-auth schemes, tool list, annotations, output schemas, resource URIs, production origin, or CSP differs from this checklist.
- [ ] **STOP** if the production connector has not been rescanned after this deployment, the card still says `Burrete`, or any evidence comes from a pre-rescan conversation.
- [ ] **STOP** if any submitted case returns different counts, invokes the wrong tool, produces a blank/noninteractive widget, or fails on either ChatGPT web or the physical iPhone.
- [ ] **STOP** if any scene action is claimed before the widget reports it applied, a no-match selector is reported as selected, or model context disagrees with the visible selection.
- [ ] **STOP** if direct Ketcher edits are not returned by the agent, a valid follow-up clears/reverts the editor, revision checks fail in the ordinary flow, remount loses state, export differs chemically from the visible sketch, or clear affects anything beyond the transient surface.
- [ ] **STOP** if an invalid/expired/tampered state exposes a token, secret, crypto detail, stack trace, internal hostname, local path, or another surface's state.
- [ ] **STOP** if physical-iPhone verification is missing, simulated, stale, blank, clipped, gesture-broken, or lacks any mobile control still promised by the listing.
- [ ] **STOP** if required screenshots, both real ChatGPT videos, or the signed-out reviewer-accessible conversation link are missing or stale.
- [ ] **GO** only when every non-operator checklist item passes on the exact production deployment and rescanned connector, operator-only negative checks pass without disclosure, the physical-iPhone evidence is current, and all evidence locations are recorded above.
- [ ] Final decision: `STOP / GO`
- [ ] Decision owner: `________________________________________`
- [ ] Decision time (UTC): `________________________________________`
- [ ] Remaining deviations or follow-up: `________________________________________`
