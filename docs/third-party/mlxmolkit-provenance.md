# mlxmolkit Provenance and Adaptation Ledger

Status: active provenance ledger for the independently implemented, adapted,
and mechanically generated native compute layer.

## Primary source

- Author: Guillaume Osmo
- Repository: <https://github.com/guillaume-osmo/mlxmolkit>
- Pinned audit commit: `9e7337f6f93c40a39ad0187991151944a4f1e274`
- Commit date: 2026-07-08
- Package metadata: `mlxmolkit-rdkit` 0.4.0, declared MIT in
  `pyproject.toml`
- Repository license file at the pinned commit: absent

The Burette project owner recorded direct permission from Guillaume to copy and
adapt useful code and algorithmic logic on 2026-07-15. The release manager must
archive the written permission and add its internal evidence identifier here
before any adapted source ships. This repository document deliberately does not
invent or expose private correspondence.

## Secondary provenance

The pinned tree explicitly describes derived, ported, translated, or parameter
material from additional sources. Every candidate file requires its own audit;
the primary author's permission does not replace these obligations.

| Secondary source | Upstream-declared basis | Affected areas |
| --- | --- | --- |
| NVIDIA nvMolKit | Apache-2.0 | DG/ETK workflow and gradients, MMFF energy/minimizers, clustering architecture |
| Shivam Patel `mlxmolkit` | MIT, copyright notice required | In-kernel MMFF/BFGS paths |
| LANL/Triad PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | BSD-3-Clause; authoritative license archived | NDDO nuclear, overlap, integral, rotation, Fock, energy, and d-orbital equations adapted and mapped below |
| OpenMOPAC `052691223d19935a89f0fe18cd12301bd83e4201` | Apache-2.0; authoritative license archived | RM1, AM1, PM3, PM6, PM6_SP, AM1*, D3, H4, and HH parameter/equation sources are mapped below |

No source or data from these areas may be adapted until the authoritative
license text, copyright notice, exact source revision, and file mapping are
recorded.

## Candidate inventory

`reference-only` means the file is retained only as an oracle and is not a
production dependency. `independent implementation shipped` means Burette
implements the useful behavior behind its own bounded native contract.
`excluded` records why upstream source is intentionally absent.

| Upstream path | Candidate use | Status | Known issue to correct |
| --- | --- | --- | --- |
| `mlxmolkit/fp_uint32.py` | Fingerprint packing | reference-only; independent Burette ABI shipped | Canonical little-endian `u64[32]` persistence and explicit `u32[64]` Metal view |
| `mlxmolkit/fused_tanimoto_nlist.py` | Fused Tanimoto and CSR | reference-only; independent Burette implementation shipped | Exact rational cutoff, checked edge/offset widths, no full pair matrix |
| `mlxmolkit/tanimoto_blockwise.py` | 100k+ tiling | reference-only; independent Burette planner shipped | Checked request limits and bounded adaptive tiles; 100k exact query and sparse CSR benchmarks pass on Apple M2 Pro |
| `mlxmolkit/butina.py` | Butina semantics | reference-only; independent Burette policy shipped | Versioned deterministic live-neighbor tie-breaking and 100k sparse-graph proof |
| `mlxmolkit/morgan_cpu.py` | Morgan oracle | excluded in favor of pinned native RDKit worker | Fingerprint chemistry stays on RDKit CPU; similarity graph/query execution is Metal |
| `mlxmolkit/shared_batch.py` | Shared `N x K` constraints | reference-only; independent Burette scheduler and EnginePack ABI shipped | Burette constraints are stored once per molecule; seeds are identity-derived and chunk-invariant |
| `mlxmolkit/dg_extract.py` | DG bounds/parameters | reference-only; native RDKit adapter shipped | Production extraction calls pinned RDKit directly and emits the bounded BCEX ABI |
| `mlxmolkit/etk_extract.py` | ETK torsions/constraints | reference-only; native RDKit adapter shipped | All eight variant presets are selected from pinned RDKit C++ constants |
| `mlxmolkit/conformer_metal.py` | DG Metal logic | reference-only; independent deterministic Metal implementation shipped | Upstream schedule-dependent RNG was replaced by immutable identity-derived seeds |
| `mlxmolkit/etk_energy_metal.py` | ETK objective reference | formula-only reference; independent CPU/Metal objective shipped | All eight requested variants pass the packaged extractor and real-Metal corpus |
| `mlxmolkit/etk_minimize_metal.py` | ETK minimizer reference | formula-only reference; independent bounded CPU/Metal optimizer shipped | Explicit convergence states, retries, and memory accounting replace upstream ambiguity |
| `mlxmolkit/etk_metal.py` | ETK workflow orchestration | reference-only; independent Burette workflow shipped | Stereo-aware retry and all eight variant identities pass the pinned packaged-extractor/Metal corpus |
| `mlxmolkit/stereo_checks.py` | Stereo validation oracle | reference-only; independent CPU validator shipped | Atom mapping is preserved and failures are explicit retry/status bits |
| `mlxmolkit/stereo_checks_metal.py` | Stereo Metal candidate | excluded; independent bounded Metal validator shipped | Avoids copying the candidate and requires CPU parity before publication |
| `mlxmolkit/mmff_params.py` | MMFF parameter pack | reference-only; native RDKit BMFX adapter shipped | Exact RDKit identity and MMFF94/MMFF94s method identity are hash-bound |
| `mlxmolkit/mmff_energy_native.py` | Seven MMFF terms | formula-only reference; independent CPU energy oracle and analytic Metal gradient shipped | The 24-case pinned RDKit CPU/Metal corpus passes |
| `mlxmolkit/mmff_minimize.py` | Optimizer orchestration | reference-only; independent per-molecule optimizer policy shipped | BFGS/L-BFGS choice, retry, and convergence states are explicit |
| `mlxmolkit/mmff_bfgs_source_tg.metal` | BFGS Metal candidate | excluded; independent fused Metal optimizer shipped | Avoids unresolved Shivam/nvMolKit source provenance while preserving the useful algorithm |
| `mlxmolkit/mmff_lbfgs_source_tg.metal` | L-BFGS Metal candidate | excluded; independent fused Metal optimizer shipped | Uses bounded per-molecule history and unified-memory admission |
| selected `mlxmolkit/cheese.py` functions | Horn/RMSD/shape/ESP formulas | reference-only; independent bounded CPU/Metal implementation shipped | Burette requires explicit graph mapping and avoids a full pair tensor |
| `mlxmolkit/rm1/**` | Semiempirical oracle and formulas | mixed reference/adapted sources mapped below | Secondary PYSEQM/OpenMOPAC provenance is preserved per file; full-d PM6 and correction dispatch pass on Metal |
| `mlxmolkit/rm1/_pyseqm_port/**` | PYSEQM numerical oracle | reference-only | BSD-3 mechanical translation; do not treat as Guillaume-only code |
| `mlxmolkit/rm1/data/**` | Parameter/reference data | reference-only | Exact PYSEQM/OpenMOPAC source and redistribution terms required; do not use as the production data source |

Duplicate or superseded pipelines, Python package/CLI code, examples, training
experiments, learned models, caches, `.dylib`, `.metallib`, and benchmark output
are excluded from the production source tree.

The 2026-07-16 conformer audit re-opened the pinned commit and confirmed that
`shared_batch.py` uses one process-wide NumPy RNG seed, while `dg_extract.py`
advances a shared RNG as conformers are traversed. That behavior is not safe
under adaptive rebatching. Burette therefore implemented its seed identity and
batch planner independently: the seed domain includes immutable job ID, source
record ID, molecule-content hash, exact variant, conformer ordinal, and retry
ordinal. No upstream conformer code was copied in that increment.

The `conformer.engine-pack.v1` topology and constraint ABI was also designed
independently. It does not translate the blocked DG/ETK extractor or Metal
sources. The ABI is a Burette-owned production boundary that can be populated
by an audited native extractor and compared with separately executed reference
oracles without making Python or MLX part of the application runtime.

The counter-based `conformer_initialize.v1` Rust/Metal primitive was written
independently from the immutable Burette seed contract. No RNG, coordinate
initialization, DG, or Metal source was copied or translated from `mlxmolkit`.
The paired distance-bound objective and analytic-gradient Rust/Metal primitive
was likewise implemented independently from a mathematical contract; no
upstream DG implementation was copied or translated. A 2026-07-16 parity audit
against pinned `mlxmolkit/conformer_metal.py` found that Burette's first simple
quadratic squared-bound penalty was scientifically incompatible. Burette now
uses the same normalized upper-bound and rational lower-bound equations as the
reference, with an independently structured gather implementation, explicit
known answers, finite-difference validation, and CPU/Metal parity. This is a
formula-only reference: upstream source text is not present in Burette, and the
named nvMolKit secondary revision remains a release gate before DG adaptation.
The paired bounded L-BFGS CPU oracle and fused Metal optimizer were also written
independently against that formula-only behavioral reference. The Metal kernel
uses a Burette-owned fixed threadgroup ABI, atom-gather reduction, bounded
history, and explicit convergence statuses; no upstream optimizer source text
was copied or mechanically translated.

The conformer admission and queued-job increment was also independently
implemented. It adds a frozen-molecule-identity-bound chemistry-preflight
memory envelope, independent
backend decisions for distance geometry and stereo validation, canonical
durable snapshot construction, and capability-rooted frozen-source binding.
It does not copy upstream planning, packaging, or execution code.

The native conformer extractor under `compute/rdkit-conformer` is likewise a
Burette-owned adapter rather than a translation of the Python extractors. It is
version-locked to official RDKit `Release_2025_03_4` commit
`276b5a662302c6a548ac4f1363c066f3258e3a20`, calls RDKit's own variant presets,
bounds construction and smoothing, CrystalFF terms, and embedding chirality
helpers, and emits a bounded little-endian binary ABI. The separately cloned
`mlxmolkit` files remain parity oracles. The independently written adapter is
now a hash-locked runtime artifact built from that exact official RDKit commit;
it contains no `mlxmolkit` source. Scientific fixture breadth and the recorded
permission evidence identifier remain release gates.

The same audit confirmed that the pinned repository still has no root license
or notice file, `dg_extract.py` names nvMolKit as its reference, and
`etk_metal.py` describes helper code as unchanged from Shivam Patel's work.
Those DG/ETK files remain blocked from adaptation until the exact secondary
revisions and required Apache-2.0/MIT notices are recorded.

The ETK objective and optimizer increment follows the same formula-only rule.
The CPU evaluator and Metal kernel independently implement Fourier torsions,
improper-angle penalties, and flat-bottom distance terms extracted through the
pinned RDKit adapter. The existing Burette bounded L-BFGS contract was reused
for CPU and Metal refinement; no upstream Python or Metal source text was
copied. The pinned `mlxmolkit/etk_energy_metal.py` and
`mlxmolkit/etk_minimize_metal.py` files are numerical behavior references only.

The native semiempirical layer defines all seven requested method identities
plus the explicit PM6_D3H4 corrected composition.
RM1 has a bounded restricted closed-shell evaluator with deterministic
symmetric diagonalization, DIIS, adaptive density damping, the complete
ten-element upstream parameter domain, NDDO pair contractions, qn1-5 overlap,
energies, and population charges. AM1, PM3, and PM6_SP cover their complete
pinned 11-, 25-, and 10-element upstream domains; AM1* retains its published
CHNO domain. All use the same native evaluator and are exposed through a persistent
Grid method selector. Full PM6 and its PM6_D alias use the complete 40-element
variable 1/4/9-orbital basis and are exposed through the same Grid contract. Runtime v20
executes local-integral generation, pair
rotation/materialization, two-center Fock contraction, and bounded symmetric
eigensolves on Metal with CPU parity gates and adaptive float64 polishing.
PM6_D3H4 composes the density-independent full Z=1--94 D3, H4, and HH
corrections after SCF and verifies every Metal result against the float64 CPU
oracle before reporting GPU execution.

## Burette adaptation ledger

This table is mandatory for every adapted, translated, or formula-referenced
file. The entries below record mathematical parity references; the existing
compute protocol, CPU clustering reference, Tanimoto Metal contract, and
deterministic conformer scheduler remain independently implemented and do not
copy `mlxmolkit` source.

| Burette path | Upstream path | Commit | Contribution | Secondary source/license | Validation |
| --- | --- | --- | --- | --- | --- |
| `crates/burette-compute-core/src/distance_geometry.rs` | `mlxmolkit/conformer_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only objective reference; independently implemented CPU oracle | nvMolKit is named by upstream; no nvMolKit source or data was copied | upper/lower known answers and finite-difference gradient |
| `compute/metal/conformer-distance.v1.metal` | `mlxmolkit/conformer_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only objective reference; independent atom-gather Metal kernel | nvMolKit is named by upstream; no nvMolKit source or data was copied | CPU/Metal parity and packaged startup KAT on Apple M2 Pro |
| `crates/burette-compute-core/src/distance_optimizer.rs` | `mlxmolkit/conformer_metal.py`, `mlxmolkit/etk_minimize_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only L-BFGS behavioral reference; independently structured bounded CPU oracle shared by DG and ETK objectives | upstream names nvMolKit/Shivam Patel; their implementation source was excluded | deterministic convergence, no-op satisfied case, bounded line-search exhaustion, ETK objective reduction |
| `compute/metal/conformer-optimize.v1.metal` | `mlxmolkit/conformer_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only L-BFGS behavioral reference; independent fused atom-gather Metal optimizer | nvMolKit is named by upstream; no nvMolKit source or data was copied | CPU/Metal startup parity and packaged KAT on Apple M2 Pro |
| `crates/burette-compute-core/src/etk_geometry.rs` | `mlxmolkit/etk_energy_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only ETK objective reference; independent CPU evaluator and analytic gradients | upstream names nvMolKit/Shivam Patel; their implementation source was excluded | deterministic known answers and finite-difference gradients |
| `compute/metal/conformer-etk.v1.metal` | `mlxmolkit/etk_energy_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only ETK objective reference; independent atom-gather Metal evaluator | upstream names nvMolKit/Shivam Patel; their implementation source was excluded | CPU/Metal energy and gradient startup KAT on Apple M2 Pro |
| `compute/metal/conformer-etk-optimize.v1.metal` | `mlxmolkit/etk_minimize_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only minimizer reference; Burette bounded L-BFGS structure adapted to the ETK objective | upstream names nvMolKit/Shivam Patel; their implementation source was excluded | packaged optimizer KAT and real executor smoke on Apple M2 Pro |
| `compute/rdkit-conformer/conformer_extractor.cpp`, `fixtures/conformer-rdkit-2025.03.4.json` | `mlxmolkit/dg_extract.py`, `mlxmolkit/etk_extract.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | parity reference only; independent adapter over official RDKit C++ APIs; packaged BCEX v1 payloads are frozen for runtime corpus validation | RDKit `276b5a662302c6a548ac4f1363c066f3258e3a20`, BSD-3-Clause; fixture SHA-256 `f59bd868eeb36546959804800f6edc57e00e06cccbe19947b199ffc52674ecec` | binary ABI tests plus 32-case all-variant packaged-extractor and real-v20-Metal execution corpus on Apple M2 Pro; exact upstream coordinate-stream identity is excluded because Burette intentionally replaces schedule-dependent RNG |
| `crates/burette-compute-core/src/mmff.rs` | `mlxmolkit/mmff_energy_native.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only behavioral reference; independently implemented seven-term CPU energy oracle and bounded numerical reference gradient | Halgren MMFF publications; upstream names nvMolKit but no nvMolKit source was copied | seven-term known answer, equilibrium, validation, translation invariance, and 24-case pinned RDKit energy/optimizer parity pass |
| `compute/metal/mmff-energy.v1.metal` | `mlxmolkit/mmff_energy_native.py`, `mlxmolkit/mmff_optimize.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only behavioral reference; independently implemented batched seven-term Metal evaluator, local forward-mode analytic gradient, and fused automatic BFGS/L-BFGS optimizer | Halgren MMFF publications; no upstream or nvMolKit source copied | v20 package-bound CPU/Metal startup KAT covers every term and matches the float64 central-difference gradient within `0.005 kcal/(mol angstrom)`; fused BFGS reaches the bond minimum on Apple M2 Pro |
| `compute/rdkit-conformer/mmff_extractor.cpp`, `mmff_binary.cpp`, `fixtures/mmff-rdkit-2025.03.4.json` | `mlxmolkit/mmff_params.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | parity reference only; independent adapter over official pinned RDKit C++ MMFF APIs and Burette-owned BMFX ABI; reference energies are generated separately by pinned RDKit Python and are not used at runtime | RDKit `276b5a662302c6a548ac4f1363c066f3258e3a20`, BSD-3-Clause; generated fixture SHA-256 `ca186e06ecf1ad6d11e5bd94742c634ede59f0f85ad80fd37da92c103281fb57` | C++ serialization/domain test, Rust strict decoder known answers, packaged Emscripten 4.0.10 BCEX/BMFX smoke, 24-case MMFF94/MMFF94s CPU/real-Metal energy parity, and 24 converged Metal optimizer endpoints within `0.25` kcal/mol of pinned RDKit on Apple M2 Pro |
| `crates/burette-compute-core/src/alignment.rs` | selected Horn, Gaussian shape, and ESP functions plus `tests/test_cheese.py` in mlxmolkit | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only behavioral reference; independently implemented float64 mapped alignment and fixed-pose scoring oracle; retained the five-atom coordinate/charge values as a deterministic parity fixture | Horn quaternion method, published ESP-Sim Gaussian coefficients, and upstream MIT fixture attribution; no upstream implementation source copied | pinned rigid-transform fixture recovers RMSD below `0.005`, shape above `0.999`, inverted-charge ESP below `-0.99`, and combined score in `(0.45, 0.55)`; mapping-domain and symmetry tests also pass |
| `compute/metal/alignment-score.v1.metal` | selected Horn, Gaussian shape, and ESP functions in `mlxmolkit/cheese.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only behavioral reference; independent bounded pair kernel with shared atoms/mappings and transform-only output | Horn quaternion method and published ESP-Sim Gaussian coefficients; no upstream source copied | package-bound float64 CPU/Metal startup KAT and real reordered-pose dispatch pass on Apple M2 Pro |
| `apps/desktop/src-tauri/src/compute/alignment_workflow.rs` | selected pose comparison behavior in `mlxmolkit/cheese.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | independently implemented Grid orchestration, V2000/V3000 parsing, deterministic exact element/bond-graph mapping, complete-common-run semiempirical charge selection, CPU parity gate, score writeback, and aligned SDF publication | no upstream source copied; molfile formal charges remain the explicit fallback when no complete semiempirical charge run exists | reordered-pose and graph-mismatch known answers, charge-run selection, pinned upstream core fixture, package-bound alignment KAT, and real reordered Grid-to-Metal smoke on Apple M2 Pro; Grid analysis plus annotated aligned SDF are the durable table/report and 3D surfaces |
| `crates/burette-compute-core/src/semiempirical.rs`, `crates/burette-compute-core/src/semiempirical/rm1.rs`, `compute/semiempirical/fixtures/pyseqm-scf-9e7337f6.json` | `mlxmolkit/rm1/scf.py`, `mlxmolkit/rm1/integrals.py`, `tests/test_rm1_scf.py`; authoritative `lanl/PYSEQM/seqm/seqm_functions/energy.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a`; fixture SHA-256 `33b32f0dc99a0e6c01b6c7e74532a08a87a229268958ff465ec4e43acf8dfbd2` | independently implemented bounded closed-shell SCF, Jacobi diagonalization, DIIS, adaptive damping, molecule/basis pack and charges; adapted RM1 core-core/Gaussian correction equations; retained only frozen numeric known answers and geometry inputs from the upstream PYSEQM comparison test | PYSEQM BSD-3-Clause for nuclear formula; authoritative license archived at `compute/semiempirical/licenses/PYSEQM-BSD-3-CLAUSE.txt`; no production Python/MLX dependency | deterministic SCF, charge-conservation and invalid-input known answers plus 12 electronic/nuclear/total-energy comparisons across H2, H2O, CH4, and NH3 with RM1, AM1, and full PM6; every component passes the upstream `0.001 eV` threshold |
| `crates/burette-compute-core/src/semiempirical/parameters.rs` | authoritative `openmopac/mopac/src/models/parameters_for_RM1_C.F90`; `mlxmolkit/rm1/params.py` is parity-only | OpenMOPAC `052691223d19935a89f0fe18cd12301bd83e4201`; mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274` | adapted RM1 numeric parameter table for the ten-element upstream method domain; Burette-owned typed layout | OpenMOPAC Apache-2.0, copyright 2021 Virginia Polytechnic Institute and State University; license archived at `compute/semiempirical/licenses/OPENMOPAC-APACHE-2.0.txt` | exact atomic-domain and H/C/I pinned-value known answers; four-molecule full-evaluator RM1 parity passes, while extended-element corpus growth remains an explicit future validation task |
| `compute/semiempirical/reference/parameters_AM1_MOPAC.csv`, `parameters_PM3_MOPAC.csv`, `parameters_PM6_MOPAC.csv`, `generate-sp-method-parameters.py`, `sp_method_parameters.generated.rs`, and AM1* in `parameters.rs` | `mlxmolkit/rm1/methods.py`, bundled MOPAC CSVs, `pm6_params.py`; authoritative OpenMOPAC AM1/PM3/PM6 parameter modules | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; AM1 SHA-256 `9bd640e9f51ec97aa88487a106f0889fa8d73778ba96b088e711c8617562008a`; PM3 SHA-256 `4f3cc3339ee86627690fac8e2ce8c45a4cf1468e2bf786ad086d76a6c66549ca`; PM6 SHA-256 `c8f9c7e4c5b8d056effd3db1cd2b7bef06726d740678ed5055da00cc805147ff`; OpenMOPAC `052691223d19935a89f0fe18cd12301bd83e4201` | retained SHA-pinned source tables and mechanically generated native AM1, PM3, and PM6_SP records for their complete upstream 11-, 25-, and 10-element domains; AM1* retains its published CHNO table; PM6_SP stays explicit despite the pinned upstream registry omitting its own declared table | mlxmolkit MIT attribution and OpenMOPAC Apache-2.0 apply; AM1* values are attributed to the upstream Ong et al. 2025 table reference | explicit-water and HCl energy/charge parity against the pinned upstream oracle; CPU and v20 Metal Grid paths pass for the extended element domain |
| `compute/semiempirical/reference/parameters_PM6_MOPAC.csv`, `generate-pm6-parameters.mjs`, `pm6_full_parameters.generated.rs` | `mlxmolkit/rm1/data/parameters_PM6_MOPAC.csv`, `methods.py`, `pm6_params.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; source CSV SHA-256 `c8f9c7e4c5b8d056effd3db1cd2b7bef06726d740678ed5055da00cc805147ff` | retained the byte-identical source table and generated a production-native typed table for all 40 parameterized elements, including all s/p/d, tail, Slater-Condon, Gaussian, and effective-charge fields | mlxmolkit MIT attribution and OpenMOPAC Apache-2.0 apply | exact C/S/I known answers, sorted-domain and 18-element d-basis coverage tests, full-d H2S evaluator parity, and v20 Metal integration pass |
| `compute/semiempirical/reference/w_integrals.py`, `generate-pm6-w-maps.mjs`, `pm6_w_integrals.rs`, `pm6_w_maps.generated.rs` | `mlxmolkit/rm1/w_integrals.py`; authoritative PYSEQM `build_two_elec_one_center_int_D.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; reference SHA-256 `4ba88f9befacb88593f522fc2de937dfd34c8d667b4d04b88b1a3a593f315b9f`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | retained the byte-identical reference, mechanically extracted only the three 243-entry integer maps, and independently implemented the Slater-Condon and 52-intermediate native Rust equations | mlxmolkit MIT and PYSEQM BSD-3-Clause apply | sulfur and iron selected W values plus aggregate sulfur sum match the pinned oracle at `1e-10` or tighter; full-d SCF and v18 Metal integration pass |
| `compute/semiempirical/reference/fock_d.py`, `generate-pm6-fock-map.mjs`, `pm6_fock_d.rs`, `pm6_fock_map.generated.rs` | `mlxmolkit/rm1/fock_d.py`; authoritative PYSEQM `fock.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; reference SHA-256 `e4308bcd2e7c9e3abbb569b7e897fdfed012a1b02bd1a22f77915f512e821fd0`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | retained the byte-identical reference, mechanically generated the ordered 45-output/243-term integer map, and implemented finite/symmetric packed-density contraction in native Rust | mlxmolkit MIT and PYSEQM BSD-3-Clause apply | full deterministic 9x9 matrix matches the pinned oracle at `1e-10` or tighter; per-dispatch Metal parity and full-d H2S SCF pass |
| `compute/semiempirical/reference/wigner_d.py`, `pm6_wigner_d.rs` | `mlxmolkit/rm1/wigner_d.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; reference SHA-256 `c914f197030f8ef40a6763c8ce3b79124ceb269bbfaf870c18be78c17ffc0a18` | adapted the real-spherical-harmonic l=2 formulas into a typed Rust implementation with proper-rotation validation and d-d/d-p/d-s block APIs | mlxmolkit MIT attribution applies | arbitrary-axis Wigner and all three overlap block types match the pinned oracle at `1e-14`; generated rotated tensors feed the v20 Metal Fock path |
| `pm6_overlap_d.rs`, extended associated-Legendre support in `overlap.rs` | `mlxmolkit/rm1/slater_overlap_ref.py`, d-channel layout in `mlxmolkit/rm1/overlap_d.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274` | independently generalized the bounded 48-point prolate-spheroidal STO integrator to l=2 and principal quantum numbers one through five; avoids the upstream hardcoded high-quantum-number limitation and requires no Python/SciPy runtime | formula-only behavioral reference; no upstream source text copied | S-O d-s/d-p, S-Cl d-d, I-C qn5, and S-H s-only boundary known answers |
| `pm6_multipole_d.rs` | PYSEQM `two_elec_two_center_int.py`, `cal_par.py`; mlxmolkit NumPy parity port | PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a`; mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274` | adapted AIJL, Slater-Condon, and POIJ derivation with distinct transition-metal and PM6 main-group branches, main-versus-tail exponents, and typed positive-output validation | PYSEQM BSD-3-Clause applies | S, Fe, and exact-precision I charge separations plus `rho3`--`rho6` match the pinned oracle at `2e-10`; all 18 parameterized d elements produce finite values |
| `pm6_two_center_d.rs` YH branch | PYSEQM `two_elec_two_center_int_local_frame_d_orbitals.py`, `RotationMatrixD.py`; mlxmolkit `tetci_yh.py` parity surface | PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a`; mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274` | adapted the d-basis atom--hydrogen multipole equations, local nine-orbital symmetry classes, and PYSEQM orbital rotation into a bounded dense 9x9 native Rust result with explicit electron-core terms | PYSEQM BSD-3-Clause applies | ten arbitrary-axis S-H entries and the complete matrix sum match the pinned NumPy oracle at `2e-10` |
| `reference/two_elec_two_center_int_local_frame_d_orbitals_np.py`, `generate-pm6-two-center.py`, `pm6_yx_local.generated.rs`, `pm6_yy_local.generated.rs`, `pm6_two_center_d.rs` YX/YY branches | mlxmolkit vendored PYSEQM NumPy port of `two_elec_two_center_int_local_frame_d_orbitals.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; reference SHA-256 `aca9f065544fb9aacddf15ace0c0cb03d887481b9fa45f71835b49c95b3b17af`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | retained the byte-identical reference, mechanically translated the scalar YX and YY AST assignments into bounded 450-entry and 2025-entry native Rust local tensors, applied native packed-pair orbital transforms to dense `9x9x4x4` and `9x9x9x9` molecular d extensions, and contracted d-extension electron-core matrices with the PM6 transition-metal core-width override; the generator rejects source drift and Python is not used at runtime | PYSEQM BSD-3-Clause applies | local S-O YX has 84 nonzero entries and selected/aggregate parity at `2e-10`; its arbitrary-axis dense extension has 1040 nonzero entries and parity at `3e-9`; local S-S YY has 398 nonzero entries and parity at `3e-10`, while its arbitrary-axis dense extension has 6305 nonzero entries and selected/full-aggregate parity at `4e-8`; S-O, S-S, and Fe-Fe d-extension core entries match the pinned oracle at `4e-9` |
| `reference/PWCCT_PM6_MOPAC.csv`, `generate-pm6-pwcct.py`, `pm6_pwcct.generated.rs`, `semiempirical.rs` PM6 PWCCT | `mlxmolkit/rm1/pwcct.py`, bundled `PWCCT_PM6_MOPAC.csv`; authoritative PYSEQM pair nuclear energy | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; source CSV SHA-256 `2fafe0ddec1d6aaec230d63bcd5959f727550418bcddd3b75d19f051661b6845`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | retained the byte-identical 83x83 source table, generated 674 nonzero symmetric native pair records, and adapted PM6 core-core, X-H, and C-C equations; separate from AM1-style Gaussian core repulsion and no CSV/Python runtime is required | mlxmolkit MIT and PYSEQM BSD-3-Clause apply; licenses are archived under `compute/semiempirical/licenses` | catches the 4.3647 eV water error from incorrectly reusing AM1-style nuclear repulsion; water and full-d H2S energy/charge parity pass against pinned upstream oracles |
| `crates/burette-compute-core/src/semiempirical/pm6_scf.rs` | `mlxmolkit/rm1/scf.py`, `fock.py`, `hcore.py`, `basics.py`, `pack.py`; authoritative PYSEQM `fock.py`, `hcore.py`, and `scf_loop.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | adapted variable 1/4/9-orbital pair packing, sp+d overlap ordering, neutral-atom density initialization, one- and two-center Fock contraction, and closed-shell SCF assembly into typed native Rust; Python and MLX are reference-only | mlxmolkit MIT and PYSEQM BSD-3-Clause apply | pinned full-d H2S electronic and nuclear energies plus all atomic charges match the PM6_D upstream oracle; unequal-basis tensor indexing has dedicated coverage |
| `crates/burette-compute-core/src/semiempirical/pm6_d3h4.rs` | `mlxmolkit/rm1/pm6_d3h4.py`; authoritative OpenMOPAC `H_bonds4.F90` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; OpenMOPAC `052691223d19935a89f0fe18cd12301bd83e4201` | adapted Rezac-Hobza H4 hydrogen-bond scaling, covalent-radius values, and short-range H-H polynomial into a bounded float64 CPU oracle | mlxmolkit MIT attribution and OpenMOPAC Apache-2.0 apply | water-dimer H4/HH and methane HH values match the pinned oracle at `1e-12` kcal/mol; production PM6-D3H4 composes D3/H4/HH after SCF and passes CPU/Metal Grid validation |
| `compute/semiempirical/reference/c6ab_d3.npz`, `r0ab_d3.npz`, `generate-pm6-d3-table.py`, `pm6_d3.generated.bin`, `pm6_d3_full.rs` | `mlxmolkit/rm1/pm6_d3h4.py` and bundled `c6ab_d3.npz`/`r0ab_d3.npz`; authoritative OpenMOPAC D3 correction | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; C6 SHA-256 `4cf0968d78ed05c68adbd5ae6166a2d983d6c7180f61633c0fd3120e504bd746`; r0 SHA-256 `ead44d7cd5bf4a179aa2a6dd2f1e4f495160b066156a76e25cbef1026e7d3cd9`; generated binary SHA-256 `a9322798b08df27e4af743cadd67bbc9e594ce25f4bc3c24f304180c8104b12c`; OpenMOPAC `052691223d19935a89f0fe18cd12301bd83e4201` | retained the byte-identical upstream tables, SHA-gated a compact little-endian native table with 8,836 ordered pairs and 64,516 C6/CN reference records, and implemented a bounded float64 zero-damping D3 oracle; no NPZ, Python, NumPy, or MLX production runtime | mlxmolkit MIT attribution and OpenMOPAC Apache-2.0 apply | methane plus S/Cl/Br/I and Fe/O known answers match the pinned oracle; generator output is byte-reproducible |
| `crates/burette-compute-core/src/semiempirical/two_center.rs` | `mlxmolkit/rm1/two_center_integrals.py`; authoritative `lanl/PYSEQM/seqm/seqm_functions/cal_par.py` and `two_elec_two_center_int_local_frame.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | adapted complete RM1 sp-basis multipole/additive-term and H-H/X-H/X-X 22-integral local-frame equations; typed scalar implementation with explicit atom ordering | PYSEQM BSD-3-Clause; authoritative license archived at `compute/semiempirical/licenses/PYSEQM-BSD-3-CLAUSE.txt` | H/C/Cl/I multipoles, H2/O-H/C-H pairs, and all 22 C-O integrals/core attractions match pinned oracle at `1e-12` or tighter; global rotation and Fock contraction are integrated |
| `crates/burette-compute-core/src/semiempirical/rotation.rs` | `mlxmolkit/rm1/rotation.py`; authoritative `lanl/PYSEQM/seqm/seqm_functions/two_elec_two_center_int.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | adapted quaternion rotation and full sp pair-tensor contraction into molecular coordinates; explicit H-heavy transpose semantics | PYSEQM BSD-3-Clause; authoritative license archived at `compute/semiempirical/licenses/PYSEQM-BSD-3-CLAUSE.txt` | arbitrary-axis C-O tensor/core and H-heavy transpose parity pass at `1e-12` or tighter; molecular Fock and Metal pair-rotation integration pass |
| `crates/burette-compute-core/src/semiempirical/overlap.rs` | `mlxmolkit/rm1/overlap.py`, `mlxmolkit/rm1/slater_overlap_ref.py`; authoritative `lanl/PYSEQM/seqm/seqm_functions/diat_overlap_PM6_SP.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | adapted analytic qn1-3 overlap; independently structured bounded 48-point Gauss-Legendre prolate-spheroidal STO overlap for qn4-5, replacing the upstream-documented broken hardcoded iodine path; no SciPy/Python runtime | PYSEQM BSD-3-Clause applies to qn1-3 equations; qn4-5 is formula-only reference with no copied source | C-O/O-H/S-H/S-O/S-Cl analytic matrices and Br-H/I-C numerical overlaps match pinned oracles; methyl iodide converges end-to-end with charge conservation |
| `crates/burette-compute-core/src/semiempirical/rm1.rs` | `mlxmolkit/rm1/scf.py`; authoritative `lanl/PYSEQM/seqm/seqm_functions/fock.py` and `energy.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | adapted NDDO core-Hamiltonian, one-/two-center Coulomb/exchange contractions and electronic-energy equation over Burette's independent SCF driver | PYSEQM BSD-3-Clause; authoritative license archived at `compute/semiempirical/licenses/PYSEQM-BSD-3-CLAUSE.txt` | the 12-case RM1/AM1/full-PM6 external energy corpus passes at `0.001 eV`; H2S and methyl iodide converge with charge conservation; false-DIIS-convergence regression covered |
| `apps/desktop/src-tauri/src/compute/semiempirical_workflow.rs` | `mlxmolkit/rm1/scf.py` operation surface | `9e7337f6f93c40a39ad0187991151944a4f1e274` | Burette-owned frozen Grid orchestration, V2000/V3000 input conversion, method-specific RM1/AM1/PM3/PM6/PM6_D/PM6_D3H4/PM6_SP/AM1* evaluation and typed analysis writeback, and truthful backend provenance | no upstream orchestration source copied | all eight methods converge through CPU and v20 Metal Grid-molfile tests on explicit water; full-d H2S and full correction dispatch pass through the packaged-runtime Grid path on Apple M2 Pro; selector bridge contract and selection bounds covered |
| `compute/metal/rm1-fock.v1.metal` | `mlxmolkit/rm1/scf.py`; authoritative `lanl/PYSEQM/seqm/seqm_functions/fock.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | independent one-thread-per-matrix-element Metal contraction of pre-rotated RM1 two-center Coulomb/exchange tensors | formula behavior follows the PYSEQM BSD-3-Clause reference; no Python/MLX source copied | package-bound startup KAT and complete explicit-water SCF pass with per-dispatch float64 CPU parity on Apple M2 Pro |
| `compute/metal/rm1-eigen.v1.metal` | `mlxmolkit/rm1/scf.py` diagonalization behavior | `9e7337f6f93c40a39ad0187991151944a4f1e274` | independent maximum-pivot symmetric Jacobi Metal kernel with fixed padded batch slots, trace-shift/spectral host preconditioning, and adaptive float64 SCF polishing | no upstream source copied | package-bound eigenpair KAT, float64 eigenvalue/residual/orthogonality gates, and complete explicit-water SCF on Apple M2 Pro |
| `compute/metal/rm1-pair-rotate.v1.metal` | `mlxmolkit/rm1/two_center_integrals.py`, `rotation.py`; authoritative `lanl/PYSEQM/seqm/seqm_functions/two_elec_two_center_int_local_frame.py`, `two_elec_two_center_int.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | independent one-thread-per-pair Metal local-integral generation, molecular-frame rotation, and complete tensor/core-attraction materialization for H-H, heavy-H, and heavy-heavy inputs | formula behavior follows the PYSEQM BSD-3-Clause reference; no Python/MLX source copied | full-element CPU tensor parity, package-bound three-branch startup KAT, and explicit-water SCF on Apple M2 Pro |
| `compute/metal/pm6-pair-fock.v1.metal` | `mlxmolkit/rm1/fock.py`; authoritative PYSEQM `fock.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | independent one-thread-per-matrix-element Metal contraction with exact variable 1/4/9-orbital tensor strides and bounded unified-memory accounting | formula behavior follows the PYSEQM BSD-3-Clause reference; no Python/MLX source copied | v20 package-bound 9x1 startup KAT, per-dispatch float64 parity, and full-d H2S Grid SCF pass on Apple M2 Pro |
| `compute/metal/pm6-h4-hh.v1.metal` | `mlxmolkit/rm1/pm6_d3h4.py`; authoritative OpenMOPAC `H_bonds4.F90` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; OpenMOPAC `052691223d19935a89f0fe18cd12301bd83e4201` | independent one-thread-per-molecule float32 Metal implementation of the bounded H4 and H-H CPU contract | mlxmolkit MIT attribution and OpenMOPAC Apache-2.0 apply | v17 package-bound water-dimer plus methane batch matches the float64 oracle on Apple M2 Pro |
| `compute/metal/pm6-d3.v2.metal` | `mlxmolkit/rm1/pm6_d3h4.py` and bundled D3 tables | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; OpenMOPAC `052691223d19935a89f0fe18cd12301bd83e4201` | independent one-thread-per-molecule float32 Metal implementation over the complete compact Z=1--94 D3 CPU contract | mlxmolkit MIT attribution and OpenMOPAC Apache-2.0 apply | v20 package-bound methane, S/Cl/Br/I, Fe/O, and water-dimer batches match the float64 D3/H4/HH oracle on Apple M2 Pro |
| `compute/metal/pm6-one-center-fock.v1.metal` | `mlxmolkit/rm1/fock_d.py`; authoritative PYSEQM `fock.py` | mlxmolkit `9e7337f6f93c40a39ad0187991151944a4f1e274`; PYSEQM `6ced9ea66160428e06d37df18e9f565b8123f84a` | mechanically generates the shared 45-output/243-term integer map and an independent one-thread-per-packed-element Metal contraction | mlxmolkit MIT and PYSEQM BSD-3-Clause apply | package-bound full 9x9 float32/float64 KAT and full-d H2S SCF integration pass on Apple M2 Pro |

## Acceptance procedure

1. Open the exact upstream file at the pinned commit and record all headers,
   comments, references, and imported data sources.
2. Trace any derived source to its authoritative repository and revision.
3. Confirm the direct permission scope and every secondary license obligation.
4. Choose `adapted`, `translated`, `formula-only`, or `reference-only`.
5. Add all required notices and source comments before the implementation.
6. Add deterministic upstream and independent-reference fixtures with hashes.
7. Review the diff for provenance completeness and scientific parity.
8. Update this ledger and `THIRD_PARTY_NOTICES.md` in the same commit.
