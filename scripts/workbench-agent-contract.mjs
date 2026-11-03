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
const ORBITAL_FIELDS = ['orbital', 'density', 'spin-density'];

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
  return oneOf(value, 'job.params.method', new Set(OPTIMIZE_METHODS), field === 'UFF' || constrained ? 'lbfgs' : 'bfgs');
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
      engine: 'OpenChemLib MMFF94/MMFF94s or RDKit UFF',
      requires: 'A complete chemical graph, 1–256 atoms; calculations require explicit hydrogens.',
      params: { forceField: FORCE_FIELDS },
      artifacts: [],
    },
    params: value => ({ forceField: forceField(params(value, ['forceField'], 'energy job.params').forceField) }),
  },
  energy_forces: {
    describe: {
      engine: 'OpenChemLib MMFF94/MMFF94s central-difference forces or RDKit UFF analytic forces',
      requires: 'A complete chemical graph, 1–64 atoms; calculations require explicit hydrogens.',
      params: { forceField: FORCE_FIELDS },
      artifacts: ['forces'],
    },
    params: value => ({ forceField: forceField(params(value, ['forceField'], 'energy_forces job.params').forceField) }),
  },
  frame_energy_forces: {
    describe: {
      engine: 'Same energies and forces as energy_forces, for a page of frames sharing one graph',
      requires: 'A multi-frame XYZ with a complete graph, or a multi-record SDF whose records share one graph; 1–64 atoms; at most 64 frames and 2048 atom-frames per job.',
      params: { forceField: FORCE_FIELDS, offset: 'first zero-based frame (default 0)', count: '1–64 frames (default: as many as fit)' },
      artifacts: ['forces', 'extxyz'],
    },
    params(value) {
      const p = params(value, ['forceField', 'offset', 'count'], 'frame_energy_forces job.params');
      const result = { forceField: forceField(p.forceField), offset: integer(p.offset, 'job.params.offset', 0, MAX_INDEX, 0) };
      if (p.count !== undefined) result.count = integer(p.count, 'job.params.count', 1, WORKBENCH_LIMITS.batchFrames);
      return result;
    },
  },
  optimize: {
    describe: {
      engine: 'OpenChemLib MMFF94/MMFF94s BFGS, or L-BFGS/FIRE/ABC-FIRE/hybrid on MMFF94/MMFF94s (central-difference gradients) or RDKit UFF (analytic gradients)',
      requires: 'A complete chemical graph with explicit hydrogens, 1–256 atoms; methods other than bfgs, UFF and constraints need at most 64 atoms; bfgs holds no constraints.',
      params: { forceField: FORCE_FIELDS, method: OPTIMIZE_METHODS, maxIterations: '1–1000 (default 250)', constraints: 'up to 64 of freeze/distance/angle/dihedral; zero-based source atoms; target in Å or degrees (default: current value)' },
      artifacts: ['structure', 'xyz', 'trajectory'],
    },
    params(value) {
      const p = params(value, ['forceField', 'method', 'maxIterations', 'constraints'], 'optimize job.params');
      const field = forceField(p.forceField), held = constraints(p.constraints);
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
  pair_distribution: {
    describe: {
      engine: 'Burette periodic radial distribution',
      requires: 'An explicit periodic unit cell, 1–5000 atoms and at most 12 elements; isolated structures are unsupported.',
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
export const WORKBENCH_RUNTIMES = Object.freeze(['browser-agent-shell']);

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
