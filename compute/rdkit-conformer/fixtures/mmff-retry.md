# Intermediate ETK retry regression

`mmff-retry-conformer.bcex` and `mmff-retry-parameters.bin` contain the pinned
RDKit conformer extractor's ETKDGv3 and MMFF94s parameters for the 33-heavy-atom
Ketcher structure that reproduced the September 2026 Generate 3D timeout.
The source-record content SHA-256 is
`b74dc043d48a2246afedb2b9fc3984d36250fa7c471dece3ad005a4191cc171f`.

The deterministic Metal regression
`converged_mmff_does_not_retry_intermediate_etk_failure` runs 16 conformers with
32 allowed attempts. Intermediate ETK reports exhausted line search or maximum
iterations, while final MMFF converges and reference/stereo validation passes.
The executor must keep those original ETK statuses and finish after one attempt.
Without the fix, it repeats validated geometries until the aggregate service
timeout. ETK convergence remains required when MMFF parameters are unavailable.

Run the focused ignored test from `apps/desktop/src-tauri` with
`BURETTE_METAL_RUNTIME_ROOT` pointing to a packaged `ComputeMetal` directory.
