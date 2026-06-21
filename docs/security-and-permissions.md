# Security And Permissions

Burrete works with local molecular files, native macOS preview extensions,
browser-dev servers, and agent-operated sessions. The security model is local
first: explicit files, bounded payloads, tokenized browser surfaces, and narrow
native command permissions.

## Local File Access

- The desktop app opens files selected by the user, command-palette actions,
  drag-and-drop, recent/project roots, or explicit agent-session commands.
- Browser-dev filesystem access must be explicit. Use `BURRETE_DEV_FS_ALLOW`
  for extra local roots during browser testing.
- Quick Look receives a file selected by Finder or a forced preview command. It
  should not scan unrelated directories to discover additional data.
- Large molecular files should stay path-based unless a runtime explicitly
  needs inline data.

Do not add recursive directory ingestion, broad home-directory reads, or hidden
network fetches without an explicit design and validation plan.

## Tauri Permissions

Tauri command access is controlled by:

- `apps/desktop/src-tauri/capabilities/default.json`
- `apps/desktop/src-tauri/permissions/burrete.toml`

When adding a Tauri command:

1. Keep the command narrow and typed.
2. Add it to the Burrete permission allowlist only when the desktop shell needs
   it.
3. Keep payloads explicit; avoid unstructured `any`-style JSON at the native
   boundary.
4. Add or update the focused Tauri/frontend bridge test when the command is a
   user-visible or agent-visible contract.

## Browser And Agent Surfaces

Browser means the in-app Browser plugin unless a user explicitly asks for an
external browser. The Browser and Computer surfaces are verification tools, not
the source of molecular truth.

- `scripts/burrete-agent.mjs` is the app-control contract.
- `scripts/agent-preview.mjs` is the tokenized preview server.
- Browser shell sessions use explicit session directories with observe/action
  files.
- MCP tools should wrap the CLI or plugin validation scripts instead of
  reimplementing app control.
- Widget snapshots, molecular reports, tables, and trajectory artifacts must be
  bounded before rendering.

Do not add arbitrary shell execution, arbitrary JavaScript execution,
destructive overwrites, or remote job submission to the plugin/MCP surface.

## Local Servers

Local browser-dev or preview servers are for development and QA. Use
[Testing surfaces](tools/testing-surfaces.md) before starting one.

- Bind to local hosts only.
- Prefer generated tokens for preview sessions that expose file content.
- Do not silently fall back from Browser verification to the desktop app; those
  are different surfaces.
- Report localhost bind failures as environment/runtime failures, not app logic
  regressions.

## Release Secrets

Release credentials are secret material:

- Developer ID certificates and passwords
- Apple ID, team ID, and app-specific password
- Notary keychain profile names
- update manifest signing keys
- Homebrew tap token

Store them in the local keychain/environment or GitHub Actions secrets. Never
commit them, print them in logs, or include them in diagnostics bundles.

## Diagnostics And Logs

Diagnostics bundles are local artifacts. They are intended to contain logs,
environment summaries, app size reports, performance marks, recent UI/render
errors, and preview traces. They should not include raw molecule contents,
structure payloads, credentials, or private keys.

Useful local diagnostics commands:

```bash
./scripts/doctor.sh
./scripts/diagnose.sh samples/mini.pdb
./scripts/tail-log.sh
```

When sharing diagnostics, prefer the smallest excerpt that explains the issue.
Redact local usernames, private paths, credentials, and proprietary molecule
data when they are not needed for the fix.

## Security Reporting

Do not put exploit details, credentials, or private sample data into a public
issue or pull request. Coordinate privately with a maintainer and provide a
minimal reproduction that avoids sensitive molecular data where possible.
