# Cube UI history fixture

This 504-byte, three-field Cube is the retained actual Browser acceptance source
(SHA-256 `50aa03d21a740f26e5af867c52a114a17f2896b1b8a5997059befaeaa2baea1b`).
The independent oracle uses integer lattice coordinates: field 7 is
`2 - (x-1)^2 - (y-1)^2 - (z-1)^2`; field 11 moves its center to x=2;
field 17 is three times field 7. Signed axes specify Angstrom; the oblique
matrix and three atom positions are recorded explicitly in `oracle.json`.
