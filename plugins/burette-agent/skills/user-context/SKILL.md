---
name: user-context
description: "Use when loading Burette's scoped capability registry and setup status before a molecular workspace workflow."
---

# Burette User Context

This skill owns Burette preflight. It does not store general memory.

## Preflight

Run the read-only preflight script before ordinary Burette work:

```bash
node plugins/burette-agent/scripts/burette_agent_preflight.mjs
```

The script reports:

- plugin and repository paths;
- whether `scripts/burette-agent.mjs` is available;
- whether `scripts/agent-preview.mjs` is available;
- configured preferred desktop app from `BURETTE_AGENT_APP`, if any;
- available transports and visual QA surfaces;
- supported, partial, and external workflow capabilities;
- current blockers.

Use this payload to decide workflow routing, not to claim live viewer state. For
live state, run `burette-agent observe`.

## Scope

Persisted context should stay narrow:

- preferred installed Burette app path;
- preferred mode (`auto`, `browser-agent-shell`, `browser-preview`, or `desktop-app`);
- known server workflow routes;
- capability registry overrides only when explicitly configured.

Do not store arbitrary molecule facts, user reports, private files, or workflow
outputs here. Those belong in bounded artifacts or workspace reports.

## Missing Setup

If the CLI or browser preview script is missing, stop the current Burette
path and report the blocker. Do not fall back to Computer-only control for
molecular operations because it cannot provide reliable chains, ligands, waters,
or selection state.
