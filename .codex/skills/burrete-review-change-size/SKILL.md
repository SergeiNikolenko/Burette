---
name: burrete-review-change-size
description: Review whether a Burrete change is sized and staged safely.
---

# Change Size Review

Use this skill when reviewing a branch, PR, or refactor.

## Guidance

- Non-mechanical changes should usually stay under roughly 500 changed lines.
- If a diff approaches 800 changed lines, it should be split unless it is
  generated, vendored, or mechanically reviewed.
- A larger diff can be acceptable only when the pieces cannot be landed
  independently without breaking a contract.

## Review Steps

- Separate generated/vendor/lockfile churn from human-authored logic.
- Identify the smallest coherent stage that preserves behavior.
- Check whether central files grew unnecessarily, especially:
  - `apps/desktop/src/App.tsx`
  - `apps/desktop/vite.config.ts`
  - `PreviewExtension/Web/viewer.js`
  - `PreviewExtension/Web/viewer-shell.js`
- Prefer focused modules near the owning surface over broad shared helpers.
- Flag unrelated cleanup, formatting churn, or opportunistic refactors.

## Output

If the change is too large, propose a concrete split order with validation for
each stage. If the size is acceptable, say why.
