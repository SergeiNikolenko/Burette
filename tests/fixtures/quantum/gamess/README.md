# GAMESS output fixtures

Program outputs from [cclib](https://github.com/cclib/cclib/tree/0c6e08e0a0d04b308201666793030ef3b77b2973/data/GAMESS)
`data/GAMESS/basicGAMESS-US2018` (GAMESS-US 30 SEP 2018 R3) and `basicFirefly8.0`
(`cclib-firefly-dvb_raman.out`), BSD-3-Clause (`../cclib-LICENSE.txt`).

| File | Calculation | Covers |
| --- | --- | --- |
| `cclib-dvb_sp.out` | B3LYP/STO-3G, C2h divinylbenzene | symmetry-unique basis listing, L shells, eigenvectors with symmetry labels, Mulliken/Löwdin charges, dipole |
| `cclib-dvb_un_sp.out` | UB3LYP doublet cation, SCF stopped unconverged | alpha/beta sets, `converged: false`, placeholder energy 0.0 not stored |
| `cclib-C_bigbasis-trimmed.out` | RHF/aug-cc-pCVQZ carbon atom, `ISPHER=1` | s–g Cartesian AO labels, 139 AOs and 109 spherical MOs |
| `cclib-dvb_td.out` | TDDFT B3LYP/STO-3G | `SUMMARY OF TDDFT RESULTS`: ten states with symmetry, transition dipole and oscillator strength |
| `cclib-water_mp2.out`, `cclib-water_ccsd.out` | MP2 and CCSD | correlated total energy supersedes SCF |
| `cclib-dvb_gopt_a.out` | B3LYP optimization | seven steps, `EQUILIBRIUM GEOMETRY LOCATED`, final `MOLECULAR ORBITALS` window |
| `cclib-nh3_ts_ir.out` | AM1 semi-numerical Hessian at the planar transition state | force-constant matrix, masses, imaginary mode, IR, rigid modes dropped, no Gaussian basis |
| `cclib-firefly-dvb_raman.out` | Firefly 8.0 RHF Raman | Firefly basis print, Raman activities and depolarizations |

All files are byte-identical except `cclib-C_bigbasis-trimmed.out`, which removes the printed
one-electron integral matrices and per-orbital population matrices to stay under the repository
blob limit:

    a=$(grep -n "^ OVERLAP MATRIX" C_bigbasis.out | head -1 | cut -d: -f1)
    b=$(grep -n "END OF ONE-ELECTRON INTEGRALS" C_bigbasis.out | head -1 | cut -d: -f1)
    c=$(grep -n "ATOMIC MULLIKEN POPULATION IN EACH MOLECULAR ORBITAL" C_bigbasis.out | head -1 | cut -d: -f1)
    d=$(grep -n "TOTAL MULLIKEN AND LOWDIN ATOMIC POPULATIONS" C_bigbasis.out | head -1 | cut -d: -f1)
    sed -e "${a},$((b-1))d" -e "${c},$((d-1))d" C_bigbasis.out > cclib-C_bigbasis-trimmed.out

Original `C_bigbasis.out` SHA-256: `836b97eead217b858f3162bad82b4994a4d455db1e93339d0b4c2a6b2b99a9f9`.

Oracles:

- `cclib-reference.json`: `python ../cclib-reference.py cclib-*.out` with cclib
  `1.8.1.post1298+0c6e08e0`. cclib's GAMESS force-constant parse misreads the fixed-width rows,
  so the Hessian is checked against the frequencies GAMESS printed instead; its IR conversion
  uses the rounded factor 42.255 km/mol per D²/(amu·Å²).
- `orbital-reference.json`: `python orbital-reference.py cclib-*.out` (cclib basis and
  coefficients, PySCF 2.14.0 Cartesian AOs). It records the orthonormality of the coefficients in
  unit-normalized Cartesian AOs (≤ 3e-6, print precision) and orbital values at fixed points.

SHA-256:

    da1918b28f3d0c1eb3a00a99c7fb83113451aa8f5dc098dcb2ef16ec1e3751cf  cclib-C_bigbasis-trimmed.out
    30c29bb0051f70ebfc644164841af8cef3cb643b7c94696a08808e18c4ca9df1  cclib-dvb_gopt_a.out
    7247019590c0a75c5fe54416a2a0bbfc64b32b7b2d3dd372777dd1673cc4c0b2  cclib-dvb_td.out
    4d42ff064e4bd9e165d658174d9d8a39619d2db7c09632fcd08b4ebc91a442e3  cclib-dvb_sp.out
    40ee4f23726cd87a691798aba84bc178a0070320946c0db14996b925b8cfdf6f  cclib-dvb_un_sp.out
    7450708da07cb0dfc4992ecac9ed94d39c8f88f1f58c020a0933d992b7844729  cclib-firefly-dvb_raman.out
    22be513788af2a998f80b641d4613d85de13d3448f71f8502508d5773d3edabe  cclib-nh3_ts_ir.out
    6648877448305f90ad6010a39ab20652fbac9263959bc0a777b1a886721cc61d  cclib-water_ccsd.out
    1112dc3c81d40d5f2d30374a0645480a50b02870c07cc4685c18f709d0162413  cclib-water_mp2.out
