# MDSmooth computational core

This directory contains the ChimeraX-independent numerical core adapted from
[`LiamKozma/ChimeraX-MDSmooth`](https://github.com/LiamKozma/ChimeraX-MDSmooth),
upstream commit `1babbe0319b374a587e31fb4191e97bec65e90ce`.

The upstream project is MIT licensed; the original license is preserved in
`LICENSE`. Burrete keeps the numerical filtering, PCA/tICA, kinetic MSM/PCCA+,
and isolated DeepTICA worker separate from application and viewer code so the
science can be tested without ChimeraX.

Application-specific trajectory loading and result serialization belong in the
Burrete runner adjacent to this package, not in these upstream-derived modules.
