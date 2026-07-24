# One openable file per sidebar icon kind

Every file here is real and opens in Burette. Together they cover all seventeen
kinds `fileKindForPath` can return, so pointing the app at this folder gives
something to open and close while judging the sidebar icons.

They do not all become sidebar rows, and that is a property of the app rather
than of these files. The project scan in `list_project_structure_files`
(`apps/desktop/src-tauri/src/commands/documents.rs`) admits a file only if its
extension is a registered preview format whose strategy is not `text`, and text
files open into a separate `textDocuments` store that the sidebar never reads.
The "row" column below says which side of that line each file falls on.

| File | Kind | Row | Notes |
| --- | --- | --- | --- |
| `receptor.pdb` | protein | yes | Two-residue peptide |
| `crystal.cif` | crystal | yes | Minimal mmCIF with an atom_site loop |
| `ligand.sdf` | molecule | yes | Single small molecule |
| `library.csv` | table | yes | SMILES table, opens in the grid |
| `md-run.lammpstrj` | trajectory | yes | Pairs with `md-run.pdb` by basename, the way a trajectory normally arrives |
| `md-run.pdb` | protein | yes | Topology half of that pair |
| `system.gro` | topology | yes | Solvated GROMACS system |
| `optimization.inp` | calculation | yes | Quantum input deck with coordinates |
| `spectrum.msp` | spectrum | yes | NIST-style mass spectrum |
| `fep-network.edge` | network | yes | FEP edge list |
| `scene.mvsj` | scene | yes | MolViewSpec snapshot, loads `receptor.pdb` beside it |
| `mdrun.log` | log | yes | `.log` is registered as an xyzrender input, so it is scanned |
| `target.fasta` | sequence | no | Registered, but with preview strategy `text` |
| `energy.xvg` | plot | no | Same: `gmx energy` series, text strategy |
| `README.md` | document | no | Not a preview format at all; opens as a tab |
| `analysis.py` | code | no | Not a preview format; reads `energy.xvg` |
| `settings.json` | config | no | Not a preview format; `.xml` is the one config extension that is |
| `measurements.dat` | default | no | Deliberately an extension the app has no opinion about, so it does not open |

This folder lives outside `samples/` on purpose: `tests/test-preview-format-matrix.mjs`
requires every file under `samples/` to have an extension registered in
`config/preview-formats.json`, and several kinds here are plain text formats
that are not preview formats.

Browser dev shows fewer rows than the native app: the `/__burette/dev-files`
route filters harder than the Rust scan does. Open the folder in the packaged
app to see `mdrun.log` and `fep-network.edge` listed too.
