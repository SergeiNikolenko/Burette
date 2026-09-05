# Local Burette plugin: publication and host acceptance

## What the reference establishes

The inspected Molecular Structure Viewer package identifies OpenAI as its
author and ships a local stdio server plus embedded viewer assets. That proves
its installed architecture, not how it was privately reviewed or admitted to
the directory. Burette should not copy its branding, code bundle, or claim the
same distribution entitlement.

The local prototype follows the same general MCP Apps pattern using Burette's
own existing renderer. It is distinct from the hosted Burette plugin and its
existing submission; do not replace that submission with a local stdio package.

## Official submission boundary

The [Plugins Directory submission guide](https://developers.openai.com/plugins/deploy/submission)
describes public submission and review for ChatGPT/Codex. For MCP-backed public
submission, the server must be reachable using the supported HTTPS transport.
The [Claude-plugin migration guide](https://developers.openai.com/plugins/guides/submit-claude-plugin)
explicitly distinguishes local stdio plugins and asks developers whose core
value depends on local execution/files/hardware/offline operation to contact
their OpenAI partner before submission. A self-contained local viewer does not
remove that distribution gate. A skills-only submission must not conceal a
local MCP dependency.

## Acceptance demo to prepare

1. One authorized local PDB/mmCIF file opens as a nonblank inline MCP App.
2. A typed observation identifies the file digest, counts and ready state.
3. Focusing a specific ligand succeeds; a nonexistent selector fails explicitly.
4. Expansion and return use one session and retain camera and selection.
5. Network access is disabled in the App; source bytes are not model content.
6. A clean install works without a source checkout; reload behavior is stated.

Native Codex mounting is a separate gate from MCP wire tests and a Browser
protocol harness. Do not submit a demo labelled native until that gate passes.

## Draft inquiry — not sent

> We maintain Burette, an open-source molecular workspace for local scientific
> files. We are prototyping a local stdio MCP plugin with a self-contained MCP
> App: a user-selected PDB/mmCIF file remains on-device, the viewer has no network
> connect permissions, and bounded typed tools operate the same scene in inline
> and host-expanded modes. We also maintain a separate HTTPS-hosted plugin.
>
> Your submission guidance recommends partner discussion for plugins whose
> core value depends on local files and offline execution. Is a third-party
> local plugin eligible for a reviewed distribution path comparable in host
> capabilities to Molecular Structure Viewer? Which packaging, sandboxing,
> native file-viewer APIs, privacy documentation, and acceptance tests would you
> require? We can provide source, a minimal package, and a reproducible demo.
>
> Source: https://github.com/SergeiNikolenko/Burette

Send only after choosing a real OpenAI contact or supported intake channel and
obtaining authorization to send. No partner acceptance or publication approval
has been received.
