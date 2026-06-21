# Contributing

Burrete accepts focused, reviewed changes. Agent-assisted work is welcome when
the contributor keeps the change scoped, verifies the result, and leaves enough
evidence for a maintainer to review the diff quickly.

## Contribution Quality

- Keep changes small and tied to one behavior, tool, or documentation boundary.
- Submit pull requests only when they are ready for review, not as unfinished
  scratch work.
- Add or update tests and documentation when changing behavior, public commands,
  agent workflows, or runtime contracts.
- Do not include generated bundles, app builds, cache directories, or local
  smoke output unless a maintainer explicitly asks for that artifact.
- For AI-generated changes, the author is responsible for manual review and for
  reporting exactly which commands or runtime checks were run.

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
