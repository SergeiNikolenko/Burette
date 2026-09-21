---
name: burette-review-context-bounds
description: Review bounded payloads, model-visible context, reports, widgets, logs, and session artifacts.
---

# Context And Payload Bounds Review

Use this skill when a change touches agent context, MCP resources, browser
sessions, reports, widget snapshots, logs, or generated diagnostics.

## Rules

- Anything injected into model-visible context must have a documented upper
  bound.
- Do not stream arbitrary full files, recursive directory listings, app bundles,
  large molecular files, or unbounded logs into agent-visible payloads.
- Prefer path-based references plus summaries for large molecular artifacts.
- Widget snapshots must remain bounded and validate before rendering.
- Reports should include only reviewed tables, charts, and summaries at the grain
  needed for the task.
- Logs and diagnostics must redact secrets, tokens, local credentials, signing
  material, device identifiers when not required, and private absolute paths when
  shown outside local troubleshooting.
- Preserve existing session history and runtime state unless the task is
  explicitly a reset, migration, or cache-clear operation.

## Burette-Specific Surfaces

- `scripts/burette-agent.mjs`
- `scripts/agent-preview.mjs`
- `apps/desktop/vite/browser-dev/agent-session.ts`
- `apps/desktop/src/hooks/use-agent-session.ts`
- `plugins/burette-agent/mcp/registrations/*`
- `plugins/burette-agent/mcp/widget-assets/*`
- `plugins/burette-agent/skills/*`
- molecular report, table, workspace, and trajectory artifacts

## Output

Flag unbounded or underspecified payloads as high severity. Include the
producer, consumer, and proposed bound.
