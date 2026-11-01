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
});

const FORCE_FIELDS = ['MMFF94', 'MMFF94s', 'UFF'];

const DOCUMENT_FIELDS = ['documentId', 'expectedSourceRevision'];
const PAGE_FIELDS = ['offset', 'limit'];

// Fields each operation accepts besides `type` and `operation`.
const OPERATION_FIELDS = Object.freeze({
  capabilities: [],
  observe: DOCUMENT_FIELDS,
  orbitals: [...DOCUMENT_FIELDS, ...PAGE_FIELDS],
  submit: [...DOCUMENT_FIELDS, 'operationId', 'job'],
  build: ['operationId', 'job'],
  status: ['jobId', 'operationId'],
  jobs: PAGE_FIELDS,
  cancel: ['jobId'],
  export: ['jobId', 'artifact', 'allowStale'],
});

export const WORKBENCH_OPERATIONS = Object.freeze(Object.keys(OPERATION_FIELDS));

const POLYMER_END_GROUPS = ['hydrogen', 'methyl', 'hydroxyl', 'phenyl', 'tert-butyl'];
const PEPTIDE_TERMINI = { nTerminus: ['amine', 'ammonium'], cTerminus: ['acid', 'carboxylate'] };

/**
 * Local jobs the browser workbench can run. `operation` is `submit` for jobs on
 * an open source document and `build` for new structures that need none.
 * `requires` states what the source document must provide; `artifacts` names the
 * files `export` can write. Structure artifacts are new files, never applied to
 * the open document.
 */
export const WORKBENCH_JOB_KINDS = Object.freeze({
  properties: {
    operation: 'submit',
    engine: 'OpenChemLib properties; optional RDKit Gasteiger charges',
    requires: 'A complete chemical graph, 1–256 atoms; Gasteiger requires explicit hydrogens.',
    params: { chargeModel: ['Gasteiger'] },
    artifacts: [],
  },
  energy: {
    operation: 'submit',
    engine: 'OpenChemLib MMFF94/MMFF94s or RDKit UFF',
    requires: 'A complete chemical graph, 1–256 atoms; calculations require explicit hydrogens.',
    params: { forceField: FORCE_FIELDS },
    artifacts: [],
  },
  energy_forces: {
    operation: 'submit',
    engine: 'OpenChemLib MMFF94/MMFF94s central-difference forces or RDKit UFF analytic forces',
    requires: 'A complete chemical graph, 1–64 atoms; calculations require explicit hydrogens.',
    params: { forceField: FORCE_FIELDS },
    artifacts: ['forces'],
  },
  orbital_cube: {
    operation: 'submit',
    engine: 'Workbench Gaussian-basis evaluator',
    requires: 'A document parsed with a Gaussian basis and orbitals (FCHK or Molden source).',
    params: { field: ['orbital', 'density', 'spin-density'], orbitalIndex: 'required for orbital', spacingAngstrom: '0.05–1', paddingAngstrom: '0–10' },
    artifacts: ['cube'],
  },
  insert_fragment: {
    operation: 'submit',
    engine: 'Rigid fragment placement: OpenChemistry/fragments groups or an OpenChemLib SMILES conformer',
    requires: 'An explicit MOL/SDF graph; at most 256 atoms after insertion.',
    params: { library: 'group id such as alkanes/ethyl (exactly one of library or smiles)', smiles: 'one SMILES; a single * marks the attachment point', atomIndex: 'zero-based source atom to attach to; omit for a separate molecule' },
    artifacts: ['structure'],
  },
  hydrogens: {
    operation: 'submit',
    engine: 'OpenChemLib graph with RDKit hydrogen placement',
    requires: 'An explicit MOL/SDF graph, 1–256 atoms after the change.',
    params: { mode: ['add', 'remove'] },
    artifacts: ['structure'],
  },
  polymer: {
    operation: 'submit',
    engine: 'Rigid repeat-unit assembly with optional OpenChemLib MMFF94 relaxation',
    requires: 'One explicit MOL/SDF repeat unit with explicit leaving hydrogens; relaxation within 256 atoms.',
    params: { head: 'zero-based atom', tail: 'zero-based atom', headLeaving: 'H bonded to head', tailLeaving: 'H bonded to tail', count: '1–500',
      bondLengthAngstrom: '0.5–3, default 1.54', tacticity: ['isotactic', 'syndiotactic', 'atactic'], headEnd: POLYMER_END_GROUPS, tailEnd: POLYMER_END_GROUPS, relax: 'boolean' },
    artifacts: ['structure'],
  },
  peptide: {
    operation: 'build',
    engine: 'Template peptide geometry from OpenChemistry residue internal coordinates',
    requires: 'No source document.',
    params: { sequence: '1–64 standard residues', codes: ['one', 'three'], chirality: ['L', 'D'], phiDegrees: '-180–180', psiDegrees: '-180–180', ...PEPTIDE_TERMINI, chain: 'one letter or digit' },
    artifacts: ['structure'],
  },
});

const FIELDS = new Set(WORKBENCH_JOB_KINDS.orbital_cube.params.field);
const LIBRARY_ID = /^[a-z_]{1,32}\/[A-Za-z0-9 ,_+()-]{1,64}$/u;
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

function jobParams(kind, value) {
  const params = value ?? {};
  if (!plainObject(params)) invalid('job.params must be a JSON object.');
  if (kind === 'insert_fragment') {
    rejectUnknownFields(params, ['library', 'smiles', 'atomIndex'], 'insert_fragment job.params');
    if ((params.library === undefined) === (params.smiles === undefined)) invalid('insert_fragment requires exactly one of job.params.library or job.params.smiles.');
    return defined({
      library: params.library === undefined ? undefined : text(params.library, 'job.params.library', 97, LIBRARY_ID),
      smiles: params.smiles === undefined ? undefined : text(params.smiles, 'job.params.smiles', 1024, /^\S+$/u),
      atomIndex: params.atomIndex === undefined ? undefined : integer(params.atomIndex, 'job.params.atomIndex', 0, 255),
    });
  }
  if (kind === 'hydrogens') {
    rejectUnknownFields(params, ['mode'], 'hydrogens job.params');
    const mode = oneOf(params.mode, 'job.params.mode', new Set(WORKBENCH_JOB_KINDS.hydrogens.params.mode), undefined);
    if (!mode) invalid('job.params.mode is required for hydrogens.');
    return { mode };
  }
  if (kind === 'polymer') {
    rejectUnknownFields(params, ['head', 'tail', 'headLeaving', 'tailLeaving', 'count', 'bondLengthAngstrom', 'tacticity', 'headEnd', 'tailEnd', 'relax'], 'polymer job.params');
    const ends = new Set(POLYMER_END_GROUPS);
    return defined({
      head: integer(params.head, 'job.params.head', 0, 99_999), tail: integer(params.tail, 'job.params.tail', 0, 99_999),
      headLeaving: integer(params.headLeaving, 'job.params.headLeaving', 0, 99_999), tailLeaving: integer(params.tailLeaving, 'job.params.tailLeaving', 0, 99_999),
      count: integer(params.count, 'job.params.count', 1, 500),
      bondLengthAngstrom: finite(params.bondLengthAngstrom, 'job.params.bondLengthAngstrom', 0.5, 3) ?? 1.54,
      tacticity: oneOf(params.tacticity, 'job.params.tacticity', new Set(WORKBENCH_JOB_KINDS.polymer.params.tacticity), undefined),
      headEnd: oneOf(params.headEnd, 'job.params.headEnd', ends, 'hydrogen'), tailEnd: oneOf(params.tailEnd, 'job.params.tailEnd', ends, 'hydrogen'),
      relax: bool(params.relax, 'job.params.relax') ?? false,
    });
  }
  if (kind === 'peptide') {
    rejectUnknownFields(params, ['sequence', 'codes', 'chirality', 'phiDegrees', 'psiDegrees', 'nTerminus', 'cTerminus', 'chain'], 'peptide job.params');
    return {
      sequence: text(params.sequence, 'job.params.sequence', 1024),
      codes: oneOf(params.codes, 'job.params.codes', new Set(['one', 'three']), 'one'),
      chirality: oneOf(params.chirality, 'job.params.chirality', new Set(['L', 'D']), 'L'),
      phiDegrees: finite(params.phiDegrees, 'job.params.phiDegrees', -180, 180) ?? 180,
      psiDegrees: finite(params.psiDegrees, 'job.params.psiDegrees', -180, 180) ?? 180,
      nTerminus: oneOf(params.nTerminus, 'job.params.nTerminus', new Set(PEPTIDE_TERMINI.nTerminus), 'amine'),
      cTerminus: oneOf(params.cTerminus, 'job.params.cTerminus', new Set(PEPTIDE_TERMINI.cTerminus), 'acid'),
      chain: params.chain === undefined ? 'A' : text(params.chain, 'job.params.chain', 1, /^[A-Za-z0-9]$/u),
    };
  }
  if (kind === 'energy' || kind === 'energy_forces') {
    rejectUnknownFields(params, ['forceField'], `${kind} job.params`);
    return { forceField: oneOf(params.forceField, 'job.params.forceField', new Set(FORCE_FIELDS), 'MMFF94') };
  }
  if (kind === 'properties') {
    rejectUnknownFields(params, ['chargeModel'], 'properties job.params');
    const chargeModel = oneOf(params.chargeModel, 'job.params.chargeModel', new Set(['Gasteiger']), undefined);
    return chargeModel === undefined ? {} : { chargeModel };
  }
  // orbital_cube
  rejectUnknownFields(params, ['field', 'orbitalIndex', 'spacingAngstrom', 'paddingAngstrom'], 'orbital_cube job.params');
  const field = oneOf(params.field, 'job.params.field', FIELDS, undefined);
  if (!field) invalid('job.params.field is required for orbital_cube.');
  if (field !== 'orbital' && params.orbitalIndex !== undefined) invalid('job.params.orbitalIndex is only used by the orbital field.');
  const result = { field };
  if (field === 'orbital') result.orbitalIndex = integer(params.orbitalIndex, 'job.params.orbitalIndex', 0, MAX_INDEX);
  const spacing = finite(params.spacingAngstrom, 'job.params.spacingAngstrom', 0.05, 1);
  const padding = finite(params.paddingAngstrom, 'job.params.paddingAngstrom', 0, 10);
  if (spacing !== undefined) result.spacingAngstrom = spacing;
  if (padding !== undefined) result.paddingAngstrom = padding;
  return result;
}

function job(value, operation) {
  if (!plainObject(value)) invalid('submit requires job: { kind, params }.');
  rejectUnknownFields(value, ['kind', 'params'], 'job');
  if (typeof value.kind !== 'string' || !Object.hasOwn(WORKBENCH_JOB_KINDS, value.kind)) {
    throw new WorkbenchRequestError(
      'UNSUPPORTED_WORKBENCH_JOB',
      'Unsupported workbench job kind. It was rejected before queueing; see details.supportedJobs.',
      { kind: typeof value.kind === 'string' ? value.kind.slice(0, 64) : null, supportedJobs: Object.keys(WORKBENCH_JOB_KINDS) },
    );
  }
  if (WORKBENCH_JOB_KINDS[value.kind].operation === 'build' ? operation !== 'build' : operation === 'build') {
    invalid(`${value.kind} jobs use operation ${operation === 'build' ? 'submit with an open source document' : 'build; they need no source document'}.`);
  }
  return { kind: value.kind, params: jobParams(value.kind, value.params) };
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
