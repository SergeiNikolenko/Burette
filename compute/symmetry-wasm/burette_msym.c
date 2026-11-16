// Narrow WebAssembly boundary around libmsym point-group detection and
// element symmetrization. One call analyses one molecule; the results are
// copied into wrapper-owned buffers and the libmsym context is released
// before returning, so no libmsym pointer crosses into JavaScript.
//
// Inputs keep the caller's atom order. Every element carries its input index
// in msym_element_t.id, and that id (not pointer arithmetic) maps equivalence
// sets and symmetrized coordinates back to the caller.

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "context.h"
#include "msym.h"
#include "symmetry.h"
#include "symop.h"

#define BM_MAX_ATOMS 256
#define BM_OPERATION_STRIDE 17
#define BM_NAME_LENGTH 16

enum bm_preset {
  BM_PRESET_LIBMSYM_DEFAULT = 0,
  BM_PRESET_AVOGADRO_NORMAL = 1,
  BM_PRESET_AVOGADRO_LOOSE = 2,
  BM_PRESET_AVOGADRO_VERY_LOOSE = 3
};

// Wrapper-level validation failures use codes outside libmsym's msym_error_t
// range (libmsym errors are 0 or negative).
enum bm_status {
  BM_STATUS_INVALID_COUNT = 1001,
  BM_STATUS_INVALID_PRESET = 1002,
  BM_STATUS_ALLOCATION = 1003,
  BM_STATUS_MAPPING = 1004
};

// The Avogadro presets are copied verbatim from avogadrolibs
// avogadro/qtplugins/symmetry/symmetrywidget.cpp (BSD-3-Clause) so a later
// UI can offer the same tolerance choices. Avogadro's "tight" preset differs
// from libmsym's defaults only in the orbital orthogonalization threshold,
// which this wrapper never uses (no SALCs), so libmsym's own defaults stand
// in for it.
static const msym_thresholds_t avogadro_normal = {
    .zero = 1.0e-2, .geometry = 1.0e-2, .angle = 1.0e-2, .equivalence = 6.3e-3,
    .eigfact = 1.0e-3, .permutation = 1.58e-2, .orthogonalization = 0.1};
static const msym_thresholds_t avogadro_loose = {
    .zero = 0.06, .geometry = 0.1, .angle = 0.06, .equivalence = 0.025,
    .eigfact = 1.0e-3, .permutation = 1.0e-1, .orthogonalization = 0.1};
static const msym_thresholds_t avogadro_very_loose = {
    .zero = 0.1, .geometry = 0.1, .angle = 0.1, .equivalence = 0.075,
    .eigfact = 1.0e-3, .permutation = 1.0e-1, .orthogonalization = 0.1};

static char point_group[BM_NAME_LENGTH];
static char error_text[512];
static int operation_count;
static double *operations;
static char (*operation_names)[BM_NAME_LENGTH];
static int set_count;
static int *set_offsets;
static int *set_atoms;
static double *set_errors;
static int atom_count;
static double *coordinates;
static double symmetrization_error;
// libmsym's operations act about the mass-weighted center of the input.
static double center[3];

static void bm_clear(void) {
  free(operations);
  free(operation_names);
  free(set_offsets);
  free(set_atoms);
  free(set_errors);
  free(coordinates);
  operations = NULL;
  operation_names = NULL;
  set_offsets = NULL;
  set_atoms = NULL;
  set_errors = NULL;
  coordinates = NULL;
  operation_count = 0;
  set_count = 0;
  atom_count = 0;
  symmetrization_error = 0.0;
  center[0] = center[1] = center[2] = 0.0;
  point_group[0] = '\0';
  error_text[0] = '\0';
}

static int bm_fail(msym_context ctx, int status, const char *message) {
  if (message != NULL) {
    strncpy(error_text, message, sizeof(error_text) - 1);
  } else {
    const char *details = msymGetErrorDetails();
    const char *kind = msymErrorString((msym_error_t)status);
    if (details != NULL && details[0] != '\0') {
      strncpy(error_text, details, sizeof(error_text) - 1);
    } else if (kind != NULL) {
      strncpy(error_text, kind, sizeof(error_text) - 1);
    }
  }
  error_text[sizeof(error_text) - 1] = '\0';
  if (ctx != NULL) msymReleaseContext(ctx);
  return status;
}

static const msym_thresholds_t *bm_thresholds(int preset) {
  switch (preset) {
    case BM_PRESET_LIBMSYM_DEFAULT: return msymGetDefaultThresholds();
    case BM_PRESET_AVOGADRO_NORMAL: return &avogadro_normal;
    case BM_PRESET_AVOGADRO_LOOSE: return &avogadro_loose;
    case BM_PRESET_AVOGADRO_VERY_LOOSE: return &avogadro_very_loose;
    default: return NULL;
  }
}

static int bm_copy_symmetrized(msym_context ctx) {
  msym_element_t *elements = NULL;
  int length = 0;
  msym_error_t ret = msymGetElements(ctx, &length, &elements);
  if (ret != MSYM_SUCCESS) return bm_fail(ctx, ret, NULL);
  if (length != atom_count) return bm_fail(ctx, BM_STATUS_MAPPING, "libmsym returned a different atom count.");
  for (int i = 0; i < length; i++) {
    intptr_t index = (intptr_t)elements[i].id;
    if (index < 0 || index >= atom_count) return bm_fail(ctx, BM_STATUS_MAPPING, "libmsym returned an unknown atom id.");
    memcpy(&coordinates[index * 3], elements[i].v, sizeof(double[3]));
  }
  return MSYM_SUCCESS;
}

// Results for groups that leave every atom in its own orbit and need no
// coordinate change: C1 (identity only) and Kh (a single atom, whose
// continuous operations cannot be enumerated).
static int bm_trivial_result(const char *name, int with_identity) {
  strncpy(point_group, name, sizeof(point_group) - 1);
  set_count = atom_count;
  set_offsets = calloc((size_t)atom_count + 1, sizeof(int));
  set_errors = calloc((size_t)atom_count, sizeof(double));
  set_atoms = malloc(sizeof(int) * (size_t)atom_count);
  if (set_offsets == NULL || set_errors == NULL || set_atoms == NULL) return bm_fail(NULL, BM_STATUS_ALLOCATION, "Memory allocation failed.");
  for (int i = 0; i <= atom_count; i++) set_offsets[i] = i;
  for (int i = 0; i < atom_count; i++) set_atoms[i] = i;
  if (with_identity) {
    operation_count = 1;
    operations = calloc(BM_OPERATION_STRIDE, sizeof(double));
    operation_names = calloc(1, sizeof(*operation_names));
    if (operations == NULL || operation_names == NULL) return bm_fail(NULL, BM_STATUS_ALLOCATION, "Memory allocation failed.");
    operations[0] = MSYM_SYMMETRY_OPERATION_TYPE_IDENTITY;
    operations[1] = 1;
    operations[2] = 1;
    operations[8] = operations[12] = operations[16] = 1.0;
    strcpy(operation_names[0], "E");
  }
  return MSYM_SUCCESS;
}

// libmsym 85e4723 cannot finish msymFindSymmetry for a molecule whose only
// symmetry operation is the identity: determinePointGroup() classifies it as
// Cn with n = 1 and no primary axis, and transformAxes() then fails in
// reorientAxes() with MSYM_POINT_GROUP_ERROR. This repeats libmsym's own
// operation search (msymFindEquivalenceSets + findSymmetryOperations, the
// first two stages of msymFindSymmetry) with the same thresholds, and reports
// C1 only when that search found no operation other than the identity.
static int bm_only_identity(const msym_thresholds_t *thresholds, int count, msym_element_t *elements) {
  int only_identity = 0;
  int esl = 0, sopsl = 0;
  msym_equivalence_set_t *es = NULL;
  msym_symmetry_operation_t *sops = NULL;
  msym_thresholds_t *t = NULL;
  msym_context ctx = msymCreateContext();
  if (ctx == NULL) return 0;
  if (msymSetThresholds(ctx, thresholds) == MSYM_SUCCESS &&
      msymSetElements(ctx, count, elements) == MSYM_SUCCESS &&
      msymFindEquivalenceSets(ctx) == MSYM_SUCCESS &&
      ctxGetEquivalenceSets(ctx, &esl, &es) == MSYM_SUCCESS &&
      ctxGetThresholds(ctx, &t) == MSYM_SUCCESS &&
      findSymmetryOperations(esl, es, t, &sopsl, &sops) == MSYM_SUCCESS) {
    // findSymmetryOperations lists the non-identity operations it finds;
    // msymFindSymmetry adds the identity later, when it builds the group.
    only_identity = 1;
    for (int i = 0; i < sopsl; i++) {
      if (sops[i].type != MSYM_SYMMETRY_OPERATION_TYPE_IDENTITY) only_identity = 0;
    }
  }
  free(sops);
  msymReleaseContext(ctx);
  return only_identity;
}

static int bm_copy_detection(msym_context ctx, int count) {
  msym_error_t ret = msymGetPointGroupName(ctx, sizeof(point_group), point_group);
  if (ret != MSYM_SUCCESS) return bm_fail(ctx, ret, NULL);

  const msym_symmetry_operation_t *sops = NULL;
  ret = msymGetSymmetryOperations(ctx, &operation_count, &sops);
  if (ret != MSYM_SUCCESS) return bm_fail(ctx, ret, NULL);
  operations = calloc((size_t)operation_count, sizeof(double) * BM_OPERATION_STRIDE);
  operation_names = calloc((size_t)operation_count, sizeof(*operation_names));
  if (operations == NULL || operation_names == NULL) return bm_fail(ctx, BM_STATUS_ALLOCATION, "Memory allocation failed.");
  for (int i = 0; i < operation_count; i++) {
    msym_symmetry_operation_t op = sops[i];
    double *out = &operations[i * BM_OPERATION_STRIDE];
    out[0] = op.type;
    out[1] = op.order;
    out[2] = op.power;
    out[3] = op.orientation;
    out[4] = op.cla;
    memcpy(&out[5], op.v, sizeof(double[3]));
    // Order 0 marks libmsym's continuous C∞/S∞ axis of a linear group. Its
    // "matrix" is a projection, not an orthogonal operation, so it is
    // reported as NaN and the caller treats the axis as continuous.
    int continuous = (op.type == MSYM_SYMMETRY_OPERATION_TYPE_PROPER_ROTATION || op.type == MSYM_SYMMETRY_OPERATION_TYPE_IMPROPER_ROTATION) && op.order == 0;
    if (continuous) {
      for (int k = 0; k < 9; k++) out[8 + k] = NAN;
    } else {
      double m[3][3];
      symmetryOperationMatrix(&op, m);
      memcpy(&out[8], m, sizeof(double[9]));
    }
    symmetryOperationName(&op, BM_NAME_LENGTH, operation_names[i]);
  }

  const msym_equivalence_set_t *sets = NULL;
  ret = msymGetEquivalenceSets(ctx, &set_count, &sets);
  if (ret != MSYM_SUCCESS) return bm_fail(ctx, ret, NULL);
  set_offsets = calloc((size_t)set_count + 1, sizeof(int));
  set_errors = calloc((size_t)set_count, sizeof(double));
  set_atoms = malloc(sizeof(int) * (size_t)count);
  int *seen = calloc((size_t)count, sizeof(int));
  if (set_offsets == NULL || set_errors == NULL || set_atoms == NULL || seen == NULL) {
    free(seen);
    return bm_fail(ctx, BM_STATUS_ALLOCATION, "Memory allocation failed.");
  }
  int cursor = 0;
  for (int i = 0; i < set_count; i++) {
    set_offsets[i] = cursor;
    set_errors[i] = sets[i].err;
    for (int j = 0; j < sets[i].length; j++) {
      intptr_t index = (intptr_t)sets[i].elements[j]->id;
      if (index < 0 || index >= count || seen[index] || cursor >= count) {
        free(seen);
        return bm_fail(ctx, BM_STATUS_MAPPING, "Equivalence sets do not partition the atoms.");
      }
      seen[index] = 1;
      set_atoms[cursor++] = (int)index;
    }
  }
  set_offsets[set_count] = cursor;
  free(seen);
  if (cursor != count) return bm_fail(ctx, BM_STATUS_MAPPING, "Equivalence sets do not cover every atom.");
  return MSYM_SUCCESS;
}

// Analyse `count` atoms. `charges` are nuclear charges, `masses` are mass
// numbers or 0 for libmsym's element default, and `xyz` holds packed
// Cartesian coordinates in angstrom. When `symmetrize` is non-zero the
// detected point group is imposed with msymSymmetrizeElements and the
// coordinate buffer holds the symmetrized positions in the input frame;
// otherwise it holds the input positions unchanged.
int burette_msym_analyze(int count, const int *charges, const double *masses, const double *xyz, int preset, int symmetrize) {
  bm_clear();
  // libmsym keeps its error details in a global; clear the previous call's.
  msymSetErrorDetails("%s", "");
  if (count < 1 || count > BM_MAX_ATOMS) return bm_fail(NULL, BM_STATUS_INVALID_COUNT, "Atom count is outside the supported range.");
  const msym_thresholds_t *thresholds = bm_thresholds(preset);
  if (thresholds == NULL) return bm_fail(NULL, BM_STATUS_INVALID_PRESET, "Unknown threshold preset.");

  coordinates = malloc(sizeof(double) * 3 * (size_t)count);
  if (coordinates == NULL) return bm_fail(NULL, BM_STATUS_ALLOCATION, "Memory allocation failed.");
  memcpy(coordinates, xyz, sizeof(double) * 3 * (size_t)count);
  atom_count = count;
  if (count == 1) {
    memcpy(center, xyz, sizeof(double[3]));
    return bm_trivial_result("Kh", 0);
  }

  msym_element_t *elements = calloc((size_t)count, sizeof(msym_element_t));
  if (elements == NULL) return bm_fail(NULL, BM_STATUS_ALLOCATION, "Memory allocation failed.");
  for (int i = 0; i < count; i++) {
    elements[i].id = (void *)(intptr_t)i;
    elements[i].n = charges[i];
    elements[i].m = masses[i];
    memcpy(elements[i].v, &xyz[i * 3], sizeof(double[3]));
  }

  msym_context ctx = msymCreateContext();
  if (ctx == NULL) {
    free(elements);
    return bm_fail(NULL, BM_STATUS_ALLOCATION, "libmsym context allocation failed.");
  }
  msym_error_t ret = msymSetThresholds(ctx, thresholds);
  if (ret == MSYM_SUCCESS) ret = msymSetElements(ctx, count, elements);
  if (ret == MSYM_SUCCESS) ret = msymGetCenterOfMass(ctx, center);
  if (ret == MSYM_SUCCESS) ret = msymFindSymmetry(ctx);
  if (ret == MSYM_POINT_GROUP_ERROR && bm_only_identity(thresholds, count, elements)) {
    free(elements);
    msymReleaseContext(ctx);
    return bm_trivial_result("C1", 1);
  }
  free(elements);
  if (ret != MSYM_SUCCESS) return bm_fail(ctx, ret, NULL);

  int copied = bm_copy_detection(ctx, count);
  if (copied != MSYM_SUCCESS) return copied;
  if (symmetrize) {
    ret = msymSymmetrizeElements(ctx, &symmetrization_error);
    if (ret != MSYM_SUCCESS) return bm_fail(ctx, ret, NULL);
    copied = bm_copy_symmetrized(ctx);
    if (copied != MSYM_SUCCESS) return copied;
  }
  msymReleaseContext(ctx);
  return MSYM_SUCCESS;
}

const char *burette_msym_error(void) { return error_text; }
const char *burette_msym_point_group(void) { return point_group; }
int burette_msym_operation_count(void) { return operation_count; }
const double *burette_msym_operations(void) { return operations; }
const char *burette_msym_operation_name(int index) {
  return index >= 0 && index < operation_count ? operation_names[index] : "";
}
int burette_msym_set_count(void) { return set_count; }
const int *burette_msym_set_offsets(void) { return set_offsets; }
const int *burette_msym_set_atoms(void) { return set_atoms; }
const double *burette_msym_set_errors(void) { return set_errors; }
const double *burette_msym_coordinates(void) { return coordinates; }
double burette_msym_symmetrization_error(void) { return symmetrization_error; }
const double *burette_msym_center(void) { return center; }
void burette_msym_release(void) { bm_clear(); }
