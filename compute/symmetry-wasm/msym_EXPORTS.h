// libmsym's CMake build generates this header to set symbol visibility. The
// WebAssembly build links statically and exports wrapper symbols explicitly.
#ifndef MSYM_EXPORT
#define MSYM_EXPORT
#endif
