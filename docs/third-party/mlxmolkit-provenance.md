# mlxmolkit Provenance and Adaptation Ledger

Status: active legal and engineering gate; no adapted upstream source has been
accepted into Burrete yet.

## Primary source

- Author: Guillaume Osmo
- Repository: <https://github.com/guillaume-osmo/mlxmolkit>
- Pinned audit commit: `9e7337f6f93c40a39ad0187991151944a4f1e274`
- Commit date: 2026-07-08
- Package metadata: `mlxmolkit-rdkit` 0.4.0, declared MIT in
  `pyproject.toml`
- Repository license file at the pinned commit: absent

The Burrete project owner recorded direct permission from Guillaume to copy and
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
| LANL/Triad PYSEQM | BSD-3-Clause | `rm1/_pyseqm_port/**`, SCF/integrals, d-orbital and parameter logic |
| OpenMOPAC | Apache-2.0 | RM1/AM1/PM3/PM6 parameter tables and conventions |

No source or data from these areas may be adapted until the authoritative
license text, copyright notice, exact source revision, and file mapping are
recorded.

## Candidate inventory

`reference-only` means the file may be studied and used as an oracle but is not
approved for copying. `pending-audit` means it is a likely donor whose complete
provenance and scientific behavior still require review.

| Upstream path | Candidate use | Status | Known issue to correct |
| --- | --- | --- | --- |
| `mlxmolkit/fp_uint32.py` | Fingerprint packing | reference-only; independent Burrete ABI shipped | Canonical little-endian `u64[32]` persistence and explicit `u32[64]` Metal view |
| `mlxmolkit/fused_tanimoto_nlist.py` | Fused Tanimoto and CSR | reference-only; independent Burrete implementation shipped | Exact rational cutoff, checked edge/offset widths, no full pair matrix |
| `mlxmolkit/tanimoto_blockwise.py` | 100k+ tiling | reference-only; independent Burrete planner shipped | Checked request limits and bounded adaptive tiles; 100k benchmark remains gated |
| `mlxmolkit/butina.py` | Butina semantics | reference-only; independent Burrete policy shipped | Versioned deterministic tie-breaking; upstream/RDKit corpus parity remains gated |
| `mlxmolkit/morgan_cpu.py` | Morgan oracle | reference-only | Entire stage is RDKit CPU, not GPU |
| `mlxmolkit/shared_batch.py` | Shared `N x K` constraints | reference-only; independent Burrete scheduler and EnginePack ABI shipped | Burrete constraints are stored once per molecule; seeds are identity-derived and chunk-invariant |
| `mlxmolkit/dg_extract.py` | DG bounds/parameters | reference-only; native RDKit adapter staged | nvMolKit remains blocked; production extraction calls pinned RDKit directly |
| `mlxmolkit/etk_extract.py` | ETK torsions/constraints | reference-only; native RDKit adapter staged | All variant presets are selected from pinned RDKit C++ constants |
| `mlxmolkit/conformer_metal.py` | DG Metal logic | pending-audit | Seed currently depends on chunk schedule |
| `mlxmolkit/etk_energy_metal.py` | ETK objective reference | formula-only reference; independent CPU/Metal objective shipped | Prove all eight requested variants independently; secondary notices remain release-blocking |
| `mlxmolkit/etk_minimize_metal.py` | ETK minimizer reference | formula-only reference; independent bounded CPU/Metal optimizer shipped | Secondary notices and broader upstream/RDKit parity remain release-blocking |
| `mlxmolkit/etk_metal.py` | ETK workflow orchestration | reference-only | Stereo-aware retry and all eight variant workflows remain incomplete |
| `mlxmolkit/stereo_checks.py` | Stereo validation oracle | reference-only | Preserve atom mapping and fail explicitly |
| `mlxmolkit/stereo_checks_metal.py` | Stereo Metal candidate | pending-audit | Independent parity and domain gates required |
| `mlxmolkit/mmff_params.py` | MMFF parameter pack | pending-audit | RDKit identity and MMFF94/MMFF94s versioning |
| `mlxmolkit/mmff_energy_native.py` | Seven MMFF terms | formula-only reference; independent CPU energy oracle shipped | Analytic Metal gradients and RDKit term-by-term parity remain gated |
| `mlxmolkit/mmff_minimize.py` | Optimizer orchestration | reference-only | Batch-global optimizer choice and ambiguous status semantics |
| `mlxmolkit/mmff_bfgs_source_tg.metal` | BFGS Metal candidate | pending-audit | Shivam/nvMolKit provenance; explicit convergence reasons |
| `mlxmolkit/mmff_lbfgs_source_tg.metal` | L-BFGS Metal candidate | pending-audit | Per-molecule policy and memory proof |
| selected `mlxmolkit/cheese.py` functions | Horn/RMSD/shape/ESP formulas | reference-only | Equal atom-order assumption and unsafe full pair tensor |
| `mlxmolkit/rm1/**` | Semiempirical oracle and formulas | reference-only | Mixed provenance; incomplete d-orbital GPU; method registry conflicts |
| `mlxmolkit/rm1/_pyseqm_port/**` | PYSEQM numerical oracle | reference-only | BSD-3 mechanical translation; do not treat as Guillaume-only code |
| `mlxmolkit/rm1/data/**` | Parameter/reference data | reference-only | Exact PYSEQM/OpenMOPAC source and redistribution terms required |

Duplicate or superseded pipelines, Python package/CLI code, examples, training
experiments, learned models, caches, `.dylib`, `.metallib`, and benchmark output
are excluded from the production source tree.

The 2026-07-16 conformer audit re-opened the pinned commit and confirmed that
`shared_batch.py` uses one process-wide NumPy RNG seed, while `dg_extract.py`
advances a shared RNG as conformers are traversed. That behavior is not safe
under adaptive rebatching. Burrete therefore implemented its seed identity and
batch planner independently: the seed domain includes immutable job ID, source
record ID, molecule-content hash, exact variant, conformer ordinal, and retry
ordinal. No upstream conformer code was copied in that increment.

The `conformer.engine-pack.v1` topology and constraint ABI was also designed
independently. It does not translate the blocked DG/ETK extractor or Metal
sources. The ABI is a Burrete-owned production boundary that can be populated
by an audited native extractor and compared with separately executed reference
oracles without making Python or MLX part of the application runtime.

The counter-based `conformer_initialize.v1` Rust/Metal primitive was written
independently from the immutable Burrete seed contract. No RNG, coordinate
initialization, DG, or Metal source was copied or translated from `mlxmolkit`.
The paired distance-bound objective and analytic-gradient Rust/Metal primitive
was likewise implemented independently from a mathematical contract; no
upstream DG implementation was copied or translated. A 2026-07-16 parity audit
against pinned `mlxmolkit/conformer_metal.py` found that Burrete's first simple
quadratic squared-bound penalty was scientifically incompatible. Burrete now
uses the same normalized upper-bound and rational lower-bound equations as the
reference, with an independently structured gather implementation, explicit
known answers, finite-difference validation, and CPU/Metal parity. This is a
formula-only reference: upstream source text is not present in Burrete, and the
named nvMolKit secondary revision remains a release gate before DG adaptation.
The paired bounded L-BFGS CPU oracle and fused Metal optimizer were also written
independently against that formula-only behavioral reference. The Metal kernel
uses a Burrete-owned fixed threadgroup ABI, atom-gather reduction, bounded
history, and explicit convergence statuses; no upstream optimizer source text
was copied or mechanically translated.

The conformer admission and queued-job increment was also independently
implemented. It adds a frozen-molecule-identity-bound chemistry-preflight
memory envelope, independent
backend decisions for distance geometry and stereo validation, canonical
durable snapshot construction, and capability-rooted frozen-source binding.
It does not copy upstream planning, packaging, or execution code.

The native conformer extractor under `compute/rdkit-conformer` is likewise a
Burrete-owned adapter rather than a translation of the Python extractors. It is
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
pinned RDKit adapter. The existing Burrete bounded L-BFGS contract was reused
for CPU and Metal refinement; no upstream Python or Metal source text was
copied. The pinned `mlxmolkit/etk_energy_metal.py` and
`mlxmolkit/etk_minimize_metal.py` files are numerical behavior references only.

## Burrete adaptation ledger

This table is mandatory for every adapted, translated, or formula-referenced
file. The entries below record mathematical parity references; the existing
compute protocol, CPU clustering reference, Tanimoto Metal contract, and
deterministic conformer scheduler remain independently implemented and do not
copy `mlxmolkit` source.

| Burrete path | Upstream path | Commit | Contribution | Secondary source/license | Validation |
| --- | --- | --- | --- | --- | --- |
| `crates/burrete-compute-core/src/distance_geometry.rs` | `mlxmolkit/conformer_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only objective reference; independently implemented CPU oracle | nvMolKit named upstream; exact secondary revision still release-blocking | upper/lower known answers and finite-difference gradient |
| `compute/metal/conformer-distance.v1.metal` | `mlxmolkit/conformer_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only objective reference; independent atom-gather Metal kernel | nvMolKit named upstream; exact secondary revision still release-blocking | CPU/Metal parity and packaged startup KAT on Apple M2 Pro |
| `crates/burrete-compute-core/src/distance_optimizer.rs` | `mlxmolkit/conformer_metal.py`, `mlxmolkit/etk_minimize_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only L-BFGS behavioral reference; independently structured bounded CPU oracle shared by DG and ETK objectives | nvMolKit/Shivam Patel named upstream; exact secondary revisions still release-blocking | deterministic convergence, no-op satisfied case, bounded line-search exhaustion, ETK objective reduction |
| `compute/metal/conformer-optimize.v1.metal` | `mlxmolkit/conformer_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only L-BFGS behavioral reference; independent fused atom-gather Metal optimizer | nvMolKit named upstream; exact secondary revision still release-blocking | CPU/Metal startup parity and packaged KAT on Apple M2 Pro |
| `crates/burrete-compute-core/src/etk_geometry.rs` | `mlxmolkit/etk_energy_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only ETK objective reference; independent CPU evaluator and analytic gradients | nvMolKit/Shivam Patel named upstream; exact secondary revisions still release-blocking | deterministic known answers and finite-difference gradients |
| `compute/metal/conformer-etk.v1.metal` | `mlxmolkit/etk_energy_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only ETK objective reference; independent atom-gather Metal evaluator | nvMolKit/Shivam Patel named upstream; exact secondary revisions still release-blocking | CPU/Metal energy and gradient startup KAT on Apple M2 Pro |
| `compute/metal/conformer-etk-optimize.v1.metal` | `mlxmolkit/etk_minimize_metal.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only minimizer reference; Burrete bounded L-BFGS structure adapted to the ETK objective | nvMolKit/Shivam Patel named upstream; exact secondary revisions still release-blocking | packaged optimizer KAT and real executor smoke on Apple M2 Pro |
| `compute/rdkit-conformer/conformer_extractor.cpp` | `mlxmolkit/dg_extract.py`, `mlxmolkit/etk_extract.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | parity reference only; independent adapter over official RDKit C++ APIs | RDKit `276b5a662302c6a548ac4f1363c066f3258e3a20`, BSD-3-Clause | binary ABI unit test present; RDKit/WASM parity fixtures pending |
| `crates/burrete-compute-core/src/mmff.rs` | `mlxmolkit/mmff_energy_native.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only behavioral reference; independently implemented seven-term CPU energy oracle and bounded numerical reference gradient | Halgren MMFF publications; upstream names nvMolKit but no nvMolKit source was copied | seven-term known answer, equilibrium, validation, and translation-invariance tests; RDKit corpus parity pending |
| `compute/metal/mmff-energy.v1.metal` | `mlxmolkit/mmff_energy_native.py`, `mlxmolkit/mmff_optimize.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only behavioral reference; independently implemented batched seven-term Metal evaluator, bounded numerical gradient, and fused automatic BFGS/L-BFGS optimizer | Halgren MMFF publications; no upstream or nvMolKit source copied | package-bound CPU/Metal startup KAT across every term and gradient plus optimization energy reduction on Apple M2 Pro |
| `compute/rdkit-conformer/mmff_extractor.cpp`, `mmff_binary.cpp` | `mlxmolkit/mmff_params.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | parity reference only; independent adapter over official pinned RDKit C++ MMFF APIs and Burrete-owned BMFX ABI | RDKit `276b5a662302c6a548ac4f1363c066f3258e3a20`, BSD-3-Clause | C++ serialization/domain test, Rust strict decoder known answers, and packaged Emscripten 4.0.10 BCEX/BMFX smoke; RDKit energy corpus pending |
| `crates/burrete-compute-core/src/alignment.rs` | selected Horn, Gaussian shape, and ESP functions in `mlxmolkit/cheese.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only behavioral reference; independently implemented float64 mapped alignment and fixed-pose scoring oracle | Horn quaternion method and published ESP-Sim Gaussian coefficients; no upstream source copied | known proper-transform recovery, self-score, symmetry, inverted-charge, and mapping-domain tests |
| `compute/metal/alignment-score.v1.metal` | selected Horn, Gaussian shape, and ESP functions in `mlxmolkit/cheese.py` | `9e7337f6f93c40a39ad0187991151944a4f1e274` | formula-only behavioral reference; independent bounded pair kernel with shared atoms/mappings and transform-only output | Horn quaternion method and published ESP-Sim Gaussian coefficients; no upstream source copied | package-bound float64 CPU/Metal startup KAT on Apple M2 Pro; broad corpus parity pending |

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
