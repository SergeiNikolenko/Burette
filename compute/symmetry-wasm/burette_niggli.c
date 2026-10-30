// Narrow WebAssembly boundary around spglib's Niggli reduction.
//
// spglib's public spg_niggli_reduce() copies a double[3][3] lattice into a
// flat array and calls niggli_reduce(vals, symprec, -1). This wrapper makes
// the same call so only niggli.c needs to be compiled; the rest of spglib
// (space-group search, databases) stays out of the binary.
//
// The lattice uses spglib's convention: lattice[3 * i + j] is Cartesian
// component i of basis vector j (basis vectors are columns). niggli_reduce()
// returns only the reduced lattice; the integer transformation is derived and
// verified by the JavaScript caller.

#include "niggli.h"

int burette_niggli_reduce(double *lattice, double eps) {
  return niggli_reduce(lattice, eps, -1);
}
