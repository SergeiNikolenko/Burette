# Burette Cloud

A separately installable Codex plugin using the existing public Burette
Streamable HTTP endpoint: https://burette-plugin.vercel.app/mcp?client=burette-cloud.
There is no executable, local MCP server, installer, shell hook, or desktop
bridge in this package. Internet access is required. No service login is
required; private files still require explicit cloud-processing authorization.

## Supported workflows

- Open an explicit public PDB ID and inspect bounded composition counts.
- Preview one supported attachment up to 3 MiB when the host provides a
  downloadable attachment reference.
- Prepare selections, focus and component visibility changes in the MCP App.
- Open a temporary Ketcher sketch and apply revision-checked edits.

A local filesystem path is not a remote attachment. Hosts without attachment
references can use public PDB entries and bounded inline Ketcher inputs.
MCP Apps rendering depends on the host; a successful tool response alone does
not prove a visible scene. Ketcher relay state is process-local and can expire
or disappear between serverless requests; it is not durable storage.

Local desktop control, bulk local folders, trajectories, compute jobs, contacts,
SASA, TM-align and PNG export through the local runtime are not cloud features.
Do not install this package as a transparent replacement for those workflows.

## Build and verify

From the repository root:

```sh
node scripts/build-cloud-plugin.mjs
node --test tests/test-cloud-plugin-package.mjs
node scripts/smoke-cloud-plugin.mjs
```

The builder copies reviewed icons from the local plugin and emits a fresh ZIP
with a checksum under `build/cloud-plugin`. The cloud manifest and skill are
owned here; the endpoint and schemas remain owned by
`apps/burette-public-plugin`. The live smoke uses public fixture 1CRN only.

## Publication and rollback

Upload the ZIP as a **new** Burette Cloud plugin. Its package identity is
`burette-cloud-viewer`, and its connection is `burette_cloud`. Do not reuse the local
plugin's managed ID or try to remove its existing MCP connection. The previous
local plugin draft and support cases remain independent.

The ZIP removes the command-MCP requirement by construction; successful portal
validation and review still have to be observed. Upload is not publication.
Use the existing hosted submission review cases as a starting point, adding
host tests for unavailable attachments, unmounted widgets and cloud consent.
Never present earlier ChatGPT screenshots as evidence of a mounted Codex card.

Rollback consists of disabling the cloud plugin; the local plugin and its
sessions are unaffected. Do not turn the remote endpoint into a tunnel to a
user's machine. HTTPS endpoint upgrades are independent of ZIP versions and
must retain the advertised tool schemas.

## Data handling

The hosted service downloads authorized attachments into memory. It validates
public HTTPS targets, pins the validated DNS address, limits redirects, bytes
and time, and rejects private networks. Original structure content is returned
in widget-only metadata, while the model receives bounded summaries. Hosting
request metadata and privacy-safe analytics are described in the public policy:
https://burette-landing.vercel.app/privacy.

Do not upload confidential data until its owner has authorized this processing.
No new upload bucket, persistent molecular database, or credentials are bundled.
