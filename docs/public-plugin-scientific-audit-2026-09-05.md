# Public molecular plugin: scientific workflow audit

Date: 2026-09-05. Execution host: `MacBookPro.local`.
Source baseline: `6dff390a11e1ac7fa13031097a34a86c08c416d5`.
Live endpoint: <https://burette-plugin.vercel.app/mcp>.

## Decision

**Not accepted as an end-to-end molecular editing or protein-analysis workflow.**
The plugin provides useful composition summaries and bounded editing commands,
but this audit found a production stereochemistry-corruption defect and several
format/observability gaps. A successful tool response is not evidence of a
correctly rendered or exported chemical structure.

The stereochemistry fix accompanying this report is local, tested, and not
deployed by this audit. Production probes below therefore describe the existing
endpoint, not the corrected source. No production deployment revision was
independently resolved in this audit; matching behavior is not commit identity.

## Surfaces and method

Tested the installed `Burette Production QA` connector through actual tool calls,
the public MCP endpoint directly where widget-only metadata was needed, and the
installed local `Burette` connector for context and a protein summary. Used
reviewed repository molecular samples, public repository files pinned to the
source baseline, and small synthetic chemical strings. No private structures
were uploaded. No credentials or continuation tokens are retained here.

Science routing selected format/chemical-identity checks rather than docking or
MD: those computations would not establish correctness of this plugin's
transport, visualization, editing, or export. An independent subagent inspected
coverage and reproduced edge cases, then implemented the narrow stereo fix.
The primary agent reproduced the critical defect on production and reviewed the
diff. The subagent's simplifier pass was an author pass, not independent approval.

Canonical OCL identity comparisons check this application's conversion behavior;
they do not independently certify OCL's chemistry. Protein coordinate counts were
also checked directly from PDB fixed-column records without the plugin parser.

## Executed evidence

`Live` means an actual connector or public MCP call; `source probe` means imported
production functions at the source baseline. Neither means visual success.

| Scenario | Surface | Observed outcome |
| --- | --- | --- |
| Discover public operations | Live `tools/list` | Exactly five: `open_ketcher`, `control_ketcher`, `preview_molecular_file`, `render_molecular_scene`, `preview_pdb_structure`. No hosted Grid operation. |
| Protein with cofactors, ligands, ions and water | Live attachment `samples/structures/proteins/1htb.pdb` | 5,799 atoms; chains A/B; 748 polymer residues; NAD A/B 377 (44 atoms each), PYZ A/B 378 (6 each); 142 waters; four Zn atoms and one Cl atom. |
| Independent protein count check | Direct PDB record scan | 5,799 coordinate records; 2,776 ATOM records per chain; HETATM totals NAD 88, PYZ 12, HOH 142, ZN 4, CL 1. Agrees with live counts. |
| Local versus public protein summary | Installed local connector | Same composition. Local response additionally supplies ready-to-use ligand selectors. This is not an independent parser implementation. |
| Hide water, select NAD A 377, focus | Live `render_molecular_scene` | Three actions accepted; response explicitly says requested, not applied. Visual action completion was not established. |
| Small mmCIF | Live `samples/mini.cif` | Four atoms, one chain, one residue; elements C2/N1/O1. |
| Molecular crystal CIF | Live `samples/structures/crystals/caffeine.cif` | No coordinate records detected, empty counts, yet `viewerAvailable:true`. Crystal-CIF utility fails this composition check. |
| Multi-record SDF | Live `samples/structures/small-molecules/multi-molecule.sdf` | Two molecules, 27 atoms, 27 bonds. Both blank titles become `RDKit          3D`; no per-record property table is exposed. |
| `.sd` alias | Live HTTP using pinned `samples/mini.sdf` with `file_name:mini.sd` | Empty counts and “No structure parser is available for this extension,” despite advertised SD support and `viewerAvailable:true`. |
| XYZ trajectory | Live `samples/trajectory.xyz` | Two frames, three atoms/frame, six total atoms. Playback/frame selection was not verified. |
| Tetrahedral stereochemistry | Live HTTP `open_ketcher`, inspect `_meta.ketcherSeed` | Input `N[C@@H](C)C(=O)O`; emitted MOL reparses as `CC(C(O)=O)N`, with stereo lost. Model-visible SMILES still contains `@@`. |
| Alkene geometry | Live HTTP seed round trip | Input Z `F/C=C\F`; emitted MOL reparses as E `F/C=C/F`. |
| Isotope/charged salt | Live connector SMILES open and export | `[13CH3][NH3+].[Cl-]` gives three atoms, one bond, two components; SMILES export echoes the exact input. Source seed control preserves isotope and charge. |
| MOL salt components | Live HTTP MOL from `[Na+].[Cl-]` | Two atoms, zero bonds, but `componentCount:1`; actual molecular graph has two fragments. |
| SMILES-to-SDF through the agent | Live `get_structure` | Explicit `EXPORT_FAILED`: relay cannot export SDF from the current SMILES representation. Widget SDF download is a separate, unverified path. |
| Malformed SMILES | Live `C1CC` | Correctly rejected as `INVALID_STRUCTURE`. |
| Chemically invalid valence | Live `C(C)(C)(C)(C)C` | Accepted as ready with six atoms/five bonds. Parsing is not chemical-validity certification. |
| Empty editor | Live empty SMILES | Accepted as empty, with zero atoms/bonds/components. |
| Out-of-range atom | Live highlight index 1000 on three-atom salt | Correctly rejected as `INVALID_ATOM_INDEX`. |
| Stale revision | Live clear at revision 0 against revision 1 | Correctly rejected as `REVISION_CONFLICT`; structure preserved. |
| Edit and idempotent replay | Live change salt to `CCO`, then exact replay | Revision changes to 2 once; replay remains revision 2. |
| Conflicting replay | Live same action ID with `CCN` instead of `CCO` | Correctly rejected as `REPLAY_CONFLICT`. |
| Non-molecular PDB input | Live HTTP pinned public README labelled `invalid.pdb` | No coordinates, empty counts, but successful preview response and `viewerAvailable:true`. |
| Non-molecular SDF input | Same README labelled `invalid.sdf` | Reports one molecule and zero atoms instead of invalid structure. |
| Multi-model ligand identity | Source probe: same LIG A101 in two MODEL blocks | Two indistinguishable ligand entries; returned instances lack model identity. |
| Precise protein selectors | Source schema review | Strict selector has no model, insertion-code or alternate-location field. Cannot uniquely request these cases through the hosted interface. |

## Defects and scope limitations

### P1: stereochemistry changes between agent state and widget

`apps/burette-public-plugin/lib/ketcher-relay.ts`, `hostedKetcherSeed`, parsed
SMILES with `noStereo:true` before inventing coordinates and serializing MOL.
Both the initial card and later actions use this helper. The model can therefore
describe one stereoisomer while the user views or exports another.

Fix: remove that option only in the seed-generation path. Ten regression cases
cover both enantiomers, E/Z geometry, isotope/charged-salt control, through both
initial open and `set_structure`. Each reparses the actual emitted MOL and checks
canonical chemical identity. Previously these paths checked seed shape and atom
counts, which cannot detect stereochemical corruption.

Previously downloaded widget-derived files may already contain altered stereo;
this fix cannot repair them. Where available, regenerate from the original
stereospecific input and verify the downloaded file independently.

### P2: incorrect or insufficient molecular state

Remaining, not fixed in this patch:

- `ketcher-relay.ts`, `structureSummary`: MOL component count is hardcoded to one
  for every nonempty structure, hiding salt/mixture fragments.
- `plugins/burette-agent/mcp/lib/structure-summary.mjs`: dispatcher omits `.sd`;
  SDF record trimming removes an empty title line and exposes the program header
  as the molecule title.
- `apps/burette-public-plugin/lib/structure-service.ts`: recognized extension
  always produces `viewerAvailable:true`, including non-molecular input. This
  flag must not be used as a successful-load acknowledgement.
- `apps/burette-public-plugin/lib/contracts.ts`: protein selection cannot name
  model, insertion code, or alternate location; ambiguous multi-model ligand
  summaries cannot safely drive a unique selection.

The hosted relay documents its limited export conversions and correctly returns
an error for unsupported export. That honesty is good, but the limitation still
blocks the requested agent-driven SMILES→SDF workflow. Likewise, accepting a
syntactically parseable hypervalent carbon is not by itself a parser defect;
the product must not present this as chemistry validation.

## What it helps an agent do

For an ordinary single-model protein PDB, identify chains, cofactors, ligand
instances, water and ions, and compose a targeted viewer request from those
identifiers. For small molecules, maintain explicit revisioned state, replace
the input, export the current SMILES and safely reject stale/conflicting actions.
For SDF/XYZ files, obtain a coarse bounded inventory without flooding context.

This audit does not establish ligand-contact measurements, pocket analysis,
structure repair, protonation, docking, affinity prediction, conformer quality,
or MD analysis. Those require other scientific workflows. Grid/table review is
not exposed by the five-tool hosted plugin; local Burette advertises richer
capabilities but its Grid, trajectory and scene workflows were not exercised
end to end here.

## Verification and unresolved acceptance gates

Focused checks on `MacBookPro.local`:

- Stereo regression before fix: six fail, four pass, 35 assertions.
- Same regression after fix: ten pass, zero fail, 35 assertions.
- Entire `tests/ketcher-relay.test.ts`: 21 pass, 189 assertions.
- `tests/structure-service.test.ts` and `tests/contracts.test.ts`: 31 pass,
  161 assertions. These existing tests pass despite the documented parser gaps.
- `node tests/test-burette-agent-structure-summary.mjs`: passed.
- Public-package TypeScript check and `git diff --check`: passed.

No full repository suite, native build, release build or mobile run was performed.
Passing source tests does not change the observed production failures.

Browser identified the existing Ketcher ChatGPT chats, but AX inspection timed
out after 30 seconds and a separate screenshot attempt timed out after 15
seconds. No new visual proof was obtained. This is an audit blocker, not proof
that either the widget or ChatGPT is at fault. Existing chats:
<https://chatgpt.com/c/6a93ebc1-1228-83ea-a493-cbc60429625f> and
<https://chatgpt.com/c/6a940984-7068-83ea-b995-f7e0a5b713dc>.

Claude Fable second opinion was attempted with `claude-fable-5`; it exited with
an expired OAuth-session error. No Claude review or approval is claimed.

Before accepting the plugin, deploy the corrected seed path and recheck the
live payload; then prove a nonblank initial and edited Ketcher canvas and download
SDF after a manual edit. Reparse that actual download and compare stereo,
isotopes, charge and fragment count with the intended structure. For proteins,
verify the selected atoms/residues and camera result, including a nonexistent
selection that must not silently succeed. Model/insertion-code/altloc cases must
be supported explicitly or rejected as unsupported. Finally, fix and regression-
test `.sd`, invalid-input signalling and blank SDF titles. Until then, handoff for
exploratory use is reasonable; scientific editing/analysis acceptance is not.
