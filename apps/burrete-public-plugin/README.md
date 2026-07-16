# Burrete Public Plugin

This package is the hosted MCP service for the public Burrete plugin-plus-skills
plugin. It is intentionally separate from the local stdio plugin under
`plugins/burette-agent`:

- the hosted plugin is designed for ChatGPT and Codex without local installation,
  with directory installation available after OpenAI review and publication;
- the local plugin can open local files and control the Burrete macOS app;
- the hosted public-structure tools are read-only and never control a user's
  desktop or local Burrete sessions; the separate hosted Ketcher relay is an
  ephemeral, isolated editor surface.

Tool results open directly in a focused Burrete molecular preview. The hosted
widget omits desktop document tabs, sidebars, and docks while preserving the
native interactive viewer controls, sequence, selection, measurements, and
representations. The package does not expose a separate branded viewer page:
the root URL redirects to the public plugin documentation.

## MCP contract

The production Streamable HTTP endpoint is
<https://burrete-plugin.vercel.app/mcp>. It exposes the public preview tools and
an isolated Ketcher editor contract:

| Tool | Behavior |
| --- | --- |
| `preview_molecular_file` | Reads one ChatGPT-authorized PDB, ENT, PDBQT, CIF, mmCIF, SDF, SD, XYZ, or extXYZ attachment. |
| `preview_pdb_structure` | Retrieves one public RCSB structure from an explicit four-character PDB ID. |
| `render_molecular_scene` | Re-renders one PDB entry or authorized attachment with bounded select, focus, clear, reset, and component visibility actions. |
| `open_ketcher` | Creates an ephemeral Ketcher editor surface and optionally seeds one bounded inline KET, MOL, RXN, or SMILES structure. |
| `control_ketcher` | Applies a revision-checked Ketcher action and returns a bounded editor snapshot plus widget seed. |

The three public-structure tools are read-only and idempotent. Ketcher actions
are scoped to an in-memory relay, are bounded and revision-checked, and never
write files or the public internet. Each Ketcher result renders
`ui://burrete/ketcher-editor-v1.html`; the structure-preview tools render
`ui://burrete/molecular-viewer-v21.html`, both with MIME type
`text/html;profile=mcp-app`.

The resource URI is a stable connector contract and must not be bumped for
asset-only releases. JavaScript and CSS cache versions belong in their asset
URLs. If the resource URI ever changes intentionally, refresh the ChatGPT
developer connector before running the live smoke test or submitting a new
version.

The widgets use the MCP Apps handshake before publishing bounded selection,
scene, or chemical-editor state through `ui/update-model-context`. Lasso
selection includes up to 96 atom identities and residues, and clearing the
selection explicitly clears the model-visible state. Ketcher mutations run
through the revision-checked relay; the server does not persist a shared
molecular workspace.

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
- Hosted Ketcher surfaces are process-local and ephemeral. Inline structure
  content is capped at 64 KiB, atom-index lists at 256 entries, and inline
  exports at 64 KiB. `contentRef` is rejected until a scoped artifact relay is
  deployed.
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
The public `/web-demo/index.html` surface additionally sends privacy-safe custom
events and Speed Insights. Events cover sessions, screen and structure views,
stable UI controls, command categories, search-length buckets, settings changes,
drop and paste inputs, engagement milestones, and categorized client/resource
errors. Event properties are intentionally limited to two dimensions so they
work on the standard Vercel Pro analytics tier. Raw queries, filenames, local
paths, PDB IDs, SMILES, molecular content, error messages, and stack traces are
never event properties. Vercel Web Analytics and Speed Insights must both be
enabled for the production project in the Vercel dashboard; custom events
require a Pro or Enterprise plan.
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

- `chatgpt-app-submission.json` — listing suggestions and exactly seven positive
  plus three negative review tests.
- `submission/skills/preview-molecular-structures/SKILL.md` — public bundled
  skill for the plugin submission.
- `submission/portal-copy.md` — starter prompts, release notes, and portal
  checklist.
- `submission/screenshots/chatgpt-pdb-viewer-mobile.jpg` — production v9
  ChatGPT mobile-width review screenshot captured with CSP enforcement enabled.

The existing logo at `plugins/burette-agent/assets/app-icon.png` is the
production-ready 512 × 512 listing asset.
