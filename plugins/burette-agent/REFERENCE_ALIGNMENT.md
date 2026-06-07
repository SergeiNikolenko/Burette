# Reference Plugin Alignment

This document records the architectural checks used to keep Burrete at the
same interface level as the referenced plugins.

## Data Analytics

Reference pattern:

- primary router skill;
- mandatory read-only preflight;
- scoped user context rather than broad memory;
- bounded manifest/snapshot artifacts;
- validate before visible render;
- delivery-specific widgets and reports.

Burrete implementation:

- `skills/index/SKILL.md` routes to focused molecular workflows.
- `skills/user-context/SKILL.md` and
  `scripts/burette_agent_preflight.mjs` provide read-only capability preflight.
- The preflight scope is limited to transport, app, workflow, and capability
  registry state.
- `mcp/lib/validation.mjs` validates bounded molecular artifacts before report,
  table, and trajectory widgets render.

## Product Design

Reference pattern:

- router first;
- context gate before build/design work;
- focused workflows for audit, ideation, prototype, and QA;
- do not build without the required target.

Burrete implementation:

- `skills/index/SKILL.md` routes before action.
- `skills/open-workspace/SKILL.md` establishes the concrete file/session target
  before Mol* or report work.
- `skills/visual-qa/SKILL.md` separates QA from command execution.
- Unsupported or missing targets must be reported as typed blockers instead of
  guessed from screenshots.

## Creative Production

Reference pattern:

- MCP server owns stable tool/resource registration;
- `registrations/` are separate from browser assets;
- `widget-assets/` contain browser HTML/CSS/JS only;
- durable run/artifact data is passed through bounded payloads.

Burrete implementation:

- `mcp/server.mjs` registers all stable tools/resources.
- `mcp/registrations/*/register.mjs` define tool schemas and widget metadata.
- `mcp/widget-assets/*` contains browser assets only.
- Widget tools pass `structuredContent` to the model and `widgetData` to the
  review surface.

## Browser

Reference pattern:

- use the in-app Browser for local web targets, screenshots, DOM/Playwright
  checks, and visible user review;
- keep Browser as verification, not business/domain state.

Burrete implementation:

- `skills/visual-qa/SKILL.md` assigns Browser to tokenized browser-preview
  verification.
- Molecular truth still comes from `observe_burrete_workspace` or the CLI
  `observe` command.

## Computer

Reference pattern:

- use Computer for native desktop app state, accessibility tree, screenshots,
  click/type/drag fallback;
- call `get_app_state` before interacting.

Burrete implementation:

- `skills/visual-qa/SKILL.md` assigns Computer to the real Burrete desktop app.
- Computer can confirm Tauri/Mol* controls, but chains, ligands, waters,
  residues, and selections must come from typed `observe`.

## Completion Bar

Burrete is interface-complete only when all of these exist and pass tests:

- plugin manifest and MCP config;
- router plus focused skills;
- read-only preflight script;
- CLI bridge wrappers;
- MCP server and registrations;
- widget asset split;
- molecular artifact validation;
- Browser/Computer QA guidance;
- tests that assert the architecture and executable contracts.
