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

const DOCUMENT_FIELDS = ['documentId', 'expectedSourceRevision'];
const PAGE_FIELDS = ['offset', 'limit'];

// Fields each operation accepts besides `type` and `operation`.
const OPERATION_FIELDS = Object.freeze({
  capabilities: [],
  observe: DOCUMENT_FIELDS,
  orbitals: [...DOCUMENT_FIELDS, ...PAGE_FIELDS],
  submit: [...DOCUMENT_FIELDS, 'operationId', 'job'],
  status: ['jobId', 'operationId'],
  jobs: PAGE_FIELDS,
  cancel: ['jobId'],
  export: ['jobId', 'artifact', 'allowStale'],
});

export const WORKBENCH_OPERATIONS = Object.freeze(Object.keys(OPERATION_FIELDS));

/**
 * Local jobs the browser workbench can run. `requires` states what the source
 * document must provide; `artifacts` names the files `export` can write.
 */
export const WORKBENCH_JOB_KINDS = Object.freeze({
  orbital_cube: {
    engine: 'Workbench Gaussian-basis evaluator',
    requires: 'A document parsed with a Gaussian basis and orbitals (FCHK or Molden source).',
    params: { field: ['orbital', 'density', 'spin-density'], orbitalIndex: 'required for orbital', spacingAngstrom: '0.05–1', paddingAngstrom: '0–10' },
    artifacts: ['cube'],
  },
});

const FIELDS = new Set(WORKBENCH_JOB_KINDS.orbital_cube.params.field);
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

function jobParams(_kind, value) {
  const params = value ?? {};
  if (!plainObject(params)) invalid('job.params must be a JSON object.');
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

function job(value) {
  if (!plainObject(value)) invalid('submit requires job: { kind, params }.');
  rejectUnknownFields(value, ['kind', 'params'], 'job');
  if (typeof value.kind !== 'string' || !Object.hasOwn(WORKBENCH_JOB_KINDS, value.kind)) {
    throw new WorkbenchRequestError(
      'UNSUPPORTED_WORKBENCH_JOB',
      'Unsupported workbench job kind. It was rejected before queueing; see details.supportedJobs.',
      { kind: typeof value.kind === 'string' ? value.kind.slice(0, 64) : null, supportedJobs: Object.keys(WORKBENCH_JOB_KINDS) },
    );
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
    if (operation === 'submit') {
      request.operationId = identifier(action.operationId, 'operationId', true);
      request.job = job(action.job);
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
