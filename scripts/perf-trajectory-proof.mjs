// Scientific acceptance checks shared with the native journey driver. A malformed
// query must fail rather than turn a NaN comparison into a successful proof.
const atomIds = [1, 5000, 10000];
const vector = value => Array.isArray(value) && value.length === 3
  && [0, 1, 2].every(axis => typeof value[axis] === 'number' && Number.isFinite(value[axis]));

export function isExpectedTrajectorySizeGuard(message, phase, bytes) {
  return phase === 'before' && bytes > 75 * 1024 * 1024
    && typeof message === 'string' && message.includes(' is larger than the 75 MB preview limit');
}

// PerfApp.act returns the CLI payload, not the viewer result. Keep the action
// envelope checks explicit so failed/stale actions cannot become timing proof.
export function trajectoryActionResult(response, type, command = type) {
  const action = response?.action;
  const failure = action?.result;
  if ((response?.ok === true || response?.ok === false) && action?.type === type
    && (action.status === 'failed' || action.status === 'completed')
    && failure?.ok === false && failure.command === command
    && typeof failure.error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(failure.error.code)
    && typeof failure.error.message === 'string' && failure.error.message.length > 0) {
    throw new Error(failure.error.message.slice(0, 1200));
  }
  if (response?.ok !== true || action?.type !== type || action.status !== 'completed'
    || action.result?.ok !== true || action.result.command !== command
    || !action.result.result || typeof action.result.result !== 'object') {
    throw new Error(`Expected a successful completed ${type} action result.`);
  }
  const result = action.result.result;
  if (type === 'open_docking_view' && (typeof result.documentId !== 'string'
    || result.documentId.length === 0 || result.documentId.length > 512
    || result.documentId.trim() !== result.documentId)) {
    throw new Error('Opened trajectory action did not identify its document.');
  }
  return result;
}

export function checkTrajectoryCoordinates(actual, expected) {
  if (!Number.isSafeInteger(expected?.frame) || expected.frame < 0) {
    throw new Error('Coordinate proof requires the requested source frame index.');
  }
  if (!actual || actual.total !== atomIds.length || !Array.isArray(actual.atoms) || actual.atoms.length !== atomIds.length) {
    throw new Error('Exact atom query did not return the three requested source atoms.');
  }
  if (actual.coordinateSpace !== 'scene' || actual.units !== 'angstrom') {
    throw new Error('Coordinate proof requires scene coordinates in angstrom.');
  }
  const seen = new Set();
  const atoms = actual.atoms.map(atom => {
    const rawId = atom?.atom_id;
    const atomId = typeof rawId === 'number' || (typeof rawId === 'string' && /^[1-9]\d*$/.test(rawId)) ? Number(rawId) : NaN;
    if (!Number.isSafeInteger(atomId) || !atomIds.includes(atomId) || seen.has(atomId)) {
      throw new Error('Coordinate proof requires exactly source atom IDs 1, 5000 and 10000, without duplicates.');
    }
    seen.add(atomId);
    if (!Number.isSafeInteger(atom.modelIndex) || atom.modelIndex !== expected.frame) {
      throw new Error(`Frame mismatch for source atom ${atomId}: requested ${expected.frame}, observed ${String(atom.modelIndex).slice(0, 32)}.`);
    }
    const sourceIndex = atomId - 1;
    const wanted = expected?.positions?.[sourceIndex];
    if (!vector(wanted) || !vector(atom.position)) {
      throw new Error(`Invalid expected or actual coordinate vector for source atom ${atomId}.`);
    }
    const maxErrorAngstrom = Math.max(...wanted.map((value, axis) => Math.abs(value - atom.position[axis])));
    if (!Number.isFinite(maxErrorAngstrom) || maxErrorAngstrom > 1e-4) {
      throw new Error(`Coordinate mismatch for source atom ${atomId}: ${maxErrorAngstrom} angstrom.`);
    }
    return { sourceIndex, modelIndex: atom.modelIndex, position: atom.position, expected: wanted, maxErrorAngstrom };
  });
  if (seen.size !== atomIds.length) throw new Error('Coordinate proof is missing requested source atom IDs.');
  return { coordinateSpace: actual.coordinateSpace, units: actual.units, atoms };
}
