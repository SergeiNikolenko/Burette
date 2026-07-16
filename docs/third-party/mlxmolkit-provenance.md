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
| `mlxmolkit/dg_extract.py` | DG bounds/parameters | pending-audit | nvMolKit/RDKit provenance and exception handling |
| `mlxmolkit/etk_extract.py` | ETK torsions/constraints | pending-audit | Variant-specific activation and RDKit provenance |
| `mlxmolkit/conformer_metal.py` | DG Metal logic | pending-audit | Seed currently depends on chunk schedule |
| `mlxmolkit/etk_metal.py` | ETK Metal logic | pending-audit | Prove all eight requested variants independently |
| `mlxmolkit/stereo_checks.py` | Stereo validation oracle | reference-only | Preserve atom mapping and fail explicitly |
| `mlxmolkit/stereo_checks_metal.py` | Stereo Metal candidate | pending-audit | Independent parity and domain gates required |
| `mlxmolkit/mmff_params.py` | MMFF parameter pack | pending-audit | RDKit identity and MMFF94/MMFF94s versioning |
| `mlxmolkit/mmff_energy_native.py` | Seven MMFF terms | pending-audit | nvMolKit provenance and term-by-term gradients |
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
was likewise derived independently from its documented mathematical contract;
no upstream DG implementation was copied or translated.

The same audit confirmed that the pinned repository still has no root license
or notice file, `dg_extract.py` names nvMolKit as its reference, and
`etk_metal.py` describes helper code as unchanged from Shivam Patel's work.
Those DG/ETK files remain blocked from adaptation until the exact secondary
revisions and required Apache-2.0/MIT notices are recorded.

## Burrete adaptation ledger

This table is mandatory for every adapted or translated file. It is currently
empty because the existing compute protocol, CPU clustering reference,
Tanimoto Metal contract, and deterministic conformer scheduler were
independently implemented and explicitly do not copy `mlxmolkit` source.

| Burrete path | Upstream path | Commit | Contribution | Secondary source/license | Validation |
| --- | --- | --- | --- | --- | --- |
| _None yet_ | | | | | |

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
