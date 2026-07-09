# Privacy Policy

Effective date: July 10, 2026

This policy covers the Burrete desktop application, its Finder Quick Look
extensions, and the Burrete plugin for Codex.

## Local data processing

Burrete is local-first software. Molecular files selected by the user are
opened and processed on the user's device. The Burrete Codex plugin does not
upload molecular files to a Burrete-operated service and does not include
developer-controlled analytics or advertising trackers.

When the plugin is used through Codex, tool inputs, bounded tool results, and
other content needed to answer the request may be processed by the Codex host
under the user's OpenAI account and workspace policies. Users should not expose
confidential molecular data to Codex unless their organization permits it.

## Network access

Burrete may make network requests when the user asks it to fetch a public URL,
retrieve a public structure, check for software updates, or download an update.
Those requests are sent to the selected third-party service, such as GitHub or
the RCSB Protein Data Bank, and are governed by that service's privacy terms.

The plugin's public-URL fetch tool blocks localhost, private-network, and
link-local destinations and bounds the returned content. It does not provide a
general-purpose network proxy.

## Local storage

Burrete may store local preferences, recent-file references, logs, preview
caches, and short-lived agent session files on the user's device. Removing the
application does not automatically remove every local preference or cache.
Users can clear Burrete caches and diagnostics from the application settings or
remove the corresponding local application data manually.

## Sharing and retention

Burrete does not sell personal information. The project maintainers do not
receive local molecular files or agent session content unless a user explicitly
shares those materials, for example in a support request. Public issue reports
should not contain confidential structures, credentials, or private paths.

## Contact

For privacy questions, open a private security advisory at
<https://github.com/SergeiNikolenko/Burrete/security/advisories/new> or use the
project issue tracker for non-sensitive questions.
