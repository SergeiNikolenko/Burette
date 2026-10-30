# Vibrational plotting oracle

Pinned OpenChemistry/avogadrolibs revision d250eb3c62a61470b1e0cdf205dcfe26b06f991f.
`tests/support/vibrational-spectrum-oracle.cpp` copies `scaleAndBlur` and `closestTo`
verbatim from avogadro/qtplugins/spectra/spectradialog.cpp; see avogadro-spectra-LICENSE.txt.
The harness preserves updatePlot's float summation, grid and IR display conversion.
No Qt build is needed: `clang++ -std=c++17 -O0 tests/support/vibrational-spectrum-oracle.cpp -o /tmp/spectrum-oracle`.
Input: irFlag scale offset width start end count, then frequency/intensity pairs.
Output: one x/smoothed/raw row per 1 cm^-1 sample, rounded endpoints, upper excluded.
Golden JSON contains those input modes/options and complete output rows. Water and
methane modes are verified against the actual pinned fixtures by the test itself.

Preprocessing audit: core/molecule.cpp:1893-1921 stores quantities unchanged;
qtplugins/spectra/spectra.cpp:123-158 constructs complete frequency/intensity matrices;
spectradialog.cpp:580-582 copies the map, :357-378 reads columns unchanged.
No max normalization precedes :892-950. IR forces maxIntensity=100, then uses
100*(1-sum/125); raw uses100*(1-sum/100). This display convention is NOT calculated
physical transmittance. Strong overlaps can be negative and are not clamped.
Raman Gaussian height retains the source activity unit. All raw exported source
quantities remain untouched. T-squared is not substituted for missing IR km/mol.

For the six fixed golden cases, acceptance allows relative/absolute float-rounding
error 2e-6 against C++ libm. This is not a universal IR error bound: one-ulp expf
versus JavaScript double-exp rounding can be amplified near zero by the IR
subtraction (independent probe: 1.546142578 versus 1.546136498, relative 3.93e-6). It does not permit area normalization, reciprocal-scale reversal, independent
max scaling, clipping or a changed sampling grid. Both original unit-area helper
cases remain unchanged and are explicitly additional-mode regression controls.
