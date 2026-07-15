# Burrete Public Plugin

This package is the hosted MCP service for the public Burrete plugin-plus-skills
plugin. It is intentionally separate from the local stdio plugin under
`plugins/burette-agent`:

- the hosted plugin is designed for ChatGPT and Codex without local installation,
  with directory installation available after OpenAI review and publication;
- the local plugin can open local files and control the Burrete macOS app;
- the hosted plugin is read-only and never controls a user's desktop or local
  Burrete sessions.

Tool results open directly in a focused Burrete molecular preview. The hosted
widget omits desktop document tabs, sidebars, and docks while preserving the
native interactive viewer controls, sequence, selection, measurements, and
representations. The package does not expose a separate branded viewer page:
the root URL redirects to the public plugin documentation.

## MCP contract

The production Streamable HTTP endpoint is
<https://burrete-plugin.vercel.app/mcp>. It exposes three no-auth tools:

| Tool | Behavior |
| --- | --- |
| `preview_molecular_file` | Reads one ChatGPT-authorized PDB, ENT, PDBQT, CIF, mmCIF, SDF, SD, XYZ, or extXYZ attachment. |
| `preview_pdb_structure` | Retrieves one public RCSB structure from an explicit four-character PDB ID. |
| `render_molecular_scene` | Re-renders one PDB entry or authorized attachment with bounded select, focus, clear, reset, and component visibility actions. |

All tools are read-only, idempotent, non-destructive, and cannot write to the
public internet. Each declares an exact output schema and renders
`ui://burrete/molecular-viewer-v20.html` with MIME type
`text/html;profile=mcp-app`.

The widget uses the MCP Apps handshake before publishing bounded selection or
scene state through `ui/update-model-context`. Lasso selection includes up to
96 atom identities and residues, and clearing the selection explicitly clears
the model-visible state. Viewer actions run client-side in the isolated widget;
the server does not persist a shared molecular workspace.

The model receives only bounded structure summaries. Original molecular text
is placed in tool-result `_meta`, which is delivered to the viewer but hidden
from the model and conversation transcript.

## Data and security boundaries

- Input size is limited to 3 MiB and 200,000 lines and is processed in memory
  without application-level persistence.
- Attachment downloads must use public HTTPS URLs. Localhost, private,
  link-local, reserved IP ranges, credentials in URLs, DNS responses containing
  private addresses, and more than three redirects are rejected. Each request
  is connected to an already validated public address with the original TLS SNI
  and Host header, preventing a second DNS resolution from changing the target.
- Downloads time out after 15 seconds and are bounded while streaming.
- PDB lookups use the fixed `files.rcsb.org` download origin.
- The MCP resource mounts the compiled Burrete React shell directly instead of
  wrapping a separate viewer page. Its CSP permits only the stable production
  origin for runtime fetches and resources; the widget does not embed subframes.
- The hosted shell loads only the plugin's pinned, self-hosted Burrete, Mol*,
  and RDKit runtime assets.
- The Mol* 5.7.0 build is transformed by
  `scripts/build-molstar-csp.mjs` to remove dynamic code generation that is not
  allowed by MCP Apps sandbox CSP. The build script verifies the pinned source
  checksums, defers the disabled MP4 encoder's WASM initialization, and fails
  closed if the upstream bundle changes.
- Every string and collection copied into model-visible `structuredContent` is
  bounded by the declared output schema. Raw structure text remains only in
  widget-only `_meta`.

Hosting infrastructure may retain ordinary request metadata in platform logs.
The hosted widget also sends one anonymized Vercel Web Analytics pageview for
the fixed path `/mcp/widget` when it loads. Automatic URL tracking is disabled,
and the event does not contain PDB IDs, filenames, molecular content, viewer
selection, or chat/session identifiers.
The public [privacy policy](https://burrete-landing.vercel.app/privacy)
describes that hosting boundary, recipients, retention, user controls, and RCSB
lookup behavior.

## Development

Run from this directory:

```bash
bun run test
bun run typecheck
bun run build
bun run dev
```

The production server exposes:

- `/` — permanent redirect to the public plugin documentation; the hosted
  service is not a standalone web workspace;
- `/mcp` — stateless Streamable HTTP MCP endpoint;
- `/api/health` — no-store health response;
- `/.well-known/openai-apps-challenge` — exact domain-verification token when
  `OPENAI_APPS_CHALLENGE` is configured.

## Environment

| Variable | Purpose |
| --- | --- |
| `PUBLIC_APP_ORIGIN` | Stable production origin used by MCP App domain and CSP metadata. |
| `OPENAI_APPS_CHALLENGE` | Exact token supplied by the OpenAI plugin portal for domain verification. |

Do not change the production origin after publication. Preview deployments can
use Vercel-provided deployment origins, while production should set
`PUBLIC_APP_ORIGIN` explicitly.

The local Burrete desktop app remains the primary workspace. The hosted service
only supplies the public MCP endpoint, widget assets, and one isolated
structure result at a time inside the user's chat. The separate packaged local
plugin remains the preferred path for local files and installed-app control on
the same Mac through the local MCP and CLI bridge.

`bun run build` first copies the reviewed viewer runtime assets and builds the
real desktop React shell in hosted MCP mode with stable component entry files.
The generated `public/burrete-viewer` and `public/viewer-shell` directories are
build output and are not committed.

## Submission materials

- `chatgpt-app-submission.json` — listing suggestions and exactly five positive
  plus three negative review tests.
- `submission/skills/preview-molecular-structures/SKILL.md` — public bundled
  skill for the plugin submission.
- `submission/portal-copy.md` — starter prompts, release notes, and portal
  checklist.
- `submission/screenshots/chatgpt-pdb-viewer-mobile.jpg` — production v9
  ChatGPT mobile-width review screenshot captured with CSP enforcement enabled.

The existing logo at `plugins/burette-agent/assets/app-icon.png` is the
production-ready 512 × 512 listing asset.
