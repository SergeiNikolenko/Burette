# Six additional spectra: plotting reference

Pinned Avogadro source: d250eb3c62a61470b1e0cdf205dcfe26b06f991f,
https://github.com/OpenChemistry/avogadrolibs/blob/d250eb3c62a61470b1e0cdf205dcfe26b06f991f/avogadro/qtplugins/spectra/spectradialog.cpp
The C++ oracle copies scaleAndBlur/closestTo verbatim and preserves the positive
updatePlot float sum/grid; none of these six types uses IR transmission conversion.
Its inputs are explicit synthetic native-matrix controls, not quantum output.

Rebuild and regenerate all six full positive grids:
`clang++ -std=c++17 -O0 tests/support/scientific-spectra-oracle.cpp -o /tmp/scientific-spectra-oracle`
`python3 tests/support/regenerate-scientific-spectra.py /tmp/scientific-spectra-oracle`
Reader-unit conversions follow qcschema.cpp450–457; source nm/cm^-1 numbers stay
unchanged in raw data/export and are converted to eV only for display.
The six fixed golden grids accept normalized absolute/relative error2e-6. This is
not a universal cancellation bound: C++ expf and rounded JS double exp can differ
one ULP. Signed signals near zero can amplify relative error. No normalization,
clipping, unit-area substitution, or changed grid conceals a discrepancy.

The native unsigned loop and nonnegative Qt widget minima lose valid negative
DOS/NMR ranges. Signed half-away rounded indices repair them; negative-range
regressions use source position/FWHM/symmetry/endpoint invariants rather than copy
platform-dependent unsigned conversion. O default165000 and MCD65000 samples fit
the explicit200000-point/100000000-evaluation budget without silent coarsening.

Qt QDoubleSpinBox defaults to0..99.99. The pinned peakWidth widget only sets its
minimum0.01, so native MCD setValue100 is effectively99.99. Compatibility uses
99.99; explicit mathematical width100 remains supported. Official behavior:
https://doc.qt.io/qt-6/qdoublespinbox.html#maximum-prop
Qt6.8.3 qspinbox.cpp661–665,1171–1179 and qabstractspinbox.cpp1712–1720,1754
show setValue→bound. This is static primary-source evidence, not a Qt app build.
The offset widget likewise clips authored NMR references outside0..99.99.
The exact authored approximate references and signed NMR ranges are deliberately
repaired, editable scientific defaults, not observed-widget parity or universal
physical calibration. Raw source ppm/atom references are exported separately
from actual display reference/scale/offset/settings. No isotope is inferred.
