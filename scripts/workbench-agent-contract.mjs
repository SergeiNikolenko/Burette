// Shared request contract of the `workbench` agent action. The CLI validates a
// request with it before queueing; the browser shell validates it again before
// running anything. Keep both consumers on this one definition.

export const WORKBENCH_AGENT_API_VERSION = 'burette-workbench-agent/v1';

export const WORKBENCH_LIMITS = Object.freeze({
  requestBytes: 256 * 1024,
  responseBytes: 64 * 1024,
  pageSize: 100,
  defaultPageSize: 50,
  activeJobs: 2,
  queuedJobs: 8,
  retainedJobs: 32,
  artifactBytes: 16 * 1024 * 1024,
  jobTimeoutMs: 120_000,
  stringLength: 256,
  constraints: 64,
  optimizationIterations: 1000,
  conformers: 32,
  batchFrames: 64,
  batchAtomFrames: 2048,
});

const FORCE_FIELDS = ['MMFF94', 'MMFF94s', 'UFF'];
// Lennard-Jones needs no bond graph, so it only evaluates or relaxes existing coordinates.
const ENERGY_MODELS = [...FORCE_FIELDS, 'LJ'];
// External models: xTB methods and Avogadro energy packages (package names and model
// identifiers as the desktop plugin manager admits them). They need no bond graph and
// run only in the desktop app when that model is listed and set up; the runner refuses otherwise.
const EXTERNAL_ENERGY_MODEL = /^(?:xtb:(?:gfn2|gfn1|gfnff)|avogadro:[a-z0-9][a-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,63})$/u;
const EXTERNAL_ENERGY_MODEL_FORMS = ['xtb:gfn2', 'xtb:gfn1', 'xtb:gfnff', 'avogadro:<package>/<identifier>'];
const ENERGY_MODEL_PARAMS = [...ENERGY_MODELS, ...EXTERNAL_ENERGY_MODEL_FORMS];
const EXTERNAL_REQUIREMENT = 'External models (xtb:…, avogadro:…) run only in the Burette desktop app with that model available; they need 3D coordinates but no bond graph, and take charge and spin from the structure.';
const OPTIMIZE_METHODS = ['bfgs', 'lbfgs', 'fire', 'abc-fire', 'hybrid'];
const SEED_MAX = 2_147_483_639;

const DOCUMENT_FIELDS = ['documentId', 'expectedSourceRevision'];
const PAGE_FIELDS = ['offset', 'limit'];

// Fields each operation accepts besides `type` and `operation`.
const OPERATION_FIELDS = Object.freeze({
  capabilities: [],
  observe: DOCUMENT_FIELDS,
  atoms: [...DOCUMENT_FIELDS, ...PAGE_FIELDS, 'frameIndex'],
  orbitals: [...DOCUMENT_FIELDS, ...PAGE_FIELDS],
  submit: [...DOCUMENT_FIELDS, 'operationId', 'job'],
  build: ['operationId', 'job'],
  status: ['jobId', 'operationId'],
  jobs: PAGE_FIELDS,
  cancel: ['jobId'],
  export: ['jobId', 'artifact', 'allowStale'],
});

export const WORKBENCH_OPERATIONS = Object.freeze(Object.keys(OPERATION_FIELDS));

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REVISION = /^sha256-[0-9a-f]{64}$/u;
const ARTIFACT = /^[a-z_]{1,32}$/u;
const MAX_INDEX = 10_000_000;

class WorkbenchRequestError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function invalid(message, details = null) {
  throw new WorkbenchRequestError('INVALID_ARGS', message, details);
}

function plainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(value, allowed, label) {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) invalid(`${label} contains unsupported fields; see details.allowedFields.`, {
    unknownFields: unknown.slice(0, 16).map(key => key.slice(0, 128)),
    unknownFieldCount: unknown.length,
    allowedFields: allowed,
  });
}

function integer(value, field, min, max, fallback) {
  if (value === undefined) {
    if (fallback === undefined) invalid(`${field} is required.`);
    return fallback;
  }
  if (!Number.isInteger(value) || value < min || value > max) invalid(`${field} must be an integer from ${min} to ${max}.`);
  return value;
}

function finite(value, field, min, max) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(`${field} must be a number from ${min} to ${max}.`);
  return value;
}

function identifier(value, field, required) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) invalid(`${field} must be 1–128 letters, digits, ".", "_", ":" or "-", starting with a letter or digit.`);
  return value;
}

function documentId(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > WORKBENCH_LIMITS.stringLength) invalid(`documentId must be a non-empty string of at most ${WORKBENCH_LIMITS.stringLength} characters.`);
  return value;
}

function revision(value, required) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !REVISION.test(value)) {
    invalid(required
      ? 'expectedSourceRevision is required: pass the sourceRevision reported by workbench observe.'
      : 'expectedSourceRevision must be a sourceRevision reported by workbench observe (sha256-<64 hex>).');
  }
  return value;
}

function oneOf(value, field, allowed, fallback) {
  if (value === undefined) return fallback;
  if (!allowed.has(value)) invalid(`${field} must be one of ${[...allowed].join(', ')}.`);
  return value;
}

const CONSTRAINT_ATOMS = { freeze: 1, distance: 2, angle: 3, dihedral: 4 };
const ELEMENT_SYMBOL = /^[A-Z][a-z]?$/u;
const BOND_ORDERS = [0, 1, 2, 3, 9];
const STRUCTURE_EXPORT_FORMATS = ['xyz', 'mol', 'cjson'];
const QUANTUM_PROGRAMS = ['orca', 'gaussian', 'psi4', 'cp2k'];
const QUANTUM_TASKS = ['energy', 'optimize', 'frequencies'];
const QUANTUM_KEYWORD = /^[A-Za-z0-9][A-Za-z0-9_+*(),./-]{0,79}$/u;

// One Edit-tab change; indices refer to the structure after the previous edit.
function graphEdit(value, field) {
  if (!plainObject(value)) invalid(`${field} must be an object.`);
  const element = (v, f) => { if (typeof v !== 'string' || !ELEMENT_SYMBOL.test(v)) invalid(`${f} must be an element symbol.`); return v; };
  const vector = (v, f) => {
    if (!Array.isArray(v) || v.length !== 3) invalid(`${f} must be [x, y, z] in angstrom.`);
    return v.map((n, i) => finite(n, `${f}[${i}]`, -1e6, 1e6) ?? invalid(`${f}[${i}] is required.`));
  };
  const atom = (v, f) => integer(v, f, 0, 255);
  const { kind } = value;
  if (kind === 'add_atom') {
    const p = params(value, ['kind', 'element', 'position'], field);
    return { kind, element: element(p.element, `${field}.element`), position: vector(p.position, `${field}.position`) };
  }
  if (kind === 'update_atom') {
    const p = params(value, ['kind', 'index', 'element', 'charge', 'isotope', 'position'], field);
    const edit = defined({ kind, index: atom(p.index, `${field}.index`),
      element: p.element === undefined ? undefined : element(p.element, `${field}.element`),
      charge: p.charge === undefined ? undefined : integer(p.charge, `${field}.charge`, -8, 8),
      isotope: p.isotope === undefined ? undefined : integer(p.isotope, `${field}.isotope`, 0, 300),
      position: p.position === undefined ? undefined : vector(p.position, `${field}.position`) });
    if (Object.keys(edit).length < 3) invalid(`${field} changes nothing; set element, charge, isotope or position.`);
    return edit;
  }
  if (kind === 'delete_atoms') {
    const p = params(value, ['kind', 'indices'], field);
    if (!Array.isArray(p.indices) || !p.indices.length || p.indices.length > 256) invalid(`${field}.indices must list 1–256 atoms.`);
    const indices = p.indices.map((index, i) => atom(index, `${field}.indices[${i}]`));
    if (new Set(indices).size !== indices.length) invalid(`${field}.indices lists an atom twice.`);
    return { kind, indices };
  }
  if (kind === 'set_bond') {
    const p = params(value, ['kind', 'a', 'b', 'order'], field);
    const a = atom(p.a, `${field}.a`), b = atom(p.b, `${field}.b`);
    if (a === b) invalid(`${field} bonds an atom to itself.`);
    if (!BOND_ORDERS.includes(p.order)) invalid(`${field}.order must be 0 (no bond), 1, 2, 3 or 9 (dative).`);
    return { kind, a, b, order: p.order };
  }
  invalid(`${field}.kind must be add_atom, update_atom, delete_atoms or set_bond.`);
}
const MEASUREMENT_KINDS = ['distance', 'angle', 'dihedral'];
const FRAGMENTS = ['smaller', 'first', 'last'];
const AXES = ['x', 'y', 'z'];
const COORDINATE_REQUIREMENT = 'One MOL or SDF record with an explicit bond graph, 1–256 atoms; XYZ, collections and perceived graphs are unsupported. Atom order, graph, stereo flags and metadata are kept; the result is exported, never applied to the document.';
const ORBITAL_FIELDS = ['orbital', 'density', 'spin-density'];
const POINT_GROUP_TOLERANCES = ['tight', 'normal', 'loose', 'very-loose'];
const symmetryTolerance = value => finite(value, 'job.params.toleranceAngstrom', 1e-4, 0.5) ?? 0.01;

const TRANSFORM_FIELDS = Object.freeze({
  set_cell: ['cell', 'keep'], wrap: [], standard_orientation: [], scale_volume: ['volumeCubicAngstrom'], supercell: ['repeats'], niggli: [],
  primitive: ['toleranceAngstrom'], conventional: ['toleranceAngstrom'], symmetrize: ['toleranceAngstrom'], asymmetric_unit: ['toleranceAngstrom'], fill: ['hallNumber'],
});

function crystalTransformParams(p) {
  const operation = oneOf(p.operation, 'job.params.operation', new Set(Object.keys(TRANSFORM_FIELDS)), undefined);
  if (!operation) invalid('job.params.operation is required for crystal_transform.');
  rejectUnknownFields(p, ['operation', ...TRANSFORM_FIELDS[operation]], `crystal_transform ${operation} job.params`);
  if (operation === 'set_cell') {
    const cell = p.cell;
    if (!Array.isArray(cell) || cell.length !== 3 || cell.some(row => !Array.isArray(row) || row.length !== 3 || row.some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e4))) {
      invalid('job.params.cell must be three lattice vectors of three numbers, in angstrom.');
    }
    return { operation, cell: cell.map(row => [...row]), keep: oneOf(p.keep, 'job.params.keep', new Set(['fractional', 'cartesian']), 'fractional') };
  }
  if (operation === 'scale_volume') {
    const volume = finite(p.volumeCubicAngstrom, 'job.params.volumeCubicAngstrom', 1e-3, 1e9);
    if (volume === undefined) invalid('job.params.volumeCubicAngstrom is required for scale_volume.');
    return { operation, volumeCubicAngstrom: volume };
  }
  if (operation === 'supercell') {
    if (!Array.isArray(p.repeats) || p.repeats.length !== 3) invalid('job.params.repeats must be three integers from 1 to 20.');
    return { operation, repeats: p.repeats.map((value, axis) => integer(value, `job.params.repeats[${axis}]`, 1, 20)) };
  }
  if (operation === 'fill') return { operation, hallNumber: integer(p.hallNumber, 'job.params.hallNumber', 1, 530) };
  return TRANSFORM_FIELDS[operation].includes('toleranceAngstrom') ? { operation, toleranceAngstrom: symmetryTolerance(p.toleranceAngstrom) } : { operation };
}

function vector(value, field) {
  if (!Array.isArray(value) || value.length !== 3) invalid(`${field} must be three numbers.`);
  return value.map((item, i) => finite(item, `${field}[${i}]`, -1e6, 1e6) ?? invalid(`${field}[${i}] is required.`));
}

/** An explicit field grid; the evaluator checks its volume and its point and work budgets. */
function grid(value) {
  if (!plainObject(value)) invalid('job.params.grid must be { origin, axes, dimensions }.');
  rejectUnknownFields(value, ['origin', 'axes', 'dimensions'], 'job.params.grid');
  if (!Array.isArray(value.axes) || value.axes.length !== 3) invalid('job.params.grid.axes must be three vectors.');
  if (!Array.isArray(value.dimensions) || value.dimensions.length !== 3) invalid('job.params.grid.dimensions must be three integers.');
  const dimensions = value.dimensions.map((item, i) => integer(item, `job.params.grid.dimensions[${i}]`, 1, 1_000_000));
  if (dimensions[0] * dimensions[1] * dimensions[2] > 1_000_000) invalid('job.params.grid has more than one million points.');
  return { origin: vector(value.origin, 'job.params.grid.origin'), axes: value.axes.map((axis, i) => vector(axis, `job.params.grid.axes[${i}]`)), dimensions };
}

function params(value, allowed, label) {
  const result = value ?? {};
  if (!plainObject(result)) invalid('job.params must be a JSON object.');
  rejectUnknownFields(result, allowed, label);
  return result;
}

function text(value, field, max, pattern) {
  if (typeof value !== 'string' || !value.length || value.length > max || (pattern && !pattern.test(value))) invalid(`${field} must be a string of 1–${max} characters${pattern ? ' in the documented form' : ''}.`);
  return value;
}

function bool(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') invalid(`${field} must be a boolean.`);
  return value;
}

/** Copies the defined entries; optional parameters that were omitted stay absent. */
function defined(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

const POLYMER_END_GROUPS = ['hydrogen', 'methyl', 'hydroxyl', 'phenyl', 'tert-butyl'];
const TACTICITIES = ['isotactic', 'syndiotactic', 'atactic'];
const PEPTIDE_TERMINI = { nTerminus: ['amine', 'ammonium'], cTerminus: ['acid', 'carboxylate'] };
const METAL_GEOMETRIES = ['linear', 'trigonal-planar', 'tetrahedral', 'square-planar', 'trigonal-bipyramidal', 'square-pyramidal', 'octahedral'];
// Ids of apps/desktop/src/lib/molecular-workbench/metal-ligands.json (kept equal by test:builder-agent).
const METAL_LIGANDS = ['aqua', 'hydroxido', 'ammine', 'fluorido', 'chlorido', 'bromido', 'iodido', 'cyanido', 'carbonyl', 'phosphane', 'trimethylphosphane',
  'pyridine', 'ethylenediamine', 'bipyridine', 'phenanthroline', 'oxalato', 'acetylacetonato'];
const LIBRARY_ID = /^[a-z_]{1,32}\/[A-Za-z0-9 ,_+()-]{1,64}$/u;
const SMILES = /^\S+$/u;

const forceField = value => oneOf(value, 'job.params.forceField', new Set(FORCE_FIELDS), 'MMFF94');
function energyModel(value) {
  if (value === undefined) return 'MMFF94';
  if (ENERGY_MODELS.includes(value) || (typeof value === 'string' && EXTERNAL_ENERGY_MODEL.test(value))) return value;
  invalid(`job.params.forceField must be one of ${ENERGY_MODELS.join(', ')}, or an external model id: ${EXTERNAL_ENERGY_MODEL_FORMS.join(', ')}.`);
}
const seed = value => integer(value, 'job.params.seed', 0, SEED_MAX, 1);

function constraints(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > WORKBENCH_LIMITS.constraints) invalid(`job.params.constraints must be an array of at most ${WORKBENCH_LIMITS.constraints} constraints.`);
  return value.map((item, index) => {
    const label = `job.params.constraints[${index}]`;
    if (!plainObject(item)) invalid(`${label} must be an object.`);
    rejectUnknownFields(item, ['kind', 'atoms', 'target'], label);
    const count = typeof item.kind === 'string' && Object.hasOwn(CONSTRAINT_ATOMS, item.kind) ? CONSTRAINT_ATOMS[item.kind] : undefined;
    if (!count) invalid(`${label}.kind must be freeze, distance, angle or dihedral.`);
    if (!Array.isArray(item.atoms) || item.atoms.length !== count || item.atoms.some(atom => !Number.isInteger(atom) || atom < 0 || atom >= MAX_INDEX) || new Set(item.atoms).size !== count) {
      invalid(`${label}.atoms must hold ${count} distinct zero-based atom indices.`);
    }
    if (item.kind === 'freeze' && item.target !== undefined) invalid(`${label}.target is not used by freeze.`);
    const target = finite(item.target, `${label}.target`, -1e6, 1e6);
    if (target !== undefined && ((item.kind === 'distance' && target <= 0) || (item.kind === 'angle' && (target <= 0 || target >= 180)) || (item.kind === 'dihedral' && Math.abs(target) > 180))) {
      invalid(`${label}.target must be positive for distance, strictly between 0 and 180 for angle, or from -180 to 180 for dihedral.`);
    }
    return target === undefined ? { kind: item.kind, atoms: [...item.atoms] } : { kind: item.kind, atoms: [...item.atoms], target };
  });
}

/** BFGS for unconstrained MMFF, L-BFGS otherwise: the default is resolved here, so status reports the method that runs. */
function optimizer(value, field, constrained) {
  return oneOf(value, 'job.params.method', new Set(OPTIMIZE_METHODS), field.startsWith('MMFF') && !constrained ? 'bfgs' : 'lbfgs');
}

function metadataLabel(value, field, max, empty = false) {
  if (value === null) return null;
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > max || /[\p{Cc}\p{Cf}]/u.test(value)) {
    invalid(`${field} must be ${empty ? '0' : '1'}–${max} characters without control characters, or null to clear.`);
  }
  return value;
}

function metadataAtom(value, position, seen) {
  const field = `job.params.atoms[${position}]`;
  if (!plainObject(value)) invalid(`${field} must be an object.`);
  rejectUnknownFields(value, ['index', 'atomName', 'residue'], field);
  const index = integer(value.index, `${field}.index`, 0, 255);
  if (seen.has(index)) invalid('metadata_edit atom indices must be distinct.');
  seen.add(index);
  if (value.atomName === undefined && value.residue === undefined) invalid(`${field} must request an atomName or residue change.`);
  const atom = { index };
  if (value.atomName !== undefined) atom.atomName = metadataLabel(value.atomName, `${field}.atomName`, 32);
  if (value.residue === null) atom.residue = null;
  else if (value.residue !== undefined) {
    if (!plainObject(value.residue)) invalid(`${field}.residue must be an object or null.`);
    rejectUnknownFields(value.residue, ['name', 'sequence', 'chain', 'insertionCode'], `${field}.residue`);
    const residue = value.residue;
    if (['name', 'chain', 'insertionCode'].some(key => residue[key] === null)) invalid(`${field}.residue fields cannot be null.`);
    atom.residue = { name: metadataLabel(residue.name, `${field}.residue.name`, 32),
      sequence: integer(residue.sequence, `${field}.residue.sequence`, -999999, 999999),
      chain: metadataLabel(residue.chain, `${field}.residue.chain`, 32, true),
      insertionCode: metadataLabel(residue.insertionCode, `${field}.residue.insertionCode`, 4, true) };
  }
  return atom;
}

/**
 * Every job kind the browser workbench can run: `describe` is what `capabilities`
 * advertises (engine, source requirements, parameters, exportable artifacts) and
 * `params` validates and normalizes `job.params` before anything is queued.
 * Kinds marked `build: true` create a new structure without a source document and
 * are requested with operation `build`; every other kind is a `submit` on an open
 * document. Structure artifacts are new files, never applied to the document.
 * A new typed operation adds one entry here and one runner in the shell's
 * agent job registry (apps/desktop/src/lib/workbench/agent-jobs.ts).
 */
const JOB_DEFINITIONS = {
  properties: {
    describe: {
      engine: 'OpenChemLib properties; optional RDKit Gasteiger charges',
      requires: 'A complete chemical graph, 1–256 atoms; Gasteiger requires explicit hydrogens.',
      params: { chargeModel: ['Gasteiger'] },
      artifacts: [],
    },
    params(value) {
      const p = params(value, ['chargeModel'], 'properties job.params');
      const chargeModel = oneOf(p.chargeModel, 'job.params.chargeModel', new Set(['Gasteiger']), undefined);
      return chargeModel === undefined ? {} : { chargeModel };
    },
  },
  energy: {
    describe: {
      engine: 'OpenChemLib MMFF94/MMFF94s, RDKit UFF, Lennard-Jones with Avogadro parameters, or an external model (xTB, Avogadro energy packages)',
      requires: `A complete chemical graph with explicit hydrogens, 1–256 atoms; LJ needs only coordinates. ${EXTERNAL_REQUIREMENT}`,
      params: { forceField: ENERGY_MODEL_PARAMS },
      artifacts: [],
    },
    params: value => ({ forceField: energyModel(params(value, ['forceField'], 'energy job.params').forceField) }),
  },
  energy_forces: {
    describe: {
      engine: 'OpenChemLib MMFF94/MMFF94s central-difference forces, RDKit UFF and Lennard-Jones analytic forces, or the gradient of an external model',
      requires: `A complete chemical graph with explicit hydrogens, 1–64 atoms; LJ needs only coordinates. ${EXTERNAL_REQUIREMENT}`,
      params: { forceField: ENERGY_MODEL_PARAMS },
      artifacts: ['forces'],
    },
    params: value => ({ forceField: energyModel(params(value, ['forceField'], 'energy_forces job.params').forceField) }),
  },
  frame_energy_forces: {
    describe: {
      engine: 'Same energies and forces as energy_forces, for a page of frames sharing one graph; an external model evaluates the page in one session',
      requires: `A multi-frame XYZ with a complete graph (any XYZ for LJ and external models), or a multi-record SDF whose records share one graph (external models: the same atoms); 1–64 atoms; at most 64 frames and 2048 atom-frames per job. ${EXTERNAL_REQUIREMENT}`,
      params: { forceField: ENERGY_MODEL_PARAMS, offset: 'first zero-based frame (default 0)', count: '1–64 frames (default: as many as fit)' },
      artifacts: ['forces', 'extxyz'],
    },
    params(value) {
      const p = params(value, ['forceField', 'offset', 'count'], 'frame_energy_forces job.params');
      const result = { forceField: energyModel(p.forceField), offset: integer(p.offset, 'job.params.offset', 0, MAX_INDEX, 0) };
      if (p.count !== undefined) result.count = integer(p.count, 'job.params.count', 1, WORKBENCH_LIMITS.batchFrames);
      return result;
    },
  },
  optimize: {
    describe: {
      engine: 'Burette Cartesian minimizer (BFGS, L-BFGS, FIRE, ABC-FIRE, hybrid) on MMFF94/MMFF94s (RDKit analytic terms, else OpenChemLib central differences), RDKit UFF or Lennard-Jones (analytic), or an external model',
      requires: `A complete chemical graph with explicit hydrogens, 1–256 atoms (LJ needs only coordinates); central-difference MMFF supports at most 64 atoms. ${EXTERNAL_REQUIREMENT}`,
      params: { forceField: ENERGY_MODEL_PARAMS, method: OPTIMIZE_METHODS, maxIterations: '1–1000 (default 250)', constraints: 'up to 64 of freeze/distance/angle/dihedral; zero-based source atoms; target in Å or degrees (default: current value)' },
      artifacts: ['structure', 'xyz', 'trajectory'],
    },
    params(value) {
      const p = params(value, ['forceField', 'method', 'maxIterations', 'constraints'], 'optimize job.params');
      const field = energyModel(p.forceField), held = constraints(p.constraints);
      return { forceField: field, method: optimizer(p.method, field, held.length > 0), maxIterations: integer(p.maxIterations, 'job.params.maxIterations', 1, WORKBENCH_LIMITS.optimizationIterations, 250), constraints: held };
    },
  },
  prepare_3d: {
    describe: {
      engine: 'OpenChemLib embedding with a stereo identity check, then the optimize engines',
      requires: 'A complete flat chemical graph (2D or all z = 0), 1–256 atoms after hydrogens are added; methods other than bfgs and UFF need at most 64.',
      params: { forceField: FORCE_FIELDS, method: OPTIMIZE_METHODS, seed: '0–2147483639 (default 1); up to 8 consecutive seeds are tried', maxIterations: '1–1000 (default 250)' },
      artifacts: ['structure', 'xyz', 'trajectory'],
    },
    params(value) {
      const p = params(value, ['forceField', 'method', 'seed', 'maxIterations'], 'prepare_3d job.params');
      const field = forceField(p.forceField);
      return { forceField: field, method: optimizer(p.method, field, false), seed: seed(p.seed), maxIterations: integer(p.maxIterations, 'job.params.maxIterations', 1, WORKBENCH_LIMITS.optimizationIterations, 250) };
    },
  },
  conformers: {
    describe: {
      engine: 'OpenChemLib torsion sampling, each sample relaxed with MMFF94/MMFF94s BFGS or RDKit UFF L-BFGS; duplicate minima dropped',
      requires: 'A complete chemical graph, 1–256 atoms after hydrogens are added (UFF: at most 64).',
      params: { forceField: FORCE_FIELDS, count: '1–32 samples (default 8)', seed: '0–2147483639 (default 1)' },
      artifacts: ['conformers'],
    },
    params(value) {
      const p = params(value, ['forceField', 'count', 'seed'], 'conformers job.params');
      return { forceField: forceField(p.forceField), count: integer(p.count, 'job.params.count', 1, WORKBENCH_LIMITS.conformers, 8), seed: seed(p.seed) };
    },
  },
  metadata_edit: {
    describe: {
      engine: 'Burette SDF atom/conformer metadata',
      requires: 'One SDF record, 1–256 atoms; MOL and collections are unsupported. The result is exported, never applied to the document.',
      params: { atoms: 'up to 256 distinct source indices with atomName and/or residue; null clears', conformerLabel: '1–128 characters, or null to clear' },
      artifacts: ['structure'],
    },
    params(value) {
      const p = params(value, ['atoms', 'conformerLabel'], 'metadata_edit job.params');
      if (p.atoms !== undefined && (!Array.isArray(p.atoms) || p.atoms.length > 256)) invalid('job.params.atoms must be an array of at most 256 edits.');
      const seen = new Set(), atoms = (p.atoms ?? []).map((atom, position) => metadataAtom(atom, position, seen));
      if (!atoms.length && p.conformerLabel === undefined) invalid('metadata_edit requires at least one requested change.');
      return { atoms, ...(p.conformerLabel === undefined ? {} : { conformerLabel: metadataLabel(p.conformerLabel, 'job.params.conformerLabel', 128) }) };
    },
  },
  measurement_set: {
    describe: {
      engine: 'Burette rigid fragment motion (the Edit measurement dialog)',
      requires: `${COORDINATE_REQUIREMENT} The moved fragment must separate at the measured bond; ring and nonbonded cuts are refused.`,
      params: { measurement: MEASUREMENT_KINDS, atoms: 'ordered zero-based source atoms: 2, 3 or 4, consecutive atoms bonded (a distance may join disconnected parts)', valueAngstrom: 'distance target, 0.000001–1000000 Å', valueDegrees: 'angle target strictly between 0 and 180, or dihedral target from -180 to 180', fragment: 'smaller (default), first or last: the side of the first or last atom moves' },
      artifacts: ['structure'],
    },
    params(value) {
      const p = params(value, ['measurement', 'atoms', 'valueAngstrom', 'valueDegrees', 'fragment'], 'measurement_set job.params');
      const measurement = oneOf(p.measurement, 'job.params.measurement', new Set(MEASUREMENT_KINDS), undefined);
      if (!measurement) invalid('job.params.measurement is required: distance, angle or dihedral.');
      const count = CONSTRAINT_ATOMS[measurement];
      if (!Array.isArray(p.atoms) || p.atoms.length !== count || Array.from(p.atoms).some(atom => !Number.isInteger(atom) || atom < 0 || atom > 255) || new Set(p.atoms).size !== count) {
        invalid(`job.params.atoms must hold ${count} distinct zero-based atom indices below 256.`);
      }
      const [unit, other] = measurement === 'distance' ? ['valueAngstrom', 'valueDegrees'] : ['valueDegrees', 'valueAngstrom'];
      if (p[other] !== undefined) invalid(`job.params.${other} is not used by ${measurement}; pass ${unit}.`);
      if (p[unit] === undefined) invalid(`job.params.${unit} is required for ${measurement}.`);
      const target = measurement === 'distance' ? finite(p[unit], `job.params.${unit}`, 1e-6, 1e6) : finite(p[unit], `job.params.${unit}`, -180, 180);
      if (measurement === 'angle' && (target <= 0 || target >= 180)) invalid('job.params.valueDegrees must be strictly between 0 and 180 for angle.');
      return { measurement, atoms: [...p.atoms], [unit]: target, fragment: oneOf(p.fragment, 'job.params.fragment', new Set(FRAGMENTS), 'smaller') };
    },
  },
  coordinate_align: {
    describe: {
      engine: 'Avogadro Align tool semantics: translation, then the minimal rotation about the origin',
      requires: COORDINATE_REQUIREMENT,
      params: { originAtom: 'zero-based source atom moved to the origin', axisAtom: 'optional zero-based source atom then placed on the positive axis', axis: `${AXES.join(', ')} (default x; only with axisAtom)` },
      artifacts: ['structure'],
    },
    params(value) {
      const p = params(value, ['originAtom', 'axisAtom', 'axis'], 'coordinate_align job.params');
      const originAtom = integer(p.originAtom, 'job.params.originAtom', 0, 255);
      if (p.axisAtom === undefined) {
        if (p.axis !== undefined) invalid('job.params.axis is only used with axisAtom.');
        return { originAtom };
      }
      const axisAtom = integer(p.axisAtom, 'job.params.axisAtom', 0, 255);
      if (axisAtom === originAtom) invalid('job.params.axisAtom must differ from originAtom.');
      return { originAtom, axisAtom, axis: oneOf(p.axis, 'job.params.axis', new Set(AXES), 'x') };
    },
  },
  spectrum: {
    describe: {
      engine: 'Burette scientific spectrum worker (same float32 display kernel as Spectra)',
      requires: 'An attached or parsed scientific spectrum. File, frame and companion sources are selected explicitly; no current-frame inference.',
      params: { kind: ['vcd', 'mcd', 'nmr', 'electronic', 'ecd', 'dos'], source: ['file', 'frame', 'companion'], frameIndex: 'required zero-based frame for frame/companion', atomicNumber: 'required for NMR, 1–118', scale: 'positive, default from Spectra', offset: 'finite, default from Spectra', fwhm: 'at least 0.01', axisStart: 'finite', axisEnd: 'finite; at most 200000 points and 100000000 evaluations' },
      artifacts: ['source', 'source_csv', 'display', 'settings'],
    },
    params(value) {
      const p = params(value, ['kind', 'source', 'frameIndex', 'atomicNumber', 'scale', 'offset', 'fwhm', 'axisStart', 'axisEnd'], 'spectrum job.params');
      if (p.kind === undefined) invalid('job.params.kind is required.');
      const kind = oneOf(p.kind, 'job.params.kind', new Set(['vcd', 'mcd', 'nmr', 'electronic', 'ecd', 'dos']));
      const source = oneOf(p.source, 'job.params.source', new Set(['file', 'frame', 'companion']), 'file');
      const result = { kind, source };
      if (source !== 'file') result.frameIndex = integer(p.frameIndex, 'job.params.frameIndex', 0, 999999);
      else if (p.frameIndex !== undefined) invalid('File spectra do not take frameIndex.');
      if (kind === 'nmr') result.atomicNumber = integer(p.atomicNumber, 'job.params.atomicNumber', 1, 118);
      else if (p.atomicNumber !== undefined) invalid('Only NMR takes atomicNumber.');
      for (const key of ['scale', 'offset', 'fwhm', 'axisStart', 'axisEnd']) {
        const value = finite(p[key], `job.params.${key}`, key === 'scale' ? Number.MIN_VALUE : key === 'fwhm' ? 0.01 : -1e12, 1e12);
        if (value !== undefined) result[key] = value;
      }
      return result;
    },
  },
  vibrational_spectrum: {
    describe: {
      engine: 'Burette vibrational spectrum worker (same float32 kernel as Vibrations)',
      requires: 'Explicit file or zero-based frame modes with complete IR intensities or Raman activities; no inferred intensities or Hessian calculation.',
      params: { kind: ['ir', 'raman'], source: ['file', 'frame'], frameIndex: 'required for frame', scale: 'positive, default 1', offsetCm1: 'finite, default 0', fwhmCm1: 'at least 0.01, default 30', axisStartCm1: 'nonnegative; automatic by default', axisEndCm1: 'nonnegative; at most 20000 points and 20000000 evaluations' },
      artifacts: ['source', 'source_csv', 'display', 'settings'],
    },
    params(value) {
      const p = params(value, ['kind', 'source', 'frameIndex', 'scale', 'offsetCm1', 'fwhmCm1', 'axisStartCm1', 'axisEndCm1'], 'vibrational_spectrum job.params');
      if (p.kind === undefined) invalid('job.params.kind is required.');
      const kind = oneOf(p.kind, 'job.params.kind', new Set(['ir', 'raman']));
      const source = oneOf(p.source, 'job.params.source', new Set(['file', 'frame']), 'file');
      const result = { kind, source };
      if (source === 'frame') result.frameIndex = integer(p.frameIndex, 'job.params.frameIndex', 0, 999999);
      else if (p.frameIndex !== undefined) invalid('File spectra do not take frameIndex.');
      for (const key of ['scale', 'offsetCm1', 'fwhmCm1', 'axisStartCm1', 'axisEndCm1']) {
        const minimum = key === 'scale' ? Number.MIN_VALUE : key === 'fwhmCm1' ? 0.01 : key === 'offsetCm1' ? -1e12 : 0;
        const value = finite(p[key], `job.params.${key}`, minimum, 1e12);
        if (value !== undefined) result[key] = value;
      }
      return result;
    },
  },
  pair_distribution: {
    describe: {
      engine: 'Burette periodic radial distribution',
      requires: 'An explicit periodic unit cell (small-molecule CIF, POSCAR/CONTCAR or extended XYZ with a Lattice), 1–5000 atoms and at most 12 elements; isolated structures are unsupported.',
      params: { rMax: '1–100 Å (default 10)', binWidth: '0.001–1 Å (default 0.1), at most 20000 bins', centre: 'element symbol or null for all', neighbour: 'element symbol or null for all' },
      artifacts: ['distribution', 'csv'],
    },
    params(value) {
      const p = params(value, ['rMax', 'binWidth', 'centre', 'neighbour'], 'pair_distribution job.params');
      const rMax = finite(p.rMax, 'job.params.rMax', 1, 100) ?? 10, binWidth = finite(p.binWidth, 'job.params.binWidth', 0.001, 1) ?? 0.1;
      if (Math.floor(rMax / binWidth + 1e-9) > 20_000) invalid('pair_distribution supports at most 20000 bins. Widen binWidth or lower rMax.');
      for (const key of ['centre', 'neighbour']) {
        if (p[key] !== undefined && p[key] !== null && (typeof p[key] !== 'string' || !/^[A-Z][a-z]?$/u.test(p[key]))) invalid(`job.params.${key} must be an element symbol or null for all elements.`);
      }
      return { rMax, binWidth, centre: p.centre ?? null, neighbour: p.neighbour ?? null };
    },
  },
  point_group: {
    describe: {
      engine: 'libmsym point groups and symmetrization',
      requires: 'A molecule without a unit cell, 1–256 atoms (SDF, MOL or XYZ).',
      params: { tolerance: POINT_GROUP_TOLERANCES },
      artifacts: ['symmetrized'],
    },
    params: value => ({ tolerance: oneOf(params(value, ['tolerance'], 'point_group job.params').tolerance, 'job.params.tolerance', new Set(POINT_GROUP_TOLERANCES), 'normal') }),
  },
  space_group: {
    describe: {
      engine: 'moyo space-group search',
      requires: 'A crystal with its own cell (small-molecule CIF, POSCAR/CONTCAR or extended XYZ with a Lattice), 1–5000 atoms.',
      params: { toleranceAngstrom: '0.0001–0.5 (default 0.01)' },
      artifacts: [],
    },
    params: value => ({ toleranceAngstrom: symmetryTolerance(params(value, ['toleranceAngstrom'], 'space_group job.params').toleranceAngstrom) }),
  },
  powder_xrd: {
    describe: {
      engine: 'Gemmi structure factors (IT92 form factors), Lorentz-polarization, no Debye-Waller factor',
      requires: 'A crystal with its own cell, 1–2000 atoms.',
      params: { wavelengthAngstrom: '0.1–5 (default 1.5405929, Cu Kα1)', twoThetaMinDegrees: '0–170 (default 10)', twoThetaMaxDegrees: '0–170 (default 90)',
        profile: ['gaussian', 'lorentzian', null], fwhmDegrees: 'with profile: 0.001–5 (default 0.1)' },
      artifacts: ['peaks', 'pattern'],
    },
    params(value) {
      const p = params(value, ['wavelengthAngstrom', 'twoThetaMinDegrees', 'twoThetaMaxDegrees', 'profile', 'fwhmDegrees'], 'powder_xrd job.params');
      const result = {
        wavelengthAngstrom: finite(p.wavelengthAngstrom, 'job.params.wavelengthAngstrom', 0.1, 5) ?? 1.5405929,
        twoThetaMinDegrees: finite(p.twoThetaMinDegrees, 'job.params.twoThetaMinDegrees', 0, 170) ?? 10,
        twoThetaMaxDegrees: finite(p.twoThetaMaxDegrees, 'job.params.twoThetaMaxDegrees', 0, 170) ?? 90,
        profile: p.profile === null ? null : oneOf(p.profile, 'job.params.profile', new Set(['gaussian', 'lorentzian']), null),
      };
      if (!(result.twoThetaMaxDegrees > result.twoThetaMinDegrees)) invalid('job.params.twoThetaMaxDegrees must exceed twoThetaMinDegrees.');
      if (result.profile) result.fwhmDegrees = finite(p.fwhmDegrees, 'job.params.fwhmDegrees', 0.001, 5) ?? 0.1;
      else if (p.fwhmDegrees !== undefined) invalid('job.params.fwhmDegrees needs a profile.');
      return result;
    },
  },
  crystal_transform: {
    describe: {
      engine: 'Burette cell operations; moyo standardization; spglib Niggli reduction',
      requires: 'A crystal with its own cell. The result is exported, never applied to the document.',
      params: {
        operation: Object.keys(TRANSFORM_FIELDS),
        cell: 'set_cell: three lattice vectors in angstrom', keep: ['fractional', 'cartesian'], volumeCubicAngstrom: 'scale_volume', repeats: 'supercell: three integers 1–20',
        toleranceAngstrom: 'primitive, conventional, symmetrize, asymmetric_unit: 0.0001–0.5 (default 0.01)', hallNumber: 'fill: 1–530',
      },
      artifacts: ['structure'],
    },
    params: value => crystalTransformParams(params(value, ['operation', 'cell', 'keep', 'volumeCubicAngstrom', 'repeats', 'toleranceAngstrom', 'hallNumber'], 'crystal_transform job.params')),
  },
  biological_assembly: {
    describe: {
      engine: 'Burette biological assembly expansion (PDB REMARK 350, mmCIF pdbx_struct_assembly)',
      requires: 'A PDB or mmCIF source up to 20 MB with an explicit assembly definition; at most 250000 expanded atoms. The assembly is exported as a new mmCIF.',
      params: { assemblyId: 'required when the file defines several assemblies', modelNumber: 'required when the file has several models' },
      artifacts: ['structure'],
    },
    params(value) {
      const p = params(value, ['assemblyId', 'modelNumber'], 'biological_assembly job.params');
      const result = {};
      for (const key of ['assemblyId', 'modelNumber']) {
        if (p[key] === undefined) continue;
        if (typeof p[key] !== 'string' || !p[key].trim() || p[key].length > 64) invalid(`job.params.${key} must be a non-empty string of at most 64 characters.`);
        result[key] = p[key];
      }
      return result;
    },
  },
  orbital_cube: {
    describe: {
      engine: 'Workbench Gaussian-basis evaluator',
      requires: 'A document parsed with a Gaussian basis and orbitals (FCHK or Molden source).',
      params: { field: ORBITAL_FIELDS, orbitalIndex: 'required for orbital', spacingAngstrom: '0.1–1', paddingAngstrom: '0–10', grid: '{ origin, axes, dimensions } in Å, Cube order (last axis fastest), at most one million points; replaces spacing and padding' },
      artifacts: ['cube'],
    },
    params(value) {
      const p = params(value, ['field', 'orbitalIndex', 'spacingAngstrom', 'paddingAngstrom', 'grid'], 'orbital_cube job.params');
      const field = oneOf(p.field, 'job.params.field', new Set(ORBITAL_FIELDS), undefined);
      if (!field) invalid('job.params.field is required for orbital_cube.');
      if (field !== 'orbital' && p.orbitalIndex !== undefined) invalid('job.params.orbitalIndex is only used by the orbital field.');
      const result = { field };
      if (field === 'orbital') result.orbitalIndex = integer(p.orbitalIndex, 'job.params.orbitalIndex', 0, MAX_INDEX);
      // The evaluator's floor: an axis-aligned voxel is at least 0.1 Å on a side.
      const spacing = finite(p.spacingAngstrom, 'job.params.spacingAngstrom', 0.1, 1);
      const padding = finite(p.paddingAngstrom, 'job.params.paddingAngstrom', 0, 10);
      if (p.grid !== undefined) {
        if (spacing !== undefined || padding !== undefined) invalid('job.params.grid replaces spacingAngstrom and paddingAngstrom.');
        result.grid = grid(p.grid);
      }
      if (spacing !== undefined) result.spacingAngstrom = spacing;
      if (padding !== undefined) result.paddingAngstrom = padding;
      return result;
    },
  },
  insert_fragment: {
    describe: {
      engine: 'Rigid fragment placement: OpenChemistry/fragments groups or an OpenChemLib SMILES conformer',
      requires: 'An explicit MOL/SDF graph; at most 256 atoms after insertion.',
      params: { library: 'group id such as alkanes/ethyl (exactly one of library or smiles)', smiles: 'one SMILES; a single * marks the attachment point', atomIndex: 'zero-based source atom to attach to; omit for a separate molecule' },
      artifacts: ['structure'],
    },
    params(value) {
      const p = params(value, ['library', 'smiles', 'atomIndex'], 'insert_fragment job.params');
      if ((p.library === undefined) === (p.smiles === undefined)) invalid('insert_fragment requires exactly one of job.params.library or job.params.smiles.');
      return defined({
        library: p.library === undefined ? undefined : text(p.library, 'job.params.library', 97, LIBRARY_ID),
        smiles: p.smiles === undefined ? undefined : text(p.smiles, 'job.params.smiles', 1024, SMILES),
        atomIndex: p.atomIndex === undefined ? undefined : integer(p.atomIndex, 'job.params.atomIndex', 0, 255),
      });
    },
  },
  hydrogens: {
    describe: {
      engine: 'OpenChemLib graph with Burette hydrogen placement; ph uses a cited per-group pKa table',
      requires: 'An explicit MOL/SDF graph, 1–256 atoms after the change.',
      params: { mode: ['add', 'remove', 'ph'], pH: '0–14, required for ph' },
      artifacts: ['structure'],
    },
    params(value) {
      const p = params(value, ['mode', 'pH'], 'hydrogens job.params');
      const mode = oneOf(p.mode, 'job.params.mode', new Set(['add', 'remove', 'ph']), undefined);
      if (!mode) invalid('job.params.mode is required for hydrogens.');
      if ((mode === 'ph') !== (p.pH !== undefined)) invalid('job.params.pH is required for mode ph and unused otherwise.');
      return mode === 'ph' ? { mode, pH: finite(p.pH, 'job.params.pH', 0, 14) } : { mode };
    },
  },
  polymer: {
    describe: {
      engine: 'Rigid repeat-unit assembly with optional relaxation by the optimize engine (MMFF94, bfgs)',
      requires: 'One explicit MOL/SDF repeat unit with explicit leaving hydrogens; relaxation within 256 atoms.',
      params: { head: 'zero-based atom', tail: 'zero-based atom', headLeaving: 'H bonded to head', tailLeaving: 'H bonded to tail', count: '1–500',
        bondLengthAngstrom: '0.5–3, default 1.54', tacticity: TACTICITIES, headEnd: POLYMER_END_GROUPS, tailEnd: POLYMER_END_GROUPS, relax: 'boolean (default false)' },
      artifacts: ['structure'],
    },
    params(value) {
      const p = params(value, ['head', 'tail', 'headLeaving', 'tailLeaving', 'count', 'bondLengthAngstrom', 'tacticity', 'headEnd', 'tailEnd', 'relax'], 'polymer job.params');
      const ends = new Set(POLYMER_END_GROUPS), atom = key => integer(p[key], `job.params.${key}`, 0, 99_999);
      return defined({
        head: atom('head'), tail: atom('tail'), headLeaving: atom('headLeaving'), tailLeaving: atom('tailLeaving'),
        count: integer(p.count, 'job.params.count', 1, 500),
        bondLengthAngstrom: finite(p.bondLengthAngstrom, 'job.params.bondLengthAngstrom', 0.5, 3) ?? 1.54,
        tacticity: oneOf(p.tacticity, 'job.params.tacticity', new Set(TACTICITIES), undefined),
        headEnd: oneOf(p.headEnd, 'job.params.headEnd', ends, 'hydrogen'), tailEnd: oneOf(p.tailEnd, 'job.params.tailEnd', ends, 'hydrogen'),
        relax: bool(p.relax, 'job.params.relax') ?? false,
      });
    },
  },
  graph_edit: {
    describe: {
      engine: 'OpenChemLib graph edits, as the Edit tab makes them',
      requires: 'An explicit MOL/SDF graph, 1–256 atoms after every edit. The edited structure is exported, never applied to the document.',
      params: { edits: '1–16 edits in order; zero-based indices refer to the structure after the previous edit: { kind: "add_atom", element, position: [x, y, z] }, { kind: "update_atom", index, element?, charge?, isotope?, position? }, { kind: "delete_atoms", indices }, { kind: "set_bond", a, b, order: 0 (no bond), 1, 2, 3 or 9 (dative) }' },
      artifacts: ['structure'],
    },
    params(value) {
      const p = params(value, ['edits'], 'graph_edit job.params');
      if (!Array.isArray(p.edits) || p.edits.length < 1 || p.edits.length > 16) invalid('job.params.edits must hold 1–16 edits.');
      return { edits: p.edits.map((edit, index) => graphEdit(edit, `job.params.edits[${index}]`)) };
    },
  },
  structure_export: {
    describe: {
      engine: 'Burette coordinate writers, as Export → Structure writes them',
      requires: 'A single-file source the workbench reads (MOL, SDF, XYZ, CIF, POSCAR or a quantum output). MOL of an SDF is its first record as written; XYZ and CJSON keep a crystal cell; MOL and CJSON of other sources need the chemical graph (1–256 atoms).',
      params: { format: STRUCTURE_EXPORT_FORMATS },
      artifacts: ['structure'],
    },
    params: value => ({ format: oneOf(params(value, ['format'], 'structure_export job.params').format, 'job.params.format', new Set(STRUCTURE_EXPORT_FORMATS), undefined) ?? invalid('job.params.format is required.') }),
  },
  quantum_input: {
    describe: {
      engine: 'Burette input writers, as Export input file writes them; no quantum program runs',
      requires: 'A MOL, SDF, XYZ, PDB (first model), CIF, POSCAR or quantum output source. CP2K gets the source cell unless periodic is false.',
      params: { program: QUANTUM_PROGRAMS, task: QUANTUM_TASKS, method: 'keyword (the dialog default per program)', basis: 'keyword (the dialog default per program)', charge: '-100–100 (0)', multiplicity: '1–101 (1)', coordinates: ['cartesian', 'zmatrix (not CP2K)'], constraints: 'freeze, distance, angle, dihedral at the current geometry; optimize only', periodic: 'CP2K cell from the source (true)' },
      artifacts: ['input'],
    },
    params(value) {
      const p = params(value, ['program', 'task', 'method', 'basis', 'charge', 'multiplicity', 'coordinates', 'constraints', 'periodic'], 'quantum_input job.params');
      const program = oneOf(p.program, 'job.params.program', new Set(QUANTUM_PROGRAMS), undefined) ?? invalid('job.params.program is required.');
      const task = oneOf(p.task, 'job.params.task', new Set(QUANTUM_TASKS), 'energy');
      const coordinates = oneOf(p.coordinates, 'job.params.coordinates', new Set(['cartesian', 'zmatrix']), 'cartesian');
      if (program === 'cp2k' && coordinates === 'zmatrix') invalid('CP2K reads Cartesian coordinates only.');
      for (const key of ['method', 'basis']) if (p[key] !== undefined && (typeof p[key] !== 'string' || !QUANTUM_KEYWORD.test(p[key]))) invalid(`job.params.${key} must be one keyword of at most 80 characters.`);
      const frozen = constraints(p.constraints);
      if (frozen.some(item => item.target !== undefined)) invalid('Input files hold the current geometry; job.params.constraints take no target.');
      if (frozen.length && task !== 'optimize') invalid('Constraints require task optimize.');
      if (p.periodic !== undefined && typeof p.periodic !== 'boolean') invalid('job.params.periodic must be a boolean.');
      return defined({ program, task, method: p.method, basis: p.basis, charge: integer(p.charge, 'job.params.charge', -100, 100, 0),
        multiplicity: integer(p.multiplicity, 'job.params.multiplicity', 1, 101, 1), coordinates, constraints: frozen, periodic: p.periodic ?? true });
    },
  },
  smiles: {
    build: true,
    describe: {
      engine: 'OpenChemLib SMILES conformer (as when opening a SMILES), relaxed by the optimize engines',
      requires: 'No source document; 1–256 atoms with explicit hydrogens; methods other than bfgs and UFF need at most 64.',
      params: { smiles: 'one SMILES string', forceField: FORCE_FIELDS, method: OPTIMIZE_METHODS, seed: '0–2147483639 (default 1)', maxIterations: '1–1000 (default 250)' },
      artifacts: ['structure', 'xyz', 'trajectory'],
    },
    params(value) {
      const p = params(value, ['smiles', 'forceField', 'method', 'seed', 'maxIterations'], 'smiles job.params');
      const field = forceField(p.forceField);
      return { smiles: text(p.smiles, 'job.params.smiles', 1024, SMILES), forceField: field, method: optimizer(p.method, field, false), seed: seed(p.seed),
        maxIterations: integer(p.maxIterations, 'job.params.maxIterations', 1, WORKBENCH_LIMITS.optimizationIterations, 250) };
    },
  },
  nucleic_acid: {
    build: true,
    describe: {
      engine: 'Ideal-helix nucleotide templates: Open-Source PyMOL fnab fragments (3DNA fiber models) for A/B DNA and A-RNA, PDB 4OCB for Z-DNA',
      requires: 'No source document; 1–500 nucleotides per strand.',
      params: { sequence: 'one-letter bases (ACGT for DNA, ACGU for RNA)', type: ['DNA', 'RNA'], form: ['B', 'A', 'Z'], strands: ['double', 'single'], fivePrime: ['hydroxyl', 'phosphate'] },
      artifacts: ['structure'],
    },
    params(value) {
      const p = params(value, ['sequence', 'type', 'form', 'strands', 'fivePrime'], 'nucleic_acid job.params');
      const type = oneOf(p.type, 'job.params.type', new Set(['DNA', 'RNA']), 'DNA'), form = oneOf(p.form, 'job.params.form', new Set(['B', 'A', 'Z']), type === 'RNA' ? 'A' : 'B');
      if (type === 'RNA' && form !== 'A') invalid('RNA is built as an A-form helix; use form A.');
      return { sequence: text(p.sequence, 'job.params.sequence', 4000), type, form, strands: oneOf(p.strands, 'job.params.strands', new Set(['double', 'single']), 'double'),
        fivePrime: oneOf(p.fivePrime, 'job.params.fivePrime', new Set(['hydroxyl', 'phosphate']), 'hydroxyl') };
    },
  },
  metal_complex: {
    build: true,
    describe: {
      engine: 'Rigid ligand placement on ideal coordination polyhedra (OpenChemistry/fragments ligand templates)',
      requires: 'No source document; one metal, 1–8 ligands filling every site of the geometry exactly once.',
      params: { metal: 'element symbol', oxidationState: '-2–8', geometry: METAL_GEOMETRIES,
        ligands: 'array of { ligand, sites (zero-based polyhedron sites, two for bidentate ligands), distanceAngstrom 1.4–3.5 (default: covalent radii) }',
        ligand: METAL_LIGANDS, format: ['sdf', 'mol'] },
      artifacts: ['structure'],
    },
    params(value) {
      const p = params(value, ['metal', 'oxidationState', 'geometry', 'ligands', 'format'], 'metal_complex job.params');
      const geometry = oneOf(p.geometry, 'job.params.geometry', new Set(METAL_GEOMETRIES), undefined);
      if (!geometry) invalid('job.params.geometry is required for metal_complex.');
      if (!Array.isArray(p.ligands) || !p.ligands.length || p.ligands.length > 8) invalid('job.params.ligands must be an array of 1–8 ligand assignments.');
      const ligands = p.ligands.map((item, index) => {
        const label = `job.params.ligands[${index}]`;
        if (!plainObject(item)) invalid(`${label} must be an object.`);
        rejectUnknownFields(item, ['ligand', 'sites', 'distanceAngstrom'], label);
        const ligand = oneOf(item.ligand, `${label}.ligand`, new Set(METAL_LIGANDS), undefined);
        if (!ligand) invalid(`${label}.ligand is required.`);
        if (!Array.isArray(item.sites) || item.sites.length < 1 || item.sites.length > 2) invalid(`${label}.sites must hold one or two site indices.`);
        return defined({ ligand, sites: item.sites.map((site, i) => integer(site, `${label}.sites[${i}]`, 0, 5)), distanceAngstrom: finite(item.distanceAngstrom, `${label}.distanceAngstrom`, 1.4, 3.5) });
      });
      return { metal: text(p.metal, 'job.params.metal', 2, /^[A-Z][a-z]?$/u), oxidationState: integer(p.oxidationState, 'job.params.oxidationState', -2, 8, 0),
        geometry, ligands, format: oneOf(p.format, 'job.params.format', new Set(['sdf', 'mol']), 'sdf') };
    },
  },
  peptide: {
    build: true,
    describe: {
      engine: 'Template peptide geometry from OpenChemistry residue internal coordinates',
      requires: 'No source document.',
      params: { sequence: '1–64 standard residues', codes: ['one', 'three'], chirality: ['L', 'D'], phiDegrees: '-180–180', psiDegrees: '-180–180', ...PEPTIDE_TERMINI, chain: 'one letter or digit' },
      artifacts: ['structure'],
    },
    params(value) {
      const p = params(value, ['sequence', 'codes', 'chirality', 'phiDegrees', 'psiDegrees', 'nTerminus', 'cTerminus', 'chain'], 'peptide job.params');
      return {
        sequence: text(p.sequence, 'job.params.sequence', 1024),
        codes: oneOf(p.codes, 'job.params.codes', new Set(['one', 'three']), 'one'),
        chirality: oneOf(p.chirality, 'job.params.chirality', new Set(['L', 'D']), 'L'),
        phiDegrees: finite(p.phiDegrees, 'job.params.phiDegrees', -180, 180) ?? 180,
        psiDegrees: finite(p.psiDegrees, 'job.params.psiDegrees', -180, 180) ?? 180,
        nTerminus: oneOf(p.nTerminus, 'job.params.nTerminus', new Set(PEPTIDE_TERMINI.nTerminus), 'amine'),
        cTerminus: oneOf(p.cTerminus, 'job.params.cTerminus', new Set(PEPTIDE_TERMINI.cTerminus), 'acid'),
        chain: p.chain === undefined ? 'A' : text(p.chain, 'job.params.chain', 1, /^[A-Za-z0-9]$/u),
      };
    },
  },
};

/** What `capabilities` advertises for each job kind, including the operation that requests it. */
export const WORKBENCH_JOB_KINDS = Object.freeze(Object.fromEntries(Object.entries(JOB_DEFINITIONS).map(([kind, definition]) => [kind, { operation: definition.build ? 'build' : 'submit', ...definition.describe }])));

function job(value, operation) {
  if (!plainObject(value)) invalid(`${operation} requires job: { kind, params }.`);
  rejectUnknownFields(value, ['kind', 'params'], 'job');
  if (typeof value.kind !== 'string' || !Object.hasOwn(WORKBENCH_JOB_KINDS, value.kind)) {
    throw new WorkbenchRequestError(
      'UNSUPPORTED_WORKBENCH_JOB',
      'Unsupported workbench job kind. It was rejected before queueing; see details.supportedJobs.',
      { kind: typeof value.kind === 'string' ? value.kind.slice(0, 64) : null, supportedJobs: Object.keys(WORKBENCH_JOB_KINDS) },
    );
  }
  if (WORKBENCH_JOB_KINDS[value.kind].operation !== operation) {
    invalid(`${value.kind} jobs use operation ${operation === 'build' ? 'submit with an open source document' : 'build; they need no source document'}.`);
  }
  return { kind: value.kind, params: JOB_DEFINITIONS[value.kind].params(value.params) };
}

function page(action) {
  return {
    offset: integer(action.offset, 'offset', 0, MAX_INDEX, 0),
    limit: integer(action.limit, 'limit', 1, WORKBENCH_LIMITS.pageSize, WORKBENCH_LIMITS.defaultPageSize),
  };
}

/**
 * Validates one `workbench` action. Returns `{ ok: true, request }` with defaults
 * filled in, or `{ ok: false, error: { code, message, details } }`.
 */
export function validateWorkbenchRequest(action) {
  try {
    if (!plainObject(action)) invalid('A workbench request must be a JSON object.');
    let byteCount;
    try {
      byteCount = new TextEncoder().encode(JSON.stringify(action)).length;
    } catch {
      invalid('A workbench request must be serializable JSON.');
    }
    if (byteCount > WORKBENCH_LIMITS.requestBytes) {
      throw new WorkbenchRequestError('REQUEST_TOO_LARGE', `Workbench requests are limited to ${WORKBENCH_LIMITS.requestBytes} bytes.`, { byteCount, limit: WORKBENCH_LIMITS.requestBytes });
    }
    if (action.type !== 'workbench') invalid('A workbench request must have type "workbench".');
    const operation = action.operation;
    if (typeof operation !== 'string' || !Object.hasOwn(OPERATION_FIELDS, operation)) {
      throw new WorkbenchRequestError(
        'UNSUPPORTED_WORKBENCH_OPERATION',
        'Unsupported workbench operation. It was rejected before queueing; see details.supportedOperations.',
        { operation: typeof operation === 'string' ? operation.slice(0, 64) : null, supportedOperations: WORKBENCH_OPERATIONS },
      );
    }
    rejectUnknownFields(action, ['type', 'operation', ...OPERATION_FIELDS[operation]], `workbench ${operation}`);
    const request = { type: 'workbench', operation };
    if (OPERATION_FIELDS[operation].includes('documentId')) {
      const id = documentId(action.documentId);
      if (id !== undefined) request.documentId = id;
      const expected = revision(action.expectedSourceRevision, operation === 'submit');
      if (expected !== undefined) request.expectedSourceRevision = expected;
    }
    if (OPERATION_FIELDS[operation].includes('offset')) Object.assign(request, page(action));
    if (OPERATION_FIELDS[operation].includes('frameIndex') && action.frameIndex !== undefined) request.frameIndex = integer(action.frameIndex, 'frameIndex', 0, MAX_INDEX);
    if (operation === 'submit' || operation === 'build') {
      request.operationId = identifier(action.operationId, 'operationId', true);
      request.job = job(action.job, operation);
    }
    if (operation === 'status') {
      if ((action.jobId === undefined) === (action.operationId === undefined)) invalid('status requires exactly one of jobId or operationId.');
      if (action.jobId !== undefined) request.jobId = identifier(action.jobId, 'jobId', true);
      else request.operationId = identifier(action.operationId, 'operationId', true);
    }
    if (operation === 'cancel' || operation === 'export') request.jobId = identifier(action.jobId, 'jobId', true);
    if (operation === 'export') {
      if (typeof action.artifact !== 'string' || !ARTIFACT.test(action.artifact)) invalid('export requires artifact: the name of one of the job\'s artifacts.');
      request.artifact = action.artifact;
      if (action.allowStale !== undefined && typeof action.allowStale !== 'boolean') invalid('allowStale must be a boolean.');
      request.allowStale = action.allowStale === true;
    }
    return { ok: true, request };
  } catch (error) {
    if (error instanceof WorkbenchRequestError) return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
    throw error;
  }
}

/** Runtimes that run workbench operations other than `capabilities`. */
export const WORKBENCH_RUNTIMES = Object.freeze(['browser-agent-shell', 'desktop-app']);

/** Static part of the `capabilities` answer, shared with documentation and clients. */
export function workbenchContractSummary() {
  return {
    apiVersion: WORKBENCH_AGENT_API_VERSION,
    operations: WORKBENCH_OPERATIONS,
    jobs: WORKBENCH_JOB_KINDS,
    limits: WORKBENCH_LIMITS,
    runtimes: WORKBENCH_RUNTIMES,
  };
}
