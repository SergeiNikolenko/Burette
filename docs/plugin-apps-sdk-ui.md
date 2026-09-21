# Plugin UI: Apps SDK UI migration

Status, 2026-09-13: **widget-wrapper scope only; local .6 installed for host QA**.
The user explicitly excluded internal Burette, Mol* and Ketcher UI from this
migration. Do not treat a whole-application SDK migration as a submission gate.

## Sources and scope

- Implementation: [OpenAI Apps SDK UI](https://openai.github.io/apps-sdk-ui/),
  pinned to `@openai/apps-sdk-ui@0.2.2` in the desktop workspace.
- Component contracts: [official repository](https://github.com/openai/apps-sdk-ui).
- Design reference: [Apps in ChatGPT — OpenAI Official](https://www.figma.com/community/file/1625636989296445101/apps-in-chatgpt-openai-official).
  The Community cover and description were inspected. Internal Figma component
  nodes were **not** inspected: Open in Figma requested creating a draft copy,
  which was cancelled. Do not describe this as a complete Figma parity audit.
- Local plugin source: `Burette-local-plugin-fix`. Hosted submission source is
  the separate `b55a/Burette` checkout; these changes do not update production.
- The macOS/Quick Look interface and molecular drawing engines remain separate
  surfaces. Do not replace chemically meaningful bond/atom glyphs with generic
  UI icons or inject plugin global styles into a native-only runtime.

## Inventory

| Surface | Current implementation | Migration requirement |
| --- | --- | --- |
| Native workspace display menu | Actual SDK Button, Menu, ChevronUp, ExpandLarge, CollapseLarge | Packaged browser protocol fixture verified; native Codex acceptance pending |
| Legacy compact display menu | Actual SDK Button, Menu and icons | Packaged fixture returns to chat without closing the session |
| Scene toolbar and viewport rail | `PreviewExtension/Web/viewer-shell.js`: existing HTML/SVG | Out of scope; preserve existing UI and molecular actions |
| Scene objects and context menus | `viewer.js`: scene-tree DOM factories | Out of scope; preserve identity, selection, visibility and undo |
| Molecular metadata/preview cards | Shared viewer runtime markup and custom CSS | Out of scope; only verify clearance from wrapper controls |
| Document tabs | Shared DocumentTab, shadcn menus, custom close icon | Keep host-owned browser tabs outside the widget; do not mistake SDK SegmentedControl for document tabs |
| Ketcher surrounding controls | Existing shadcn Badge/Button/Alert and tooltips | Out of scope; verify integration without redesigning the editor |
| Tokenized Browser preview | Installed preview assets | Not changed by a desktop React component migration |

There is no generic Card or document-tab component in the inspected SDK
component catalog. Official card examples compose a container, semantic tokens,
Badge and Button. Do not invent imports or claim that an HTML card must itself
be an SDK component. Application icons for Finder/Open With are real application
assets, not generic UI glyphs, and should remain recognizable.

## Completed stage

`native-workspace-placement-control.tsx` now imports maintained SDK components
and icons directly. No locally redrawn paths or button/menu skin is used for
this control. `plugin-ui.css` imports the actual SDK foundation and registers
its Tailwind source directories.

The control is loaded lazily only when `BuretteMcpWorkspace` exists. Ordinary
desktop builds keep CSS splitting, so the SDK reset is not loaded there.
Native MCP builds combine CSS; the full packaged interface still needs a
regression pass for cascade interactions with the remaining legacy controls.
The host already updates `html[data-theme]`, including the body-portalled menu.

The SDK pins Lodash 4.17.21; installation initially lowered the existing
resolution. A root override retains the previously locked 4.18.1 version.

## Validation and limits

- `vp exec node --test tests/test-native-workspace-menu.mjs tests/test-native-workspace-placement.mjs`: 8 passed.
- Focused Vite fixture production build: passed; this is not a full plugin build.
- `vp exec tsc --noEmit -p apps/desktop/tsconfig.json`: passed.
- In-app Browser, actual component and actual placement state machine with a
  simulated host: light/dark menus, keyboard selection, focus restoration,
  forward/return placement, rejected placement and unavailable mode verified.
- Fixture: `vp dev --config tests/fixtures/apps-sdk-ui/vite.config.ts`.
  Its title and body explicitly identify the simulated host; it is not a
  molecular workspace or proof of Codex mounting.
- Follow-up: full native workspace built on Gauss, then installed locally as
  `0.2.2+local.20260913.5` using the Codex CLI installer. No production deployment,
  native Codex mount or submission was performed. Restart and a fresh task are
  required for installed-host acceptance.
- The packaged protocol fixture rendered both mini.pdb and 1htb.pdb, reordered
  tabs by dragging, retained both renderer frames after switching, and released
  only the explicitly closed document. Expanded/inline transitions preserved the
  scene; inline mode omitted the bottom-dock button and resize handle.
- Light and dark layouts were inspected at 1216px and 420px widget widths. The
  small-card minimum is now 320px so the viewport rail clears the display menu.
- SDK CDN KaTeX URLs are rewritten by the packer to the already bundled matching
  font files. Missing fonts fail the build; CSP/network restrictions are unchanged.
  The regression test checks packaged CSS and the missing-font failure.
- Browser console error/warning retrieval for the compact fixture was empty,
  but the fixture's event collector recorded one blocked `script-src: eval`
  attempt in both compact and full renderers. Scenes remained usable. This is
  not a clean CSP audit or proof that submission is ready.
- The first parallel test run exited with signal 133 after passing assertions.
  After closing the temporary browsers, the final serial wrapper/asset/lifecycle/
  sizing run (`node --test --test-concurrency=1`) passed all 39 tests and exited 0.

Follow-up `.6`: traced the caught eval probe to Zod schema initialization in
the MCP bridge. `mcp-viewer-csp.mjs` sets `jitless` before SDK imports; validation
remains enabled and CSP is unchanged. Both compact and native bootstrap bundles
were rebuilt without changing engine archives. The bundled bridge test detects
Function attempts; 20 focused startup/menu/placement tests passed. Actual
protocol fixtures rendered mini.pdb and 1HTB with an empty CSP/runtime event
collection. Native light/dark checks at 1216px and 420px plus pane/inline return
kept the renderer and WebGL context alive. Browser warning/error logs were empty.
The documented installer installed `.6`; manifest, both HTML resources and
asset manifest match source hashes. Native Codex still requires restart and a
fresh task; no production update was made.

## Remaining acceptance

Verify wrapper keyboard support, theme changes, clipping and focus in the real
mounted widget, absence of inline resize/bottom-dock controls, tab retention and
host remount. Rebuild and reinstall through the documented plugin lifecycle,
then open a fresh plugin-enabled task before declaring installed acceptance.
Hosted ChatGPT and physical iPhone checks are separate from local Codex
acceptance. Do not record a local browser fixture as the submitted hosted app.
