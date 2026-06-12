---
name: user-context
description: "Load Burrete's scoped capability registry and setup status before molecular workspace workflows."
---

# Burrete User Context

This skill owns Burrete preflight. It does not store general memory.

## Preflight

Run the read-only preflight script before ordinary Burrete work:

```bash
node plugins/burette-agent/scripts/burette_agent_preflight.mjs
```

The script reports:

- plugin and repository paths;
- whether `scripts/burrete-agent.mjs` is available;
- whether `scripts/agent-preview.mjs` is available;
- configured preferred desktop app from `BURRETE_AGENT_APP`, if any;
- available transports and visual QA surfaces;
- supported, partial, and external workflow capabilities;
- current blockers.

Use this payload to decide workflow routing, not to claim live viewer state. For
live state, run `burrete-agent observe`.

## Scope

Persisted context should stay narrow:

- preferred installed Burrete app path;
- preferred mode (`browser-dev-shell`, `browser-preview`, or `desktop-app`);
- known server workflow routes;
- capability registry overrides only when explicitly configured.

Do not store arbitrary molecule facts, user reports, private files, or workflow
outputs here. Those belong in bounded artifacts or workspace reports.

## Missing Setup

If the CLI or browser preview script is missing, stop the current Burrete
path and report the blocker. Do not fall back to Computer-only control for
molecular operations because it cannot provide reliable chains, ligands, waters,
or selection state.
