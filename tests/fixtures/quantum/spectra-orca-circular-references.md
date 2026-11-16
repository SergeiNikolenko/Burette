# ORCA circular-spectrum format core

The source reference is OpenChemistry/avogadrolibs commit
`d250eb3c62a61470b1e0cdf205dcfe26b06f991f`, `quantumio/orca.cpp:806–832`
(VCD three-column mode/frequency/signal table) and `:1467–1504`
(MCD whitespace-delimited frequency/signal/absorption triples). VCD header
search uses the native ten-line bound. An existing coordinate/vibration reader
must supply exactly one source vibration set and its already parsed indexed
modes; equal mode counts or frequencies are not a source/frame identity.

The VCD primary frequency follows its declared indexed source mode, as in the
native matrix producer. The printed VCD frequency is retained separately, and
rows must agree within the existing ORCA IR reader's 0.02 cm^-1 print tolerance.
No uncomputed mode is filled with zero. Units are copied only when the table
declares them; otherwise the signed signal has an unspecified unit.

The MCD parser accepts only explicitly supplied text. It never guesses a
sibling file name, opens a path, performs a fetch or expands access. Absorption
is retained as an auxiliary raw column; the native parser discards it. A
decreasing frequency begins another returned monotonic block. Native display
selects the first block; other blocks are returned separately, without assigning
them a physical interpretation or silently dropping source data. Browser file
pairing/selection and original companion-byte ownership are later prerequisites.

All tests in this stage use authored format/identity/refusal cases. No actual
ORCA VCD or MCD output fixture has been established, so this is a bounded pure
format core, not proof of a real-file reader/normal-source/UI activation. The
real FCHK `ala-vcd.fchk` has further Vib-E2 blocks whose VCD layout remains
unverified here; no block is guessed. All-six native matrix/data API support
exists independently. DOS file-producer coverage also remains open.

Existing 16 MiB UTF8 input and 10,000 accumulated source-row bounds reject work
rather than publishing a partial table or selecting a coarser range. Original
source text, signals and absorption remain unchanged. Source offsets address the
unchanged input string for the owning normal reader to associate with frames.

Header search refuses crossing the next known ORCA source section. A malformed
VCD heading must not consume another VCD table or relabel a later IR signal,
even when the later column names and mode numbers happen to match.
