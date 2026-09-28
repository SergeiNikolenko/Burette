import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const start = source.indexOf('  function requestMolecularCompute(');
const end = source.indexOf('  function isSdfPoseConformerSet(', start);
assert.ok(start >= 0 && end > start);
const posted = [];
const statuses = [];
const context = {
  activeConfig: {},
  window: {},
  normalizeFormat: value => String(value ?? '').toLowerCase(),
  configuredMolstarStyle: () => 'auto',
  postHostMessage: value => { posted.push(value); return true; },
  setGenerate3DPending: () => {},
  setStatus: (...args) => statuses.push(args),
};
runInNewContext(source.slice(start, end), context);

for (const format of ['sdf', 'mol']) for (const capability of [{ hostedMcpWidgetBootstrap: true }, { visualizationOnly: true }]) {
  // Both the public widget and the local native adapter set this bootstrap flag.
  context.activeConfig = { format, renderer: 'molstar', ...capability };
  assert.equal(context.canGenerate3DConformerFromConfig(context.activeConfig, 'molstar'), false);
  for (const operation of ['generate3d', 'generateEnsemble', 'optimizeGeometry', 'semiempiricalRm1', 'alignPoses']) {
    context.requestMolecularCompute(operation);
  }
  assert.deepEqual(posted, [], 'unavailable widget actions must not reach the host');
  assert.deepEqual(statuses, [], 'widgets must not announce a computation they cannot start');
}

for (const hostedMcpWidgetBootstrap of [undefined, false]) {
  context.activeConfig = { format: 'sdf', renderer: 'molstar', hostedMcpWidgetBootstrap };
  assert.equal(context.canGenerate3DConformerFromConfig(context.activeConfig, 'molstar'), true);
  context.requestMolecularCompute('generate3d');
  assert.equal(posted.pop().operation, 'generate3d', 'desktop and browser compute stay available');
}
assert.equal(context.canGenerate3DConformerFromConfig({ format: 'pdb' }, 'molstar'), false);
assert.equal(context.canGenerate3DConformerFromConfig({ format: 'sdf' }, 'xyzrender-external'), false);
console.log('Widget compute capability checks passed');
