---
name: burette-pr-body
description: Prepare or revise a Burette GitHub pull request title and body from the actual net change.
---

# Burette PR Body

Use this skill when asked to create or update a PR title/body.

## Inputs

Infer the PR from the current branch when possible. If no PR exists, draft the
body from the local diff against the intended base branch.

## Content Rules

- Preserve existing PR body content that the author may not be able to recover,
  especially images, links, and manually written context.
- Explain why the change exists before listing what changed.
- Describe the net change, not abandoned intermediate attempts.
- Avoid absolute local disk paths.
- Avoid confidential information, local device identifiers, signing secrets,
  tokens, private hostnames, and temporary localhost/session details unless the
  PR is specifically about that local diagnostic path.
- Mention affected surfaces explicitly: desktop app, Quick Look, browser-dev,
  tokenized preview, iPhone app, plugin/MCP, release, installer, or docs.
- Include verification that was actually run. Do not list checks that CI runs
  automatically unless they were meaningful to this change or newly added.
- If docs or release notes need follow-up, include a short section for that.

## Suggested Shape

```markdown
## Why

## What Changed

## Verification

## Notes / Follow-Up
```

Omit empty sections. Keep the PR body concise and user-facing where the change
affects install, launch, preview, update, or agent workflows.
