# Packaged Metal runtime staging directory

Release and local package builds regenerate this directory inside their
isolated build tree and package it as `ComputeMetal`. The build fails closed
when the active Xcode installation cannot execute the offline Metal compiler.
For an explicit standalone generation, run
`compute/metal/build-metallib.sh compute/metal/runtime` with the reviewed Xcode
Metal Toolchain.

Generated pointers, AIR files, metallibs, and build metadata are release
artifacts and are not committed to source control.
