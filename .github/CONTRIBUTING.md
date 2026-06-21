# Contributing

Burrete accepts focused, reviewed changes. Agent-assisted work is welcome when
the contributor keeps the change scoped, verifies the result, and leaves enough
evidence for a maintainer to review the diff quickly.

## Contribution Quality

- Keep changes small and tied to one behavior, tool, or documentation boundary.
- Start with an issue, discussion, or maintainer agreement for behavior changes,
  broad refactors, public command changes, release flow changes, or new runtime
  surfaces.
- Submit pull requests only when they are ready for review, not as unfinished
  scratch work.
- In the PR description, make the change reviewable with a short What, Why, and
  How summary.
- Add or update tests and documentation when changing behavior, public commands,
  agent workflows, or runtime contracts.
- Do not include generated bundles, app builds, cache directories, or local
  smoke output unless a maintainer explicitly asks for that artifact.
- For AI-generated changes, the author is responsible for manual review and for
  reporting exactly which commands or runtime checks were run.
- Keep commits atomic where practical. Each commit should describe one coherent
  change and leave the repository in a buildable, reviewable state.
- Rebase or merge current `main` before asking for review when the branch is
  stale or touches active areas.

## Agent-Facing Documentation

Repository-local docs are the source of truth for future agents. If a decision
only exists in chat, it is invisible to the next agent.

- Use `AGENTS.md` as the dispatcher.
- Keep durable engineering context in `docs/`.
- Use local `README.md` files for ordinary code areas.
- Use local `AGENTS.md` files only for high-risk boundaries such as Quick Look
  and plugin/MCP work.
- Document new scripts in `scripts/README.md` or `docs/tools/index.md`.

## Validation

Pick the smallest command that covers the changed surface, then broaden when the
change crosses boundaries:

```bash
vp check
vp test
bun run ci:fast
```

Native, Quick Look, release, and plugin changes need their focused checks as
documented in `scripts/README.md`, `PreviewExtension/AGENTS.md`, and
`plugins/burette-agent/AGENTS.md`.

## Pull Request Readiness

Before marking a PR ready for review:

- Fill in the PR template.
- Link the issue or discussion when the change is not self-explanatory.
- Include validation commands and any visual/native/Quick Look checks.
- Call out known risks, follow-ups, or intentionally skipped checks.
- Make sure release-note labels are applied when the change should appear on
  GitHub Releases.

## Security

Do not post credentials, signing material, proprietary molecule data, or exploit
details in public issues or pull requests. Coordinate privately with a
maintainer and provide the smallest safe reproduction.
