# Relaxed scans and reaction paths

Unmodified program outputs for the scan and IRC readers (`test:reaction-paths`). Each test checks the
reader against the summary table the program printed in the same file.

| File | Program | Job | Source | Bytes | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `relaxed_PES_testCO2.log` | Gaussian 09 D.01 | `opt=(ModRedundant,MaxCycle=10)` scan of the C–O bond `B 1 2 S 10 0.0010`, 11 points; the first two stop at MaxCycle | [cclib-data](https://github.com/cclib/cclib-data) `Gaussian/Gaussian09/relaxed_PES_testCO2.log` at `127b2229`, BSD-3-Clause | 224537 | `172b2cadde7cd373048c1212984cee6d20c2c5b9d90fdf1124656fcaf3e260ea` |
| `HCN-ts-irc.log` | Gaussian 16 | `irc=(rcfc,gradientonly)` of HCN ⇌ HNC on an external machine-learned potential, 10 points each way | [mizu-bai/Gaussian-MOKIT-Molpro](https://github.com/mizu-bai/Gaussian-MOKIT-Molpro) `example/HCN/gau/HCN-ts-irc.log` at `44b8ba51`, BSD-2-Clause | 154413 | `810058e1d0d1bd0a365d9bb20b0e42ced4383feddaccb8bd27f3b43846ad71ae` |
| `sn2_irc.out` | ORCA 6.1.1 | B3LYP-D3BJ/ma-def2-SVP IRC of Cl⁻ + CH₃Br, 28 points with the TS at step 13 | [FriendsofECCE/ECCE](https://github.com/FriendsofECCE/ECCE) `data/client/examples/organic/reactions/orca-sn2_irc/` at `5454f3d8`, Educational Community License 2.0 | 198026 | `baabccf4e475c066d2bf19dd363575d95ed05bf75b6644bfc8425b8ba0535564` |
| `sn2_irc_IRC_Full_trj.xyz` | ORCA 6.1.1 | the same IRC's geometries, each with its energy in the comment line | same directory | 9856 | `51744b73aa6846846aa977af29220756bdf78c877a14723150e25063836fb76c` |
| `dvb_scan_unrelaxed.out` | ORCA 4.2.0 | HF/STO-3G parameter scan of divinylbenzene (`%paras`), 12 points | [cclib-data](https://github.com/cclib/cclib-data) `ORCA/ORCA4.2/dvb_scan_unrelaxed.out` at `127b2229`, BSD-3-Clause | 246749 | `0659d7e5baa4496a8e89dd036d36f6bb8e32a8b01f8f1fcab5e7778c9d2dfab7` |

Gaussian's IRC summary prints energies relative to the TS (here the checkpoint energy, −93.1140196 Eh)
and the reaction coordinate in amu^½·bohr, with the reverse path negative. ORCA prints no reaction
coordinate, so its points are numbered from the TS.
