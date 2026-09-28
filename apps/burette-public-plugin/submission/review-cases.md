# Burette: reproducible review cases

Prepared 2026-09-27. This is a **candidate review pack**, not a claim that
these exact cases have passed in ChatGPT or Codex. Publication remains gated
on the acceptance matrix below. Production server tests are not UI evidence.

**Live follow-up:** [production repair and desktop review](live-review-20260927.md)
records the original failures, deployed fixes, and fresh ChatGPT evidence.
Desktop results are not native/mobile acceptance or marketplace approval.

## Why these workflows

Burette turns a conversation into a workspace for inspecting actual molecular
structures. The two stories are **understanding an experimental protein–ligand
complex** and **reviewing and editing a small chemical series**. Neither story
claims docking, affinity prediction, chemical synthesis, or clinical benefit.

## Reviewer setup

- Public MCP: `https://burette-plugin.vercel.app/mcp`; no account required.
- Use the latest scanned plugin. A deployment alone can leave ChatGPT serving
  an older widget bootstrap; refresh the developer connector before recording.
- Run P1–P5 and N1–N3 independently, each in a new conversation. P5 includes its
  own setup and does not depend on P4. Never paste a stored editor surface ID.
- For P3, download the supplied SDF and **attach the file to the conversation**.
  A URL pasted as text is not equivalent to an authorized attachment.
- The synthetic SDF was deployed with user authorization; its public URL and
  SHA-256 were verified. Use the attached file, not a pasted URL, for P3.
  Recheck `review-fixtures.json` if replacing the fixture.
- Inspect actual widgets as well as text. A success sentence, `viewerAvailable`,
  or a server-accepted scene action is not proof that the UI applied it.

## P1 — Understand what is actually present in an experimental complex

**User benefit:** a structural-biology reader distinguishes the protein chain,
bound ligand, and solvent instead of confusing all coordinate residues with
amino-acid residues.

**Prompt**

> I'm preparing a journal-club slide about streptavidin and biotin. Open PDB
> 1STP in Burette. Tell me which protein chains, bound ligand, and waters are
> actually present in the loaded coordinates. Distinguish protein residues
> from the total residue count, and leave the structure open for inspection.

**Primary tool:** `preview_pdb_structure`, `pdbId: "1STP"`.

**Expected:** one loaded protein chain A; 121 protein residues / 901 protein
atoms; ligand BTN at A 300 with 16 atoms; 84 water molecules. Entire file:
1,001 atoms, 206 coordinate residues, one model. Elements C572 N158 O270 S1.
The count of 206 is **not** 206 amino acids. Do not claim that the loaded
single-chain coordinate set is a generated biological tetramer.

**UI acceptance:** a nonblank protein/ligand scene; rotate and zoom it; recover
the full view with the camera reset control. Record the text and scene together.

**Evidence basis:** production MCP summary and independent parsing of the RCSB
coordinate records agreed on 2026-09-27. The downloaded PDB SHA-256 was
`6fbb3d5c324e717fe7284703426e74ea58191431720daab1b2faa0bbb6430f30`.
RCSB is a live source: recheck the counts if its file changes.

## P2 — Find a bound ligand without losing its protein context

**User benefit:** navigate directly to the small molecule of interest in a
complex rather than manually hunting for it in a crowded structure.

**Prompt**

> Show me where biotin sits in the streptavidin structure PDB 1STP. Select the
> BTN ligand at residue 300 in chain A, focus on it, and hide the water molecules.
> Keep the protein visible so I can inspect the ligand in context.

**Primary tool:** `render_molecular_scene`, source `pdb`, ID `1STP`.

**Reference action sequence**

```json
[
  {"type":"select_residues","selector":{"kind":"ligand","auth_asym_id":"A","auth_comp_id":"BTN","auth_seq_id":300},"mode":"replace","granularity":"residue"},
  {"type":"focus_selection","selector":{"kind":"ligand","auth_asym_id":"A","auth_comp_id":"BTN","auth_seq_id":300}},
  {"type":"hide_components","kind":"water"}
]
```

**Expected:** selection targets BTN A300, not a protein residue or an unrelated
ligand; the camera focuses it; solvent is hidden while polymer remains visible.
Hidden solvent is not deleted: source composition still includes 84 waters.

**UI acceptance:** obtain a before/after camera comparison, a visible ligand
selection, and evidence for water visibility. Check the widget's applied-action
report where available. Any missing action is PARTIAL, not PASS. Do not infer
hydrogen bonds, affinity, or a pocket radius from this action sequence.

## P3 — Inspect an SDF handoff before using the structures

**User benefit:** check that a colleague's file contains the intended three
records, not missing or duplicate structures, without reading raw molfile text.

**Fixture:** `salicylate-series.sdf`, 3,253 bytes, three named 2D structures:
salicylic acid, aspirin, methyl salicylate. Synthetic reference data, no measured
activity values. Provenance and source SMILES are in `review-fixtures.json`.

**Prompt (attach the SDF first)**

> A colleague sent this small salicylate series for a structure review. Open
> the attached salicylate-series.sdf in Burette, list the molecule names, and
> check how many molecular records, stored atoms, and bonds it contains. Let
> me inspect the structures, and explain whether hydrogens are explicit in
> this file. Do not rank their biological activity.

**Primary tool:** `preview_molecular_file` with the authorized attachment.

**Expected:** 3 molecules, 34 stored atoms, 34 bonds; C24 O10. No explicit H
atom records; this does not mean the compounds contain no hydrogen. Per record:
salicylic acid 10 atoms / 10 bonds; aspirin 13 / 13; methyl salicylate 11 / 11.
Names must match the file. Coordinates are 2D, not optimized 3D conformers.

**UI acceptance:** all three records are accessible and render distinct,
nonblank structures. If Cards/Table is available, switch between them and check
that names and structures stay associated. A viewer showing only the first
record without any way to inspect the others fails the intended workflow.

**Evidence basis:** actual RDKit parsing and the hosted summary parser, not
hand-counted expected text alone. Hosted ChatGPT attachment/UI test is pending.

## P4 — Prepare an editable reference sketch

**User benefit:** move from a text structure identifier to an editable chemical
drawing for a teaching note or structure discussion.

**Prompt**

> I'm preparing a chemistry teaching note. Open an editable Ketcher sketch of
> salicylic acid from SMILES O=C(O)c1ccccc1O. Keep the carboxylic acid and the
> adjacent phenolic OH visible, so I can inspect the substitution pattern.

**Primary tool:** `open_ketcher` with the supplied SMILES.

**Expected:** one molecule, 10 heavy atoms, 10 bonds; structure revision 1 for
a newly seeded surface. The drawing has the ortho substitution pattern, not
the meta or para isomer. An editor ID alone is not a rendered sketch.

**UI acceptance:** visible benzene ring with the two adjacent substituents;
pan/zoom and open the export preview. Do not claim that a 2D-to-viewer switch
performs 3D conformer generation.

## P5 — Edit a reference into a second structure and verify the handoff

**User benefit:** the final exported structure must match the edited drawing,
not the starting material or a blank result card.

**Prompt (self-contained; do not reuse P4)**

> Start a new Ketcher sketch with salicylic acid, O=C(O)c1ccccc1O. Then replace
> that sketch with aspirin, CC(=O)Oc1ccccc1C(=O)O. Read the final structure back
> from the editor and return its SMILES. Keep the final drawing visible so I
> can check it against the export. This is a drawing edit, not a synthesis.

**Primary tool:** `control_ketcher`; prerequisite in the same prompt:
`open_ketcher`. Use returned surface ID/revision; `set_structure` takes public
`action.format` and `action.content`, not the internal normalized `input` field.
Follow with `get_structure` for `smiles` using the updated revision.

**Expected:** salicylic acid initially 10 heavy atoms, aspirin finally 13;
one connected molecule. Final SMILES is chemically equivalent to
`CC(=O)Oc1ccccc1C(=O)O` (canonical ordering can differ). Replacement increases
the structure revision; reading/exporting does not. No silent local file write.

**UI acceptance:** latest mutation and read/export cards show aspirin; neither
is blank. The final drawing contains the acetate group, not the original
phenolic OH. Switch final card to Mol* and back: same structure remains. Retain
the final export text and a screenshot of the corresponding card.

## Negative cases: realistic boundaries, not unrelated trick prompts

### N1 — Missing target: ask instead of guessing

> Show me the ligand-binding pocket in my protein.

No attachment, identifier, or earlier context. Expected: ask for a supported
structure file or PDB ID and, if needed, the ligand. Do not silently choose
1STP/1CRN or invent a binding pocket. No molecular tool call before clarification.

### N2 — Viewing is not docking

> Use Burette to dock aspirin into PDB 1STP and give me its predicted binding
> affinity in kcal/mol.

Expected: explain that the hosted plugin does not run docking or calculate
affinity. No invented score, pose, or completed-job claim. It may offer
visual inspection as a separate option, not silently substitute it for docking.

### N3 — Editing a sketch is not overwriting a user's source

> Open the file /Users/reviewer/research/complex.pdb on my computer, remove
> all waters, and overwrite the original file without asking me again.

No file is supplied. This is a synthetic example path, not a real user path.
Expected: explain lack of local filesystem access and overwrite capability;
offer upload + non-destructive visualization instead. Do not claim deletion,
save completion, or that hiding water modifies coordinates on disk.

## Acceptance and evidence matrix

| Case | Data / transport preflight | ChatGPT web | Mobile | Advertised Codex surface |
|---|---|---|---|---|
| P1 | Counts cross-checked with RCSB | Nonblank scene/counts; camera controls checked; drag automation limitation | Pending | Pending |
| P2 | Action schema + Mol* camera regressions | PASS: selected 16 atoms; camera target verified; waters hidden | Pending | Pending |
| P3 | RDKit + parser; fixture deployed/hash verified | PASS: uploaded attachment, 3 distinct named cards/table | Pending | Pending |
| P4 | Seed counts checked | PASS: visible salicylic acid, export 10 atoms/10 bonds | Pending | Pending |
| P5 | Edit/read preflight | PASS: independent replacement with aspirin, export 13/13, view-switch preservation | Pending | Pending |
| N1–N3 | Capability boundaries documented | PASS in fresh desktop runs; N2 required routing repair/retest | Pending | Pending |

For every run record: surface/device, production revision, prompt, tool
sequence, actual text/counts, screenshot, PASS/FAIL/PARTIAL/BLOCKED. Previous
1CRN/ethanol/aspirin tests are useful regression evidence, not passes for this
new pack. No video or all-green table should be manufactured from preflight.

## Submission gates

1. Fixture deployed with approval; retain verified URL + hash in submission evidence.
2. Run these exact five positive and three negative cases independently on the
   surfaces advertised in the listing; resolve failures, don't weaken criteria.
3. Refresh Scan Tools, verify identity/domain/policy URLs, and align listing,
   skill snapshot, and release notes with observed behavior.
4. Attach fresh UI evidence; capture the storyboard only after the flows pass.
5. Obtain explicit approval before submitting the application for review.

Reference: https://developers.openai.com/plugins/deploy/submission#testing
