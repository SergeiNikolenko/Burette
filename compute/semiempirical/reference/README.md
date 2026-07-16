# Semi-empirical reference data

`parameters_PM6_MOPAC.csv` is copied byte-for-byte from
`mlxmolkit/rm1/data/parameters_PM6_MOPAC.csv` at upstream commit
`9e7337f6f93c40a39ad0187991151944a4f1e274`. Its SHA-256 is
`c8f9c7e4c5b8d056effd3db1cd2b7bef06726d740678ed5055da00cc805147ff`.

The table is an input to `compute/semiempirical/generate-pm6-parameters.mjs`.
It is not parsed by the production runtime. The generated Rust table keeps
only the 40 elements that have a nonzero PM6 `U_ss` value and a defined
valence population in the pinned upstream implementation. As in upstream
`pm6_params.py`, the three rounded iodine d fields are replaced by the more
precise authoritative OpenMOPAC values before Rust generation.

The upstream mlxmolkit MIT license and attribution apply. The values originate
from the OpenMOPAC PM6 parameterization; its Apache-2.0 attribution is recorded
in `THIRD_PARTY_NOTICES.md` and the provenance ledger.

`w_integrals.py` is a byte-identical reference copy from the same mlxmolkit
commit, SHA-256
`4ba88f9befacb88593f522fc2de937dfd34c8d667b4d04b88b1a3a593f315b9f`.
Only its three verified 243-entry integer lookup maps are mechanically
generated into Rust. Production uses the independent typed Rust equations and
does not load or execute this Python file.
