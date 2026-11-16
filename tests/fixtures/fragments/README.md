# Fragment insertion references

Independent inputs for `tests/test-fragment-insertion.test.ts` and
`tests/test-graph-draft-fragment.test.tsx`. None of these files is read by the app.

- `benzene-cid241.sdf`, `ethanol-cid702.sdf`, `isobutane-cid6360.sdf`: PubChem
  3D conformer records (public domain), downloaded unchanged on 2026-11-01 from
  `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/<CID>/record/SDF?record_type=3d`.
  SHA-256: benzene `4b66ab0b…6b6ea`, ethanol `09a3bcd1…f907d`, isobutane `adf459f0…d1d`.
- `groups.smi`: the upstream `groups/*/groups.smi` lists of OpenChemistry/fragments
  `7d842f435aec4729a308b23ad7f9501bdd44aa02` (BSD-3-Clause), one line per entry,
  prefixed with the category directory: `category SMILES name`. The attachment point is
  the first atom (or a leading `*`), the upstream convention.
- `reviewed-names.smi`: groups that the pinned list omits. `phosphine_oxide.cjson`
  has no entry; its reviewed SMILES is the dimethylphosphinoyl group `P(=O)(C)C`.

Bond-length references are the mean values of Allen et al., "Tables of bond lengths
determined by X-ray and neutron diffraction", J. Chem. Soc. Perkin Trans. 2 1987, S1–S19:
C(ar)–C(sp3) 1.513 Å and the biphenyl inter-ring C(ar)–C(ar) 1.487 Å.
