# Privacy Policy

Effective date: July 10, 2026

This policy covers the Burrete website, hosted OpenAI molecular viewer and MCP
service, desktop application, Finder Quick Look extensions, and local Codex
plugin.

## Local data processing

The desktop app, Finder extensions, and local Codex workspace plugin are
local-first. Molecular files selected for those surfaces are opened and
processed on the user's device. They do not upload a file to the hosted Burrete
MCP service unless the user separately invokes the hosted OpenAI app.

## Hosted molecular previews

When a user invokes the hosted OpenAI app with an attachment, OpenAI provides
Burrete with a temporary HTTPS download URL, file identifier, filename, and MIME
type authorized for that tool call. Burrete fetches up to 3 MiB, parses the
molecular structure in memory, returns bounded composition data to the model,
and returns the raw structure only in result metadata used by the sandboxed Mol*
viewer.

The hosted service does not write attachment contents, signed download URLs, or
PDB files to Burrete application storage. File contents remain in server memory
only for the request and response lifecycle. The OpenAI host may retain the
conversation, tool result, attachment, and associated metadata under the user's
OpenAI account, workspace, data-control, and retention settings.

For a PDB lookup, Burrete receives the requested four-character PDB ID and sends
that ID to the RCSB Protein Data Bank. RCSB does not receive a user's attachment
through this tool.

## Service providers and technical metadata

OpenAI processes tool inputs and results so ChatGPT or Codex can run the app and
display its viewer. Vercel hosts the Burrete MCP service and website and may
process network and request metadata such as IP address, request time, route,
client type, approximate region, performance, and security events under its
policies. RCSB processes public PDB lookup requests.

Burrete does not intentionally configure application logs to record raw
molecular content or temporary signed download URLs. Technical logs and
security metadata are retained according to the applicable OpenAI and Vercel
account settings and policies. Burrete does not sell personal information or
molecular-file data.

## Network access

Burrete may make network requests when the user asks it to retrieve an
authorized attachment, fetch a public structure, check for software updates, or
download an update. Those requests are sent to the selected service, such as
OpenAI's attachment host, GitHub, or RCSB, and are governed by that service's
privacy terms.

The hosted attachment tool requires HTTPS, revalidates redirects, pins requests
to validated public addresses, blocks localhost and non-public destinations,
and bounds downloaded content. It does not provide a general-purpose network
proxy.

## Local storage

Burrete may store local preferences, recent-file references, logs, preview
caches, and short-lived agent session files on the user's device. Removing the
application does not automatically remove every local preference or cache.
Users can clear Burrete caches and diagnostics from the application settings or
remove the corresponding local application data manually.

## Sharing, retention, and user controls

The project maintainers do not receive local molecular files or local agent
session content unless a user explicitly shares those materials, for example in
a support request. Hosted attachments are processed as described above and are
not retained in Burrete application storage.

Users control whether to attach a molecular file, request a public PDB entry,
keep or delete the host conversation, and use the local-only workspace plugin
instead. Do not submit credentials, protected health information,
export-controlled structures, or confidential molecular data unless the user's
organization and OpenAI workspace policies explicitly permit that processing.

Public issues and support requests must not contain confidential structures,
temporary signed URLs, credentials, private paths, or proprietary logs.

## Contact

For privacy or security questions, open a private security advisory at
<https://github.com/SergeiNikolenko/Burrete/security/advisories/new>. Use
<https://burrete-landing.vercel.app/support> for non-sensitive support.
