# Burette Public Plugin

This package is the hosted MCP service for the public Burette plugin-plus-skills
plugin. It is intentionally separate from the local stdio plugin under
`plugins/burette-agent`:

- the hosted plugin is designed for ChatGPT and Codex without local installation,
  with directory installation available after OpenAI review and publication;
- the local plugin can open local files and control the Burette macOS app;
- the hosted public-structure tools are read-only and never control a user's
  desktop or local Burette sessions; the separate hosted Ketcher relay is an
  ephemeral, isolated editor surface.

Tool results open directly in a focused Burette molecular preview. The hosted
widget omits desktop document tabs, sidebars, and docks while preserving the
native interactive viewer controls, sequence, selection, measurements, and
representations. The package does not expose a separate branded viewer page:
the root URL redirects to the public plugin documentation.

## MCP contract

The production Streamable HTTP endpoint is
<https://burette-plugin.vercel.app/mcp>. It exposes the public preview tools and
an isolated Ketcher editor contract:

| Tool | Behavior |
| --- | --- |
| `preview_molecular_file` | Reads one ChatGPT-authorized PDB, ENT, PDBQT, CIF, mmCIF, SDF, SD, XYZ, or extXYZ attachment. |
| `preview_pdb_structure` | Retrieves one public RCSB structure from an explicit four-character PDB ID. |
| `render_molecular_scene` | Re-renders one PDB entry or authorized attachment with bounded select, focus, clear, reset, and component visibility actions. |
| `open_ketcher` | Creates an ephemeral Ketcher editor surface and optionally seeds one bounded inline KET, MOL, RXN, or SMILES structure. |
| `control_ketcher` | Applies a revision-checked Ketcher action and returns a bounded editor snapshot plus widget seed. |

The three public-structure tools are read-only and idempotent. Ketcher actions
are bounded and revision-checked, carry an opaque continuation token between
stateless requests, and never write files or the public internet. Each Ketcher result renders
`ui://burette/ketcher-editor-v1.html`; the structure-preview tools render
`ui://burette/molecular-viewer-v21.html`, both with MIME type
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
through the revision-checked relay. A shared Redis REST CAS consumes each
continuation token at most once across serverless instances; Redis stores only
the token digest, mutation claim, and encrypted successor token until the
consumed token's TTL expires. This is concurrency control for an ephemeral
chain, not a persistent shared molecular workspace.

The public-structure tools expose only bounded structure summaries to the
model; original attachment or PDB text is placed in tool-result `_meta`, which
is delivered to the viewer but hidden from the model and conversation
transcript. Seed content from routine `open_ketcher`, `set_structure`, or
`highlight_atoms` results follows the same `_meta` path. When a user or tool
explicitly requests `get_structure`, the bounded requested export formats
remain model-visible in that tool result. The hosted relay returns the current
representation or a complete SDF record derived from MOL; it does not claim
server-side conversion for other format pairs and returns `EXPORT_FAILED`
instead. Hosted `get_structure` delivery is inline-only; artifact or download
delivery requests fail explicitly instead of returning a fake reference.
Successful Ketcher tool results also include a bounded model-visible editor
snapshot; its structure summary may contain a length-limited SMILES or reaction
SMILES, but not the raw KET, MOL, or RXN seed payload.

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
- Hosted Ketcher surfaces are ephemeral but not process-affine. An authenticated,
  encrypted continuation token carries up to 64 KiB of inline structure content
  and expires 15 minutes after each successful action. Atom-index lists are
  capped at 256 entries and inline exports at 64 KiB. `contentRef` is rejected
  until a scoped artifact relay is deployed. Redis REST `SET NX`, `GET`, and
  atomic `EVAL` compare-and-complete operations serialize that token chain
  across instances. If Redis is unavailable or its configuration is missing,
  mutations fail closed instead of falling back to process-local state. The
  token is not a durable or multi-writer workspace.
- The MCP resource mounts the compiled Burette React shell directly instead of
  wrapping a separate viewer page. Its CSP permits only the stable production
  origin for runtime fetches and resources; the widget does not embed subframes.
- The hosted shell loads only the plugin's pinned, self-hosted Burette, Mol*,
  and RDKit runtime assets.
- The hosted plugin copies the reviewed Mol* bundle from
  `PreviewExtension/Web`, whose source and checksum are pinned by
  `vendor-assets.lock.json`. `scripts/build-molstar-csp.mjs` fails closed if
  that bundle contains dynamic code generation forbidden by the MCP Apps
  sandbox CSP.
- Every string and collection copied into model-visible `structuredContent` is
  bounded by the declared output schema. Original attachment or PDB text and
  routine hosted Ketcher seed content remain in widget-only `_meta`; explicit
  bounded `get_structure` exports and the snapshot's bounded SMILES summary
  remain model-visible.

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
The public [privacy policy](https://burette-landing.vercel.app/privacy)
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
| `KETCHER_STATE_SECRET` | Stable secret used only to authenticate and encrypt ephemeral hosted Ketcher continuation tokens. |
| `KETCHER_CAS_REDIS_REST_URL` | Explicit HTTPS endpoint for a shared Redis REST database supporting `SET NX`, `GET`, and `EVAL`. Must be paired with `KETCHER_CAS_REDIS_REST_TOKEN`; takes priority over the Marketplace pair. |
| `KETCHER_CAS_REDIS_REST_TOKEN` | Explicit bearer token for the shared Redis REST database. Must be paired with `KETCHER_CAS_REDIS_REST_URL`. |
| `KV_REST_API_URL` | Standard Vercel Marketplace Upstash REST endpoint. Used only when neither explicit `KETCHER_CAS_*` variable is set and must be paired with `KV_REST_API_TOKEN`. |
| `KV_REST_API_TOKEN` | Standard Vercel Marketplace Upstash REST token. Must be paired with `KV_REST_API_URL`. |

Do not change the production origin after publication. Preview deployments can
use Vercel-provided deployment origins, while production should set
`PUBLIC_APP_ORIGIN` explicitly. Production and every preview deployment used
for Ketcher review must configure one complete CAS variable pair for a shared
Redis database. Variables from different pairs are never combined, and a
partial pair is a configuration error. Serverless instance-local memory is
intentionally unsupported.

The local Burette desktop app remains the primary workspace. The hosted service
only supplies the public MCP endpoint, widget assets, and one isolated
structure result at a time inside the user's chat. The separate packaged local
plugin remains the preferred path for local files and installed-app control on
the same Mac through the local MCP and CLI bridge.

`bun run build` first copies the reviewed viewer runtime assets and builds the
real desktop React shell in hosted MCP mode with stable component entry files.
The generated `public/burette-viewer` and `public/viewer-shell` directories are
build output and are not committed.

## Submission materials

- `chatgpt-app-submission.json` — listing suggestions and exactly five independent
  positive plus three negative review tests.
- `submission/skills/preview-molecular-structures/SKILL.md` — public bundled
  skill for the plugin submission.
- `submission/portal-copy.md` — starter prompts, release notes, and portal
  checklist.

Review screenshots, videos, and conversation links must be captured from the
exact rescanned production connector on ChatGPT web and a physical iPhone. The
repository does not treat older visual artifacts as proof of the current build.

The existing logo at `plugins/burette-agent/assets/app-icon.png` is the
production-ready 512 × 512 listing asset.
