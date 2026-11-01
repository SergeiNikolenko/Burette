# ORCA property-file fixtures

Byte-identical ORCA property files from MIT-licensed repositories, renamed; each license is
kept beside them as `<prefix>-LICENSE.txt`.

| File | Source (repository @ commit, path) | ORCA | Covers |
| --- | --- | --- | --- |
| `maa-apa-opt.property.txt` | [kmilozeta27/MAA-quantum-chemical-protocol](https://github.com/kmilozeta27/MAA-quantum-chemical-protocol) @ `3fc3b16`, `AP/runs/APA/02_opt/conf_1/opt.property.txt` | 6.1.1 | 7-geometry optimization, gradients, D3 energies, Mulliken/Löwdin, dipole |
| `maa-apa-freq.property.txt` | same, `AP/runs/APA/03_numfreq/conf_1/freq.property.txt` | 6.1.1 | numerical Hessian (42×42), modes, thermochemistry frequencies |
| `radicalpy-nh2.property.txt` | [Spin-Chemistry-Labs/radicalpy](https://github.com/Spin-Chemistry-Labs/radicalpy) @ `3f547bd`, `examples/data/NH2_A.property.txt` | 6.0.0 | upper-case keys, a block reopened without `$End`, repeated per-nucleus keys |
| `pyepfd-co2-opt-freq_property.txt` | [arpank-2380/PyEPFD](https://github.com/arpank-2380/PyEPFD) @ `18b2901`, `tutorials/1_CO2/6_stochastic_orca/orca-opt-freq_property.txt` | 5.0.4 | `!PROPERTIES!` layout, Mayer charges, normal modes |
| `pyepfd-co2-opt-freq.hess` | same, `tutorials/1_CO2/6_stochastic_orca/orca-opt-freq.hess` | 5.0.4 | linear-molecule Hessian; six-column IR rows (km/mol) |
| `si2h4-opt-freq_property.txt`, `si2h4-opt-freq_trj.xyz` | [shabab-kabir/Density_Functional_Theory_Research](https://github.com/shabab-kabir/Density_Functional_Theory_Research) @ `0607a6d`, `ORCA/ORCA_INP/Si2H4_property.txt` and `Si2H4_trj.xyz` | 5 | 12 geometries with D3BJ corrections; the trajectory states each final energy |

Oracle: `cclib-reference.json` is `python ../cclib-reference.py *.out` (cclib
`1.8.1.post1298+0c6e08e0`) on the ORCA outputs of the same runs, which are not committed:

    34e1a7883c9637f3016c9bd82c04664fa5c22b64feae5842531d79795d90697c  maa-apa-opt.out      (opt.out)
    d2b5d870b364cad16e97f991368d9ca25845577448221b668517ecabbb045727  maa-apa-freq.out     (freq.out)
    9bdc286938493fab395bfcedbd060ee056953e360183790013f4c44745c188bd  radicalpy-nh2.out    (NH2_A.out)
    ddecadc0c38b33c428d24e3a778422b8551ae498edcb35c7b3246ca7a641fdbf  pyepfd-co2-opt-freq.out (orca-opt-freq.out)

The Si2H4 run has no committed output; its `_trj.xyz` comments are ORCA's own final energies.
ORCA states no atomic masses in property files; the frequency test uses standard atomic weights,
checked against the file's own thermochemistry total mass.

SHA-256:

    9bc06ead66011f291861c36ee02e205ccf268003141d7cff38400a43f311d909  maa-apa-freq.property.txt
    42a538e1fd3a28938de1ea32f7f7fde95c3c83ccd40fdab50cb0bd17d2e1fa19  maa-apa-opt.property.txt
    d8a0ddb61a24f784d9835d9cbfc281f578a3ca11f17a15e36b80a08591ace27d  pyepfd-co2-opt-freq_property.txt
    42f07c8b9cf1d55682b13bfbdb1921e151ca7dc435ac4548ccd5cb18873b9ee8  pyepfd-co2-opt-freq.hess
    22d5bf99cf7441b8f747abecef73baac4da2383aa0453fdb5fc1d99c2855c65f  radicalpy-nh2.property.txt
    c69c72a8b7404289ccd08c8ed0dfcc72ae543ca362f0eb39c899dc0b31d02c43  si2h4-opt-freq_property.txt
    4c0cf9013925529ba501851101d363001f8adeac9491f2c611a18c6f3b1842fb  si2h4-opt-freq_trj.xyz
