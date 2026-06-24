# Burrete Agent Plugin Instructions

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
  `scripts/burrete-agent.mjs` or plugin-local validation scripts instead of
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

## Validation

For plugin changes, run the narrowest applicable checks:

```bash
bun tests/test-burette-agent-plugin.mjs
bun tests/test-burette-agent.mjs
bun tests/test-burrete-agent-cli.mjs
bun tests/test-agent-preview-server.mjs
```

For the full plugin surface:

```bash
bun run test:agent
```

For visual or browser-shell changes, also open the intended Browser surface and
confirm `observe` output before reporting success.
