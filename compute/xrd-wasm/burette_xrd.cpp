// Narrow WebAssembly adapter over Gemmi (project-gemmi/gemmi v0.7.5, MPL-2.0)
// for powder X-ray diffraction. Gemmi enumerates the reflections inside a
// resolution shell (reciproc.hpp) and sums X-ray structure factors from the
// International Tables Vol. C (1992) neutral-atom form factors (it92.hpp,
// sfcalc.hpp). Powder aggregation, Lorentz-polarization and profiles are done
// by the caller.
//
// Every atom of the cell is passed explicitly in space group P1 and the cell
// carries no symmetry images, so no symmetry operation is applied twice.
// Atoms are fully occupied and carry no displacement parameters (B = 0).

#include <gemmi/it92.hpp>
#include <gemmi/reciproc.hpp>
#include <gemmi/sfcalc.hpp>
#include <gemmi/symmetry.hpp>

#include <cmath>
#include <cstdint>

namespace {

enum Status : int32_t {
  kInvalidCell = -1,
  kInvalidAtoms = -2,
  kInvalidShell = -3,
  kSearchTooLarge = -4,
  kCapacityExceeded = -5,
};

// Same bounds as the TypeScript caller, repeated here so the module never
// trusts its input.
constexpr double kMinLength = 1.5;
constexpr double kMaxLength = 1000.0;
constexpr int kMaxAtoms = 2000;
// IT92 Gaussian fits hold for sin(theta)/lambda <= 2 / angstrom, i.e. d >= 0.25.
constexpr double kMinD = 0.25;
constexpr double kMaxSearch = 2.0e7;

bool cell_from(const double* parameters, gemmi::UnitCell& cell) {
  for (int i = 0; i < 6; ++i)
    if (!std::isfinite(parameters[i])) return false;
  for (int i = 0; i < 3; ++i)
    if (parameters[i] < kMinLength || parameters[i] > kMaxLength) return false;
  for (int i = 3; i < 6; ++i)
    if (parameters[i] <= 0.0 || parameters[i] >= 180.0) return false;
  const double ca = std::cos(gemmi::rad(parameters[3]));
  const double cb = std::cos(gemmi::rad(parameters[4]));
  const double cg = std::cos(gemmi::rad(parameters[5]));
  // Squared volume of the unit-edge cell; at or below zero the angles do not close.
  if (1.0 - ca * ca - cb * cb - cg * cg + 2.0 * ca * cb * cg < 1e-9) return false;
  cell.set(parameters[0], parameters[1], parameters[2], parameters[3], parameters[4], parameters[5]);
  return std::isfinite(cell.volume) && cell.volume > 0.0;
}

bool shell_valid(double dmin, double dmax) {
  return std::isfinite(dmin) && dmin >= kMinD && std::isfinite(dmax) && (dmax == 0.0 || dmax > dmin);
}

// Number of (h, k, l) triples for_all_reflections visits; the shell test runs on each.
double search_size(const gemmi::UnitCell& cell, double dmin) {
  const gemmi::Miller limits = cell.get_hkl_limits(dmin);
  return (2.0 * limits[0] + 1.0) * (2.0 * limits[1] + 1.0) * (2.0 * limits[2] + 1.0);
}

const gemmi::SpaceGroup& p1() {
  return *gemmi::find_spacegroup_by_number(1);
}

}  // namespace

extern "C" {

// Reflections with dmin <= d (and d < dmax unless dmax is 0), Friedel mates
// included. Allocates nothing, so callers check budgets before allocating.
int32_t burette_xrd_count(const double* cell_parameters, double dmin, double dmax) {
  gemmi::UnitCell cell;
  if (!cell_from(cell_parameters, cell)) return kInvalidCell;
  if (!shell_valid(dmin, dmax)) return kInvalidShell;
  if (search_size(cell, dmin) > kMaxSearch) return kSearchTooLarge;
  return gemmi::count_reflections(cell, &p1(), dmin, dmax, /*unique=*/false);
}

// Writes Miller indices, d spacings (angstrom) and |F|^2 (electrons^2) of every
// reflection in the shell. `fractional` holds x, y, z per atom; `numbers` the
// atomic numbers. Returns the reflection count or a negative Status.
int32_t burette_xrd_structure_factors(const double* cell_parameters, int32_t atom_count,
                                      const double* fractional, const int32_t* numbers,
                                      double dmin, double dmax, int32_t capacity,
                                      int32_t* miller, double* spacing, double* intensity) {
  gemmi::UnitCell cell;
  if (!cell_from(cell_parameters, cell)) return kInvalidCell;
  if (!shell_valid(dmin, dmax)) return kInvalidShell;
  if (atom_count < 1 || atom_count > kMaxAtoms) return kInvalidAtoms;
  if (search_size(cell, dmin) > kMaxSearch) return kSearchTooLarge;

  gemmi::SmallStructure structure;
  structure.cell = cell;
  structure.sites.resize(atom_count);
  for (int32_t i = 0; i < atom_count; ++i) {
    const double x = fractional[3 * i], y = fractional[3 * i + 1], z = fractional[3 * i + 2];
    if (!std::isfinite(x) || !std::isfinite(y) || !std::isfinite(z)) return kInvalidAtoms;
    const gemmi::Element element(numbers[i]);
    if (numbers[i] < 1 || numbers[i] > 98 || !gemmi::IT92<double>::has(element.elem)) return kInvalidAtoms;
    gemmi::SmallStructure::Site& site = structure.sites[i];
    site.fract = gemmi::Fractional(x, y, z);
    site.element = element;
  }

  gemmi::StructureFactorCalculator<gemmi::IT92<double>> calculator(structure.cell);
  int32_t count = 0;
  bool overflow = false;
  gemmi::for_all_reflections([&](const gemmi::Miller& hkl) {
    if (count >= capacity) { overflow = true; return; }
    miller[3 * count] = hkl[0];
    miller[3 * count + 1] = hkl[1];
    miller[3 * count + 2] = hkl[2];
    spacing[count] = structure.cell.calculate_d(hkl);
    intensity[count] = std::norm(calculator.calculate_sf_from_small_structure(structure, hkl));
    ++count;
  }, structure.cell, &p1(), dmin, dmax, /*unique=*/false);
  return overflow ? kCapacityExceeded : count;
}

}  // extern "C"
