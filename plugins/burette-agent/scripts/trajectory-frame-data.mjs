const IDENTITY_KEYS = ['sourceId', 'modelId', 'structureRef', 'frameIndex', 'frameCount', 'segmentIndex'];
const MAX_ATOMS = 5_000_000;
const fail = message => { throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const index = value => Number.isSafeInteger(value) && value >= 0;
const token = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const onlyKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

/** A read never seeks: callers bind pages to the observed source/model/frame identity. */
export function validateTrajectoryFrameRequest(request = {}) {
  if (!record(request) || Object.keys(request).some(key => !['type', 'offset', 'limit', 'structureRef', 'expected', 'includeSummary'].includes(key))) fail('Invalid trajectory frame request.');
  if (request.type !== undefined && request.type !== 'indexed_trajectory_frame') fail('Invalid trajectory frame request.');
  const { offset = 0, limit = 100, structureRef, expected, includeSummary = false } = request;
  if (!index(offset) || offset > MAX_ATOMS || !Number.isInteger(limit) || limit < 1 || limit > 100) fail('Choose a trajectory page of 1–100 atoms.');
  if (typeof includeSummary !== 'boolean') fail('Invalid trajectory summary option.');
  if (structureRef !== undefined && !token(structureRef)) fail('Invalid trajectory structure reference.');
  if (expected !== undefined) {
    if (!record(expected) || !Object.keys(expected).length || Object.keys(expected).some(key => !IDENTITY_KEYS.includes(key))) fail('Invalid expected trajectory identity.');
    for (const [key, value] of Object.entries(expected)) if (!(key.endsWith('Id') || key === 'structureRef' ? token(value) : index(value))) fail('Invalid expected trajectory identity.');
    if (expected.frameCount === 0 || (expected.frameCount !== undefined && expected.frameIndex !== undefined && expected.frameIndex >= expected.frameCount)) fail('Invalid expected trajectory identity.');
  }
  return { offset, limit, includeSummary, ...(structureRef === undefined ? {} : { structureRef }), ...(expected === undefined ? {} : { expected }) };
}

export function validateTrajectoryFrameResult(value, request = {}) {
  const options = validateTrajectoryFrameRequest(request);
  if (!record(value) || typeof value.available !== 'boolean' || !onlyKeys(value, ['available', ...IDENTITY_KEYS, 'time', 'step', 'units', 'offset', 'total', 'summary', 'atoms'])) fail('The viewer returned invalid trajectory data.');
  if (!value.available) {
    if (Object.keys(value).length !== 1) fail('The viewer returned invalid trajectory data.');
    if (options.expected) fail('The displayed trajectory changed. Read the current frame again.');
    return { available: false };
  }
  if (!['sourceId', 'modelId', 'structureRef'].every(key => token(value[key]))
    || !['frameIndex', 'frameCount', 'segmentIndex', 'offset', 'total'].every(key => index(value[key]))
    || value.frameCount < 1 || value.frameIndex >= value.frameCount || value.total < 1 || value.total > MAX_ATOMS
    || value.offset !== options.offset || !record(value.time) || !onlyKeys(value.time, ['value', 'unit']) || !Number.isFinite(value.time.value) || !['ps', 'step'].includes(value.time.unit)
    || (value.step !== undefined && !Number.isSafeInteger(value.step)) || !record(value.units) || !onlyKeys(value.units, ['position', 'velocity', 'force']) || value.units.position !== 'angstrom'
    || (value.units.velocity !== undefined && value.units.velocity !== 'angstrom/ps')
    || (value.units.force !== undefined && value.units.force !== 'kcal/mol/angstrom')
    || !Array.isArray(value.atoms) || value.atoms.length !== Math.max(0, Math.min(options.limit, value.total - value.offset))) fail('The viewer returned invalid trajectory data.');
  if (options.structureRef !== undefined && value.structureRef !== options.structureRef) fail('The displayed trajectory changed. Read the current frame again.');
  if (options.expected && Object.entries(options.expected).some(([key, expected]) => value[key] !== expected)) fail('The displayed trajectory changed. Read the current frame again.');
  for (const [at, atom] of value.atoms.entries()) {
    if (!record(atom) || !onlyKeys(atom, ['index', 'sourceAtomIndex', 'position', 'element', 'velocity', 'force']) || atom.index !== value.offset + at || !index(atom.sourceAtomIndex) || atom.sourceAtomIndex >= value.total || !vector(atom.position)
      || (atom.element !== undefined && (typeof atom.element !== 'string' || !/^[A-Za-z]{1,3}$/.test(atom.element)))
      || (value.units.velocity ? !vector(atom.velocity) : atom.velocity !== undefined)
      || (value.units.force ? !vector(atom.force) : atom.force !== undefined)) fail('The viewer returned invalid trajectory atoms.');
  }
  if (!record(value.summary) || Object.entries(value.summary).some(([key, scalar]) => !['maxForce', 'rmsForce', 'rmsSpeed'].includes(key) || !Number.isFinite(scalar) || scalar < 0)
    || (!options.includeSummary && Object.keys(value.summary).length !== 0)
    || (options.includeSummary && (value.units.force ? value.summary.maxForce === undefined || value.summary.rmsForce === undefined : value.summary.maxForce !== undefined || value.summary.rmsForce !== undefined))
    || (options.includeSummary && (value.units.velocity ? value.summary.rmsSpeed === undefined : value.summary.rmsSpeed !== undefined))) fail('The viewer returned invalid trajectory statistics.');
  return value;
}

/** Read the current hierarchy only; never choose arbitrarily among several trajectories. */
export function readActiveTrajectoryFrame(viewer, request, frameData) {
  const options = validateTrajectoryFrameRequest(request);
  const structures = viewer?.plugin?.managers?.structure?.hierarchy?.current?.structures ?? [];
  const wanted = options.structureRef ?? options.expected?.structureRef;
  let selected;
  for (const structure of structures) {
    const ref = structure.cell?.transform?.ref;
    if (wanted !== undefined && ref !== wanted) continue;
    for (const model of structure.cell?.obj?.data?.models ?? []) {
      const data = frameData(model, options);
      if (!data) continue;
      if (selected) fail('Choose one trajectory structure before reading frame data.');
      selected = { ...data, available: true, structureRef: ref };
    }
  }
  return validateTrajectoryFrameResult(selected ?? { available: false }, options);
}
