# Burrete Molecular Viewer — portal copy

## Listing

- **Plugin name:** Burrete Molecular Viewer
- **Short description:** Preview molecular structures
- **Category:** Education
- **Website:** https://burrete-landing.vercel.app
- **Support:** https://burrete-landing.vercel.app/support
- **Privacy:** https://burrete-landing.vercel.app/privacy
- **Terms:** https://burrete-landing.vercel.app/terms
- **Logo:** `plugins/burette-agent/assets/app-icon.png` in the main Burrete
  repository (512 × 512 PNG)

### Long description

Burrete Molecular Viewer opens attached PDB, mmCIF, SDF, and XYZ-family
structure files as interactive 3D molecular scenes in ChatGPT and Codex. It can
also retrieve an explicitly requested public Protein Data Bank entry by PDB ID.
Each result includes bounded composition counts plus a full Mol* viewer with
sequence, selection, measurement, representation, and structure controls. The
hosted plugin is read-only, requires no account, and does not control local
files or desktop sessions.

## Starter prompts

1. Preview the attached SDF and summarize its molecules and elements.
2. Open PDB 1CRN and show it in the full molecular viewer.
3. Visualize this mmCIF file and tell me how many chains and residues it has.
4. Preview the attached XYZ geometry and identify the element counts.

## Release notes

Initial public app-plus-skills submission. Burrete provides a no-auth,
read-only hosted MCP server for supported molecular attachments and explicit
RCSB PDB lookups. Results include bounded structure summaries and an
interactive, CSP-compatible Mol* viewer. No reviewer account or credentials are
required.

## Availability

Select every country and region offered by the portal where OpenAI's plugin
directory and these public terms, privacy policy, and support process are
supported.

## Deployment values

- **Production MCP URL:** https://burrete-plugin.vercel.app/mcp
- **Challenge Base URL:** https://burrete-plugin.vercel.app
- **Authentication:** No authentication.
- **Reviewer credentials:** Not required.
- **CSP connect domains:** None.
- **CSP resource domains:** The stable production app origin only.

## Portal prerequisites

- Select the verified developer or business identity that matches the public
  website and policies.
- Submit from the same OpenAI organization and a global-data-residency project.
- The submitter needs Apps Management write permission.
- After entering the MCP URL, scan tools and verify both tool descriptors,
  top-level and `_meta` no-auth security schemes, exact output schemas,
  annotations, and the viewer resource.
- Put the portal's exact domain token in `OPENAI_APPS_CHALLENGE`, deploy, and
  complete domain verification before submitting for review.
- Test both tools in ChatGPT Developer Mode on web and mobile, including the
  inline-to-fullscreen viewer transition.
- Capture the required submission screenshots from the real ChatGPT widget
  after the Developer Mode checks; do not substitute the standalone example
  page for the final portal screenshots.
