# QCSchema producer fixtures

Generated for Burette by `generate.py` with QCEngine 0.52.0, QCElemental 0.51.4, Psi4 1.11 and
optking 0.5.0 (all BSD-3-Clause; none is bundled). The JSON is the producer's own serialization,
with only `stdout` and `provenance` (host names, scratch paths and timings) removed.

| File | Calculation | Covers |
| --- | --- | --- |
| `water-hf-hessian.json` | RHF/cc-pVDZ, driver `hessian` | flat (3N)² Hessian in Hartree/bohr², molecule masses |
| `water-hf-ccpvdz-wavefunction.json` | RHF/cc-pVDZ, `orbitals_and_eigenvalues` | spherical basis and orbitals |
| `water-hf-631gs-wavefunction.json` | RHF/6-31G*, `puream false` | Cartesian d shells |
| `hydroxyl-uhf-wavefunction.json` | UHF/cc-pVDZ doublet | alpha and beta orbitals |
| `water-optimization-trajectory-all.json` | optking RHF/STO-3G, `trajectory: all` | every gradient step |
| `water-optimization-trajectory-final.json` | the same, `trajectory: final` | only the last gradient; `energies` keeps every step |

Oracles (PySCF 2.14.0, Apache-2.0, run outside the repository):

- `orbital-reference.json` (`python orbital-reference.py *-wavefunction.json`) rebuilds each basis
  in PySCF, records orbital values at fixed points and orthonormality in PySCF's AO overlap
  (≤ 6e-15). For the closed-shell files, the density from the stored orbitals agrees with PySCF's
  own SCF density to 6e-6 (Psi4 density-fits), which is what established the AO convention
  described in that script.
- `hessian-reference.json` (`python hessian-reference.py water-hf-hessian.json`) is PySCF's analytic
  RHF Hessian and projected harmonic frequencies at the same geometry and masses.

optking's `final_molecule` is one update past the last gradient, so it has no energy of its own.

SHA-256:

    7f7ae04d7ce5a37a3b7625462b76ee7c5adec649e3d9f53f39591ce1513d9728  hydroxyl-uhf-wavefunction.json
    ad67d87003d9bb364af503ac2ee5b9da9cb92b547b7e5914efb7887ee4e59c37  water-hf-631gs-wavefunction.json
    162c0236bdaa0415fc879bad8ce9a1be65ffd46e84783a636062d1f6ceacf28f  water-hf-ccpvdz-wavefunction.json
    eaf4ca01c19e80519dd295710c2bafd3e0ed7e5babeefa609cabad2c41891014  water-hf-hessian.json
    fa3d4a703d96236f32b57db9956bb2b4ccf650f090398e7f961043fb38ce299e  water-optimization-trajectory-all.json
    7f965c7a56726a3ab0984be51121a9f12d9a5560e5a9156b7a52da1698577536  water-optimization-trajectory-final.json
