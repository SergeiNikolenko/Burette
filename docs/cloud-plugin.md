# HTTPS-only Codex plugin

## Decision

Ship `plugins/burette-cloud` as a distinct plugin that connects directly to the
already hosted Burette service. Reuse `apps/burette-public-plugin` rather than
placing the local CLI behind an HTTP proxy. The cloud package has no command,
args, cwd, local runtime, shell scripts or machine credentials. Its MCP
configuration follows the Codex format documented at
https://developers.openai.com/plugins/deploy/submission.

The flow is Codex -> HTTPS MCP -> bounded structure parser -> MCP App resource
and widget-only coordinates -> host-rendered viewer. RCSB retrieval uses the
fixed public upstream. Attachment retrieval uses the existing guarded downloader.
A successful tool call proves preparation, while host acknowledgement is needed
to prove visual rendering and applied scene actions.

## Product boundary

| Capability | Cloud package | Local plugin |
| --- | --- | --- |
| Public PDB and composition summary | Supported | Supported |
| Molecular attachment | Host downloadable reference, <=3 MiB | Local path |
| Viewer selection/focus/visibility | Bounded hosted scene actions | Local workspace actions |
| Chemical sketch | Ephemeral Ketcher | Local editor |
| Local folders and desktop control | Unavailable | Local bridge |
| Contacts, SASA, alignment, PNG jobs | Unavailable in this endpoint | Local molecular sessions |
| Durable workspace or large trajectory | Unavailable | Local workflow |

Hosted viewer and Ketcher cards omit the Compute menu. They do not request
compute anchors from the viewer or expose desktop calculation workflows.
Hosted sketches mount Ketcher directly in the card so editor loading does not
depend on a desktop molecular-frame URL across the host's sandbox origin.

This release is a bounded inspection product, not feature parity with the local
plugin. Existing tools and service deployment are reused without schema changes.
Host attachment support is a compatibility gate: never manufacture download
references or automatically publish local files to make the cloud tool work.

## Privacy and failure handling

Private attachment processing requires authorization for that file. The cloud
skill states the external-processing boundary before invoking an attachment
call. This instruction is an agent routing rule, not a server-side consent
mechanism. The server only enforces URL/size/timeout limits; it cannot verify
whether a user authorized an arbitrary public URL.

The service is currently unauthenticated and has no durable tenant storage.
Do not add private shared workspace persistence to it without authentication,
per-user authorization, deletion and retention policies. Do not expose local
MCP tools that execute commands, read arbitrary paths, or submit compute jobs.

Molecular files are processed in memory. Platform logs and analytics remain
subject to the published policy. No upload bucket or secret is introduced.
Private-network URLs, credential-bearing URLs, redirects to private addresses,
and oversized streams remain rejected by the existing structure service.

The Ketcher relay is process-local: serverless instance changes can invalidate
a surface. Report expiry and offer a fresh editor seeded with known input;
do not silently reconstruct unsaved edits or claim durability. Hosting outages
must be visible and must not trigger installation of the local plugin.

## Release gates and rollback

1. Build a fresh allowlisted ZIP; validate all referenced components inside it.
2. Run the live HTTPS smoke with public data. It checks initialization, tool
   discovery, PDB parsing, scene preparation, private-address rejection,
   Ketcher creation and MCP App HTML delivery.
3. Install/upload as a separate identity and verify a mounted Codex card and
   host-provided attachment. These host gates cannot be inferred from HTTP tests.
4. Obtain portal validation and review. A URL-only manifest removes the local
   command declaration but does not guarantee approval or resolve old cases.

Do not modify the existing managed plugin ID or replace its MCP connection.
The new package has manifest name `burette-cloud-viewer`, no managed ID, and is uploaded as Burette Cloud. The old
local draft remains available for the support investigation. No support message
is sent by the build or smoke scripts.

Disable the cloud plugin to roll back. There are no local sessions or settings
migrations to reverse. Keep the stable production endpoint, resource URIs and
tool contracts compatible when upgrading the hosted implementation.

## Reproduction

```sh
node --test tests/test-cloud-plugin-package.mjs
node scripts/smoke-cloud-plugin.mjs
node scripts/build-cloud-plugin.mjs
```

See [the package README](../plugins/burette-cloud/README.md) for package contents
and [the service README](../apps/burette-public-plugin/README.md) for runtime
limits, deployment configuration and the existing hosted test suite.

## Submission endpoint identity

The cloud package uses `https://burette-plugin.vercel.app/mcp?client=burette-cloud`.
The query identifies this submission separately from the existing app, because
the publisher portal requires a unique MCP URL per app. It is not authentication
or tenant isolation; both URLs intentionally use the same stateless transport
and tool contract. The live smoke reads the exact URL from the package.
