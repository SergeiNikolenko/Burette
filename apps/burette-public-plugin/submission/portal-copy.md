# Burette — portal copy

## Listing

- **Plugin name:** Burette
- **Short description:** Preview molecular structures
- **Category:** Education
- **Website:** https://burette-landing.vercel.app
- **Support:** https://burette-landing.vercel.app/support
- **Privacy:** https://burette-landing.vercel.app/privacy
- **Terms:** https://burette-landing.vercel.app/terms
- **Logo:** `plugins/burette-agent/assets/app-icon.png` in the main Burette
  repository (512 × 512 PNG)
- **ChatGPT web screenshot:** capture a new screenshot from the production v21
  widget in a fresh ChatGPT conversation after deploying this resubmission and
  rescanning the MCP endpoint.
- **Live ChatGPT proof:** replace this field with a fresh reviewer-accessible
  conversation URL created from the rescanned production plugin.
- **Desktop demo video:** https://burette-landing.vercel.app/assets/burette-chatgpt-plugin-demo.mp4
- **Physical iPhone demo video:** record and upload a fresh run after the
  production resubmission build is deployed.
- **Mobile verification:** verify the rescanned production version on a
  physical iPhone before resubmitting; do not reuse the July 15 evidence as
  proof of the new version.

### Long description

Burette opens attached PDB, mmCIF, SDF, and XYZ-family
structure files as interactive 3D molecular scenes in ChatGPT and Codex. It can
also retrieve an explicitly requested public Protein Data Bank entry by PDB ID.
Each result includes bounded composition counts and opens directly as a focused
Burette molecular preview without desktop document tabs, sidebars, or docks.
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
2. Open PDB 1CRN in the Burette molecular preview.
3. Visualize this mmCIF file and tell me how many chains and residues it has.
4. Preview the attached XYZ geometry and identify the element counts.
5. Open Ketcher and sketch ethanol from the SMILES CCO.

## Release notes

Resubmission after review-case corrections. Burette now reports verified chain,
residue, atom, bond, and element counts for the submitted PDB, mmCIF, and SDF
fixtures; every structured tool result declares an output schema; and the five
positive review cases are independent. The no-auth MCP server still provides
supported molecular attachments, explicit RCSB PDB lookups, an isolated
revisioned Ketcher editor, and interactive CSP-compatible previews. No reviewer
account or credentials are required.

## Availability

Select every country and region offered by the portal where OpenAI's plugin
directory and these public terms, privacy policy, and support process are
supported.

## Deployment values

- **Production MCP URL:** https://burette-plugin.vercel.app/mcp
- **Challenge Base URL:** https://burette-plugin.vercel.app
- **Authentication:** No authentication.
- **Reviewer credentials:** Not required.
- **CSP connect domains:** The stable production app origin only, for self-hosted runtime assets such as RDKit WASM.
- **CSP resource domains:** The stable production app origin only.
- **CSP frame domains:** The stable production app origin only.

## Portal prerequisites

- Open the rejected submission ID from the review email and confirm that it is
  the same app as the personal ChatGPT card before changing or resubmitting it.
- Rename the existing ChatGPT card from the legacy spelling `Burrete` to
  `Burette`, and verify that the refreshed card shows the current listing copy.
- Select the verified developer or business identity that matches the public
  website and policies.
- Submit from the same OpenAI organization and a global-data-residency project.
- The submitter needs Apps Management write permission.
- After entering the MCP URL, scan tools and verify all five tool descriptors,
  top-level and `_meta` no-auth security schemes, bounded output/action
  contracts, annotations, and the viewer resources.
- Put the portal's exact domain token in `OPENAI_APPS_CHALLENGE`, deploy, and
  complete domain verification before submitting for review.
- Run every submitted test case independently in a fresh ChatGPT conversation
  on web and mobile. Record the exact text result and verify the widget is
  nonblank and interactive before resubmitting.
- Separately test all five tools in ChatGPT Developer Mode on web and mobile,
  including `render_molecular_scene` selection/focus/visibility, the two-step
  `open_ketcher` then `control_ketcher` edit/export flow, Ketcher revision
  conflicts, and resizing of the inline preview/editor.
- Capture the required submission screenshots from the real ChatGPT widget
  after the Developer Mode checks; do not substitute a direct shell URL or a
  local preview for the final portal screenshots.
- Keep `ui://burette/molecular-viewer-v21.html` stable through review. Asset
  releases should change only the JS/CSS cache versions; if the resource URI
  must change, refresh the connector before the next live smoke test.
