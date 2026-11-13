# NWChem output fixtures

Burette fixtures generated for this reader with NWChem 7.3.0 (conda-forge build
`b60f1e7`, an ECL-2.0 program; the outputs are Burette test data). Each
`.out` is the unmodified standard output of the `.nw` input beside it:

| File | Calculation | Covers |
| --- | --- | --- |
| `water-opt-freq.out` | RHF/6-31G* optimization, then frequencies | geometry history with line-search SCFs, convergence, eigenvalues, Mulliken charges, dipole, mass-weighted Hessian, projected normal modes and IR (km/mol) |
| `oh-uhf.out` | UHF/6-31G* doublet single point | alpha/beta eigenvalues and occupations |
| `water-scf-fail.out` | RHF/6-31G* with `maxiter 2` | SCF failure (`converged: false`) |
| `methanol-dft-freq.out` | B3LYP/6-31G frequencies at a non-stationary geometry | DFT vector table, imaginary modes, 18 × 18 Hessian |

`cclib-water-mp2.out` is `data/NWChem/basicNWChem7.0/water_mp2.out` from
[cclib](https://github.com/cclib/cclib/tree/0c6e08e0a0d04b308201666793030ef3b77b2973/data/NWChem/basicNWChem7.0),
BSD-3-Clause (`../cclib-LICENSE.txt`), byte-identical (MP2 total energy supersedes SCF).
`cclib-dvb_gopt_hf.out`, `cclib-dvb_gopt_ks.out` and `cclib-dvb_td.out` are `dvb_gopt_hf.out`,
`dvb_gopt_ks.out` and `dvb_td.out` from the same directory, byte-identical:

| File | Calculation | Covers |
| --- | --- | --- |
| `cclib-dvb_gopt_hf.out` | NWChem 7.0 RHF/STO-3G optimization | the final steps' orbitals, Mulliken charges and dipole are printed by the line search before their geometry and bind to it by the repeated SCF energy |
| `cclib-dvb_gopt_ks.out` | NWChem 7.0 B3LYP/STO-3G optimization | the same for a DFT vector table |
| `cclib-dvb_td.out` | NWChem 7.0 B3LYP/STO-3G TDDFT, five roots | root energies, transition dipoles and dipole oscillator strengths |

SHA-256:

    6f9e7c8fa77cd7956d465741558b0bdd5591cd78019510994f2887877cc3c2d5  cclib-dvb_gopt_hf.out
    bfe111f578601841d3487890b1977f0da20d9363c406d88c8ca7f55c265b9a94  cclib-dvb_gopt_ks.out
    a9f553352b6342b87f71aaa0278d2a36b620d46f810a3ee95a99ad233ce69e8e  cclib-dvb_td.out
    b33d8698d05fabd895e06705dcdf543737fde1ab9c97b9b59c3aaf58a9771b0c  cclib-water-mp2.out
    6451acc1e9ba0d76791528daa4a64b98240eed837a88e6b91a3387104f47521a  methanol-dft-freq.out
    a93fcd8c028d30090e16775432d704604e924f6ec4705f3b796ea051bc95bd1e  oh-uhf.out
    43d38e039b7ff9b1ef2c9f48536e9e8800e7520936f1159ef0731a03a78b8a0a  water-opt-freq.out
    19826f276956cca03b99da494083cded2d2d02eda080ba06fcd2fec7f54f4995  water-scf-fail.out

`cclib-reference.json` is the independent oracle (it does not cover `cclib-dvb_gopt_*.out`,
whose tests compare against the printed values): `python ../cclib-reference.py *.out`
with cclib `1.8.1.post1298+0c6e08e0` (commit `0c6e08e0a0d04b308201666793030ef3b77b2973`).
Units: angstrom, Hartree (cclib's eV converted with cclib's own convertor), cm⁻¹, km/mol;
cclib keeps NWChem's mass-weighted Hessian (Hartree/bohr²/kamu) and lists every printed
geometry, including reprints of the same step.
