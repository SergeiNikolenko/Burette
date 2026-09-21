# Codex Repo Skills

This directory contains repository-local Codex guidance for maintaining Burette.
It is separate from `plugins/burette-agent/skills`, which are packaged product
skills for molecular workflows.

Use `.codex/skills` for development-time review, release, PR, and maintenance
workflows that should not ship as part of the Burette agent plugin.

## Skills

| Skill | Use |
| --- | --- |
| `burette-code-review` | Final multi-angle review orchestrator for a branch or PR. |
| `burette-review-breaking-contracts` | Contract review for Quick Look, browser, desktop, agent, release, and iOS surfaces. |
| `burette-review-change-size` | Review whether a diff is small enough to land safely. |
| `burette-review-context-bounds` | Review bounded payload, report, widget, log, and model-visible context behavior. |
| `burette-review-testing` | Review whether the changed surface has the right focused validation. |
| `burette-review-path-contracts` | Review path, URL, file, and session-directory boundary handling. |
| `burette-release-readiness` | Release-readiness review for versioning, signing, updater, Homebrew, and installer surfaces. |
| `burette-pr-body` | Prepare or revise a GitHub PR title/body from the actual net change. |

## Boundaries

- Do not put user-facing molecular workflow skills here. Those belong under
  `plugins/burette-agent/skills` and must remain aligned with the plugin MCP
  registrations.
- Do not add environment setup that copies secrets, signing identities, local
  absolute paths, device IDs, or machine-specific app state.
- If `.codex/environments` is added later, keep it limited to lightweight
  bootstrap checks such as tool presence, `bun install`, or `vp install`.
- Do not copy external project-specific workflows directly. Adapt only the
  policy shape and replace all repository names, paths, commands, and contracts
  with Burette-specific ones.
