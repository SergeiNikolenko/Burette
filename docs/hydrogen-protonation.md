# Hydrogens and pH protonation

Burette's browser chemistry changes real atoms when it adds, removes or
re-protonates hydrogens. Hiding H in the viewer is a display setting: it does not
change the graph, the formula, the charge or the saved file, and it is not
protonation.

| Operation | Worker action | Core |
| --- | --- | --- |
| Add Hydrogens | `add-hydrogens` | `addHydrogens` in `apps/desktop/src/lib/molecular-workbench/chemistry.ts`, geometry in `hydrogen-geometry.ts` |
| Remove Hydrogens | `remove-hydrogens` (Edit tab: `delete-atoms` of every H) | `removeHydrogens` in `chemistry.ts` |
| Adjust hydrogens for pH | `protonate` with `pH` | `adjustHydrogensForPh` in `chemistry.ts`, rules in `protonation.ts` |

All three need an explicit MOL/SDF graph (bond orders and charges) and keep the
browser chemistry limit of 256 atoms, counted after H expansion.

## Add and Remove Hydrogens

Add Hydrogens fills every implicit valence with explicit H. Existing atoms,
coordinates, bonds, charges, isotopes, atom IDs and specified stereo are kept;
new H are appended. Directions come from RDKit's 3D placement in the source
frame, except:

- two opposite bonds (no bisector) use the source component's orientation;
- an sp3 atom with two neighbours receiving two H places the pair mirror-symmetric
  about the neighbours' plane, with H–X–H equal to both H–X–Y angles
  (cos HXH = −cos(HXH/2)·cos(YXY/2)). That is tetrahedral for a 109.5° Y–X–Y
  angle and 116.9° in cyclopropane (measured 114.5–116°). RDKit placed the second
  H opposite the first, giving cyclopropane H–C–H 90° with one H at 120° and the
  other at 135° to the ring carbons.

Remove Hydrogens deletes every hydrogen atom, including D and T (as Avogadro
does; RDKit `RemoveHs` keeps isotopic H). Charges and stereo of the heavy atoms
remain; their H become implicit again.

## Adjust hydrogens for pH

Avogadro's *Add Hydrogens for pH* delegates to Open Babel's `phmodel.txt`
(GPL-2). Burette does not use that file or any Open Babel code. Its own table
below uses measured aqueous pKa values at 25 °C of each group's parent compound.

The operation:

1. finds every site of the groups below, in either charge state;
2. sets each site to its majority state at the pH, by its own pKa: a site is
   protonated if pH < pKa, otherwise deprotonated. A polyprotic P or S centre
   loses one acidic O–H per pKa step below the pH;
3. removes the explicit H of each deprotonated site (or lets an implicit H go
   with the charge change) and then adds every remaining implicit H, as Add
   Hydrogens does. The result has all H explicit; existing atoms do not move.

The result reports `sourceAtomIndices` (input index of each output atom, −1 for
new H) and up to 64 changes (output atom, group, pKa crossed, protonated or
deprotonated), with the count of omitted changes. Running it again at the same
pH changes nothing.

In the Edit tab, More actions → *Adjust hydrogens for pH…* asks for a pH from 0
to 14 (default 7.4) and applies the result as one Undo step of the document's
graph draft (graph-draft operation `{ kind: "protonate", pH }`); the selection is
cleared because atoms are renumbered. Agents run the same operation as the
`hydrogens` job with `mode: "ph"` and `pH` (see
[agent-platform.md](agent-platform.md#structure-editing-and-builder-jobs)), which
exports a new structure and never edits the open document. Focused tests:
`bun run test:protonation` (rule table, references, Edit-tab draft and dialog).

Charges of the modelled groups are re-assigned, whichever state the input had:
carboxylate at pH 2 becomes the acid, ammonium at pH 12 the amine. Quaternary
ammonium, N-alkyl pyridinium, nitro, N-oxide, metal and other charges are kept.

### Rule table

| Group | Site | pKa | Parent compound and source |
| --- | --- | --- | --- |
| carboxylic acid | O of C(=O)OH; C bears C or H | 4.76 | acetic acid; CRC Handbook of Chemistry and Physics (Dissociation constants of organic acids and bases) |
| sulfonic acid / sulfate monoester | O–H on S(=O)2 | −1.9 | methanesulfonic acid; Guthrie, Can. J. Chem. 1978, 56, 2342 |
| sulfuric acid | two O–H on S(=O)2 | −3, 1.99 | CRC (inorganic acids) |
| phosphoric acid | three O–H on P=O | 2.16, 7.21, 12.32 | CRC (inorganic acids) |
| phosphate monoester (incl. terminal polyphosphate) | two O–H, one P–O–R | 1.54, 6.31 | methyl phosphate; Kumler and Eiler, J. Am. Chem. Soc. 1943, 65, 2355 |
| phosphate diester | one O–H, two P–O–R | 1.29 | dimethyl phosphate; Kumler and Eiler 1943 |
| phosphonic acid | two O–H, one P–C | 2.38, 7.74 | methylphosphonic acid; Crofts and Kosolapoff, J. Am. Chem. Soc. 1953, 75, 3379 |
| phosphinic acid | one O–H, two P–C | 3.08 | dimethylphosphinic acid; Crofts and Kosolapoff 1953 |
| tetrazole | ring N–H of a CN4 aromatic ring | 4.90 | 1H-tetrazole; CRC |
| phenol | O–H on a benzenoid carbon | 9.99 | phenol; CRC |
| aliphatic thiol | S–H on sp3 C | 10.61 | ethanethiol; CRC |
| aromatic thiol | S–H on a benzenoid carbon | 6.62 | benzenethiol; CRC |
| ammonia / primary / secondary / tertiary amine | sp3 N bonded only to sp3 C and H | 9.25 / 10.66 / 10.73 / 9.80 | ammonia, methyl-, dimethyl-, trimethylamine; Perrin, Dissociation Constants of Organic Bases in Aqueous Solution (IUPAC, 1965) |
| aniline | sp3 N on one benzenoid carbon | 4.60 | aniline; Perrin 1965 |
| pyridine | ring N in a 6-ring with no other ring heteroatom | 5.23 | pyridine; Perrin 1965 |
| imidazole | pyridine-type N of a 1,3-diazole (benzo-fusion allowed) | 6.99 | imidazole; Perrin 1965 |
| amidine | imine N of C(=N)N; imine N bears only C or H | 12.4 | acetamidine; Perrin 1965 |
| guanidine | imine N of C(=N)(N)N | 13.6 | guanidine; Perrin 1965 |

Compilations differ by up to about 0.05 in the last digit; that changes no state
at pH 2, 7.4 or 12. Methylphosphonic acid pKa2 (7.74) is close to 7.4 and its
literature spread includes values below 7.4.

### Limits

- Each site uses its parent compound's pKa. Substituent effects are not modelled
  (4-nitrophenol stays neutral at 7.4; betaine's carboxylate is protonated at
  pH 2 by the 4.76 value although its own pKa is 1.8).
- Sites are independent. Coupled sites keep their own pKa: piperazine is a
  dication at pH 7.4 (real pKa2 5.35), and ciprofloxacin's N-aryl piperazine N is
  protonated at pH 2. The second protonation of biguanides (metformin pKa2 ≈ 2.8)
  is not modelled.
- No microstate or tautomer enumeration: the output is one structure, the
  majority state of each site. Hydroxy- and amino-heteroaromatics (pyridones,
  aminopyridines, purines) are not sites; 6-ring diazines, pyrazoles, oxazoles,
  thiazoles and triazoles are not protonated.
- Not covered: sulfonamides, imides, hydroxamic acids, sulfinic acids, carbon
  acids, enols, and N or O bases with pKa outside the table.

### Independent references

`tests/test-protonation.test.ts` runs the 44-molecule panel of
`tests/fixtures/protonation/` (amino acids, drugs, all groups above, permanent
charges and non-sites) at pH 2, 7.4 and 12 against Open Babel 3.1.1
(`obabel -p`) and Dimorphite-DL 2.1.0. Burette agrees with Dimorphite-DL in 126
of 132 cases and with Open Babel in 105; every difference has a reviewed reason
in `tests/fixtures/protonation/disagreements.json` and the fixture README, and
the test fails if the set of differences changes. The same test checks heavy-atom
coordinates, explicit and implicit H inputs, X–H lengths and H angles.
`tests/test-hydrogen-references.test.ts` compares Add/Remove Hydrogens with RDKit
`AddHs`/`RemoveHs` and published X–H geometry.

```bash
bun test tests/test-protonation.test.ts tests/test-hydrogen-references.test.ts
bunx tsc --noEmit -p tests/tsconfig.protonation.json
```
