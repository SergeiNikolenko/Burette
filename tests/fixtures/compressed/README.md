# Compressed molecular fixtures

Small files written by the reference command-line tools (GNU gzip, XZ Utils 5.8,
Zstandard 1.5.7) for the browser's compressed-file reader. Each decodes to a
sample in `samples/` byte for byte; regenerate from the repository root with:

```sh
cd tests/fixtures/compressed
P=../../../samples
gzip -9n -c $P/mini.pdb > mini.pdb.gz
head -c 400 $P/mini.pdb | gzip -9n > mini-members.pdb.gz          # two gzip members
tail -c +401 $P/mini.pdb | gzip -9n >> mini-members.pdb.gz
xz -9 -c $P/structures/small-molecules/caffeine.sdf > caffeine.sdf.xz
head -c 50 $P/mini.xyz | xz -c > mini-streams.xyz.xz              # two XZ streams
tail -c +51 $P/mini.xyz | xz -c >> mini-streams.xyz.xz
zstd -q -19 -c $P/mini.cif > mini.cif.zst
head -c 400 $P/mini.pdb | zstd -q -c > mini-frames.pdb.zst        # two Zstandard frames
tail -c +401 $P/mini.pdb | zstd -q -c >> mini-frames.pdb.zst
gzip -9n -c ../quantum/gaussian16-water-raman.fchk > water-raman.fchk.gz
```

Truncated, corrupt, mislabelled and gzip/Zstandard oversized inputs are derived from these in
`tests/test-compressed-files.test.ts`.

Inputs the reader must refuse, from XZ Utils:

```sh
xz -c --check=sha256 $P/mini.xyz > sha256-check.xyz.xz       # integrity check xz-embedded lacks
xz -c --lzma2=dict=128MiB $P/mini.xyz > dict-128mib.xyz.xz   # dictionary over the 64 MiB limit
head -c 68157440 /dev/zero | tr '\0' ' ' | xz -9 -c > spaces-65mib.xyz.xz  # 65 MiB once decoded
```
