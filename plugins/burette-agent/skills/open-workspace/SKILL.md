---
name: open-workspace
description: "Open molecular artifacts in Burrete Browser preview or desktop app sessions and establish an observable workspace."
---

# Open Workspace

Use this workflow to open local structures, SDF collections, trajectory bundles,
or workflow result bundles in Burrete.

## Workflow

1. Run Burrete preflight through [user-context](../user-context/SKILL.md).
2. Choose mode:
   - `browser-preview` when the user asks for the Codex Browser, quick visual
     QA, screenshots, or localhost preview.
   - `desktop-app` when the user asks for the real Burrete application or wants
     results left open in the app.
3. Open through the CLI:

```bash
bun scripts/burrete-agent.mjs open --mode browser-preview <file>
bun scripts/burrete-agent.mjs open --mode desktop-app <file> --session-dir <dir>
```

4. Run `observe` after the app reports readiness.
5. If visual confirmation matters, use [visual-qa](../visual-qa/SKILL.md).

## Handoff

Report the mode, session directory or tokenized URL, active document title,
viewer readiness, and any typed errors. Do not describe a successful molecular
load until `observe.activeDocument.ready` or equivalent viewer readiness is
true.
