# Burrete — portal copy

## Listing

- **Plugin name:** Burrete
- **Short description:** Preview molecular structures
- **Category:** Education
- **Website:** https://burrete-landing.vercel.app
- **Support:** https://burrete-landing.vercel.app/support
- **Privacy:** https://burrete-landing.vercel.app/privacy
- **Terms:** https://burrete-landing.vercel.app/terms
- **Logo:** `plugins/burette-agent/assets/app-icon.png` in the main Burrete
  repository (512 × 512 PNG)
- **ChatGPT web screenshot:** `submission/screenshots/chatgpt-pdb-viewer-web.jpg`
  captured from the production v21 widget in a real ChatGPT conversation after
  refreshing the developer connector.
- **Live ChatGPT proof:** https://chatgpt.com/c/6a57781a-b1b0-83ea-bb65-4c5b13bcc3a8
- **Desktop demo video:** https://burrete-landing.vercel.app/assets/burrete-chatgpt-plugin-demo.mp4
- **Physical iPhone demo video:** https://burrete-landing.vercel.app/assets/burrete-chatgpt-plugin-demo-iphone.mp4
- **Mobile verification:** the same production v21 plugin was confirmed working
  on a physical iPhone on July 15, 2026.

### Long description

Burrete opens attached PDB, mmCIF, SDF, and XYZ-family
structure files as interactive 3D molecular scenes in ChatGPT and Codex. It can
also retrieve an explicitly requested public Protein Data Bank entry by PDB ID.
Each result includes bounded composition counts and opens directly as a focused
Burrete molecular preview without desktop document tabs, sidebars, or docks.
The preview preserves viewer controls, sequence, selection, measurements, and
representations.
The hosted viewer starts with its floating control toolbar collapsed to keep the
molecule unobstructed; the visible grip button expands the complete toolbar.
The hosted Ketcher editor can also open an ephemeral chemical sketch surface,
apply revision-checked edits, and return bounded exports without writing the
source attachment or a local file. The hosted public-structure tools are
read-only; Ketcher mutations stay inside the isolated widget relay, require no
account, and do not control local files or desktop sessions.

## Starter prompts

1. Preview the attached SDF and summarize its molecules and elements.
2. Open PDB 1CRN in the Burrete molecular preview.
3. Visualize this mmCIF file and tell me how many chains and residues it has.
4. Preview the attached XYZ geometry and identify the element counts.
5. Open Ketcher and sketch ethanol from the SMILES CCO.

## Release notes

Initial public plugin-plus-skills submission. Burrete provides a no-auth hosted
MCP server for supported molecular attachments, explicit RCSB PDB lookups, and
an isolated revisioned Ketcher editor. Results include bounded structure
summaries and an interactive, CSP-compatible Burrete preview/editor. No
reviewer account or credentials are required.

## Availability

Select every country and region offered by the portal where OpenAI's plugin
directory and these public terms, privacy policy, and support process are
supported.

## Deployment values

- **Production MCP URL:** https://burrete-plugin.vercel.app/mcp
- **Challenge Base URL:** https://burrete-plugin.vercel.app
- **Authentication:** No authentication.
- **Reviewer credentials:** Not required.
- **CSP connect domains:** The stable production app origin only, for self-hosted runtime assets such as RDKit WASM.
- **CSP resource domains:** The stable production app origin only.
- **CSP frame domains:** The stable production app origin only.

## Portal prerequisites

- Select the verified developer or business identity that matches the public
  website and policies.
- Submit from the same OpenAI organization and a global-data-residency project.
- The submitter needs Apps Management write permission.
- After entering the MCP URL, scan tools and verify all five tool descriptors,
  top-level and `_meta` no-auth security schemes, bounded output/action
  contracts, annotations, and the viewer resources.
- Put the portal's exact domain token in `OPENAI_APPS_CHALLENGE`, deploy, and
  complete domain verification before submitting for review.
- Test all five tools in ChatGPT Developer Mode on web and mobile, including
  viewer controls, structure interaction, Ketcher revision conflicts, and
  resizing of the inline preview/editor.
- Capture the required submission screenshots from the real ChatGPT widget
  after the Developer Mode checks; do not substitute a direct shell URL or a
  local preview for the final portal screenshots.
- Keep `ui://burrete/molecular-viewer-v21.html` stable through review. Asset
  releases should change only the JS/CSS cache versions; if the resource URI
  must change, refresh the connector before the next live smoke test.
