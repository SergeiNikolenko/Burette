# Burette Agent Plugin Instructions

## Scope

These rules apply to `plugins/burette-agent/**`: plugin manifests, skills, MCP
registrations, validation helpers, and plugin-local scripts.

## Required Context

- Read `plugins/burette-agent/README.md` for the architecture split.
- Read the focused `skills/*/SKILL.md` file before changing a workflow.
- Read `plugins/burette-agent/REFERENCE_ALIGNMENT.md` before changing plugin
  boundaries or MCP registrations.
- For app/session behavior, read `docs/agent-platform.md`.

## Contract Rules

- The repository CLI remains the execution contract. MCP tools should wrap
  `scripts/burette-agent.mjs` or plugin-local validation scripts instead of
  reimplementing app control.
- Skills decide workflow routing and user-facing handoff. MCP registrations
  expose stable tools.
- Do not edit generated or installed plugin copies under `build/`, `target/`,
  plugin cache directories, or app bundles. Change source files and rebuild with
  repository scripts.
- Do not bypass molecular artifact validation before surfacing reports,
  molecule tables, trajectory reviews, or workspace payloads.
- Browser and Computer are QA surfaces. They verify visual state; they are not
  substitutes for typed `observe`, `act`, or validation output.
- No arbitrary JavaScript execution, arbitrary shell execution, destructive
  overwrite, or remote job submission belongs in this plugin surface.

## Visualization-only shared interface

- The plugin uses the main Burette UI source, built with
  `VITE_BURETTE_AGENT_SHELL=1` by `scripts/build-agent-shell-plugin.mjs`.
  Do not fork or hand-edit a second copy of the interface. Main viewer and
  Ketcher improvements reach the plugin through that build and installation.
- Keep plugin UI focused on visualization, selection, inspection, chemical
  editing, import/export, and tab navigation. Do not expose calculation engines,
  Compute menus, Jobs panels, engine installers, or calculation settings.
- Preserve the `visualizationOnly` preview contract when updating shared Mol*
  and grid assets. Desktop and Quick Look capabilities remain separate.
- The plugin hides the project sidebar. The inline native widget hides the bottom
  dock and its toggle/resize handle; the side pane retains it. The right dock remains available
  for visualization and text. Exclude Chemical Space, Jobs and folding/compute
  tabs from both restored tabs and add-tab menus. Ketcher uses right Text.
- Use `manage_burette_tabs` to list and switch workspace tabs by returned IDs.
  Keep live selection context tied to the active document and clear stale
  selection on tab changes or deselection.
- Rebuild from the same source revision and verify plugin-specific UI checks
  after shared interface changes. An updated desktop build alone is not an
  updated plugin; publish/install the rebuilt plugin through its normal lifecycle.
- Toolbar icons, labels, hints and appearance belong to the main application's
  `PreviewExtension/Web` sources selected by `--app-root`. Do not inject a
  plugin-only toolbar decorator. Keep adapter differences limited to transport,
  host placement and host theme integration.

## Validation

For plugin changes, run the narrowest applicable checks:

```bash
bun tests/test-burette-agent-plugin.mjs
bun tests/test-burette-agent.mjs
bun tests/test-burette-agent-cli.mjs
bun tests/test-agent-preview-server.mjs
```

For the full plugin surface:

```bash
bun run test:agent
```

For visual or browser-shell changes, also open the intended Browser surface and
confirm `observe` output before reporting success.
