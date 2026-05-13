# Agent Notes

Burrete is a macOS menu bar app plus a Quick Look Preview Extension for
molecular structure files.

## Documentation Graph

- User-facing overview: [README.md](README.md)
- Documentation map: [docs/README.md](docs/README.md)
- Architecture: [docs/architecture.md](docs/architecture.md)
- Renderer support: [docs/renderer-support.md](docs/renderer-support.md)
- Quick Look debugging: [docs/quicklook-debugging.md](docs/quicklook-debugging.md)
- Release process: [docs/releasing.md](docs/releasing.md)
- Specs: [docs/specs/README.md](docs/specs/README.md)

## Stable Runtime Identifiers

Quick Look extension bundle identifier:

```text
com.local.BurreteV10.Preview
```

Forced preview content types:

```text
com.local.burrete10.pdb
com.local.burrete10.cif
```

## Common Commands

```bash
npm run ci:fast
./scripts/build.sh
./scripts/install.sh
./scripts/force-preview.sh samples/mini.pdb
./scripts/force-preview.sh samples/mini.cif
./scripts/force-preview.sh samples/mini.xyz
```

After replacing the app, refresh Quick Look:

```bash
qlmanage -r
qlmanage -r cache
killall quicklookd 2>/dev/null || true
```

## Maintenance Rules

- Keep current docs under `docs/`.
- Keep specs under `docs/specs/`.
- Do not reintroduce imported reference snapshots or migration handoff logs into
  the active docs graph.
- Verify doc claims against source, scripts, or runtime output before updating
  docs.
