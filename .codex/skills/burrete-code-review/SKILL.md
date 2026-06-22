---
name: burrete-code-review
description: Run a final multi-angle code review on a Burrete branch or pull request.
---

# Burrete Code Review

Use this skill when asked to review a Burrete branch, PR, or large local change.

## Review Model

Run independent review passes for each focused review skill in this directory:

- `burrete-review-breaking-contracts`
- `burrete-review-change-size`
- `burrete-review-context-bounds`
- `burrete-review-testing`
- `burrete-review-path-contracts`
- `burrete-release-readiness` when the diff touches release, installer,
  versioning, signing, update, package manager, or packaging files

Subagents may be used: one subagent per focused review skill is preferred for
large diffs. Pass the full skill path to each subagent and ask it to return only
concrete findings.

## Required Output

Return findings first, ordered by severity. Every finding must include:

- severity
- file path
- line number or tight line range
- issue
- why it matters for Burrete
- suggested fix or verification

If there are no findings, say that clearly and list any residual risk or
validation that was not run.

## Rules

- Do not leave GitHub comments unless the user explicitly asks.
- Do not add labels, merge, close, or reopen PRs unless explicitly asked.
- Do not rely on screenshots when typed CLI, test, or runtime state exists.
- Do not claim a surface is safe unless the relevant Burrete check was inspected
  or run.
- Treat Quick Look, browser-dev, tokenized browser preview, desktop app, and
  iPhone app as separate surfaces.
