# Direct Gaussian, QCSchema and XYZ metadata readers

`gaussian-water-optimization.log` contains ordered numerical table excerpts from
[cclib-data water.log](https://github.com/cclib/cclib-data/blob/14185665297fb87252274bc659943b9305c7e33e/Gaussian/Gaussian16/water.log).
The full upstream SHA-256 recorded by the existing reference is `3c5aa038823d5b84b9c314286a7a3d8f13a68bacea3a0028b1a4d21202693f3d`.
The retained banner, orientation tables, SCF/optimization lines and frequency tables preserve numerical values and source order.

`qcschema-water-gradient.json` is the verbatim
[MolSSI gradient reference](https://github.com/MolSSI/QCSchema/blob/c855c2f554bf1b3c8dbc5c502da8e356fb9d4c8b/tests/simple/water_gradient_HF_output.json),
SHA-256 `73b28251edde763490937d303cee0b4c2cf4bf55c566d4139c5e33220ffae451`.
Its BSD-3-Clause license is retained in `qcschema-LICENSE.txt`.

Gaussian printed coordinates are angstrom, SCF energies Hartree and frequencies cm⁻¹; mode vectors retain printed atom order and their own frame.
QCSchema geometry is bohr, energy Hartree and gradients Hartree/bohr; imported forces have the opposite sign and are converted to kcal/mol/angstrom.
Extended XYZ vectors require explicit supported units; unitless comments do not invent energy, time, temperature or vectors.

The direct stage retains atom/frame/value, coordinate, schema and column bounds. The outer dispatcher's binary/16 MiB intake policy, file sniffing, opening and exact Original-byte retention remain separate consumer stages; their original test cases are preserved in the pending-owner evidence packet.
