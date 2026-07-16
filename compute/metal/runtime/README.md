# Packaged Metal runtime staging directory

Release builds package this directory as `ComputeMetal`. Before a production
build, run `compute/metal/build-metallib.sh compute/metal/runtime` with the
reviewed Xcode Metal Toolchain. The runtime remains unavailable when
`current.json` and its hash-bound generation are absent.

Generated pointers, AIR files, metallibs, and build metadata are release
artifacts and are not committed to source control.
