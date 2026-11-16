# ORCA text output fixtures

Byte-identical ORCA outputs from
[cclib](https://github.com/cclib/cclib/tree/0c6e08e0a0d04b308201666793030ef3b77b2973/data/ORCA),
BSD-3-Clause (`../cclib-LICENSE.txt`), renamed with the ORCA version.

| File | Source | Covers |
| --- | --- | --- |
| `cclib-orca5-dvb_ir.out` | `basicORCA5.0/dvb_ir.out` | Mulliken and Löwdin charges, total dipole, thermochemistry |
| `cclib-orca6-dvb_ir.out` | `basicORCA6.0/dvb_ir.out` | the same in ORCA 6 spacing |
| `cclib-orca5-dvb_td.out` | `basicORCA5.0/dvb_td.out` | TDDFT with spin-forbidden triplet rows and the plain `CD SPECTRUM` title |
| `cclib-orca6-dvb_eom_ccsd.log` | `basicORCA6.0/dvb_eom_ccsd.log` | EOM-CCSD right, left and left-right tables, the last ending in a footnote |
| `cclib-orca6-dvb_sp_un_dft.out` | `basicORCA6.0/dvb_sp_un_dft.out` | UKS cation: Mulliken, Löwdin and Hirshfeld spin populations, ⟨S²⟩, charge 1 and multiplicity 2 |
| `cclib-orca6-dvb_gopt.out` | `basicORCA6.0/dvb_gopt.out` | optimization with a Cartesian gradient per step |

SHA-256:

    deb64567281a4673849812a63fc7b1147c33d1c4ad3b67f6b3bf7ec03ab1046c  cclib-orca5-dvb_ir.out
    fe363d324d008cdba083402280ab9a2731665c8a14e1ea37540e7b4c4d996b08  cclib-orca6-dvb_ir.out
    b4262a21e11ea441551f465f4ae04aee0d4f9ddf35e6a94c0309400c924f17f6  cclib-orca5-dvb_td.out
    71ae659e8c92b895b9ddf8a8601f8e8a5e38de4eaf6dea3585f94fe0a58c9218  cclib-orca6-dvb_eom_ccsd.log
    05da3eb11c7030fb788f3b92398f432fb5b08a61f365137b7f9cc54088748b68  cclib-orca6-dvb_sp_un_dft.out
    3f1722c8807dc5198f978119056cec1e16a02bca80ea0ef21d1d222ea0871c07  cclib-orca6-dvb_gopt.out
