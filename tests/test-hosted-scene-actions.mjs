import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { sanitizeViewerActions } from '../apps/burette-public-plugin/lib/hosted-context.ts';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function applyHostedMcpActions()');
const end = source.indexOf("  window.addEventListener('burette-agent-ready'", start);
assert.ok(start > 0 && end > start);

for (const nested of [false, true]) {
  const actions = [{ type: 'select_residues', selector: { auth_asym_id: 'A', beg_auth_seq_id: 1, end_auth_seq_id: 5 } }, { type: 'reset_camera' }];
  const executed = [], reports = [];
  let release;
  const bridgeHost = { BuretteHostedAppBridge: { ready: new Promise(resolve => { release = resolve; }), sanitizeViewerActions: () => [] } };
  const window = {
    ...(nested ? { parent: bridgeHost } : bridgeHost),
    BuretteConfig: { hostedMcpActions: actions, documentId: 'test' },
    BuretteAgent: { ready: Promise.resolve() },
    __mqlPost: (_type, _message, value) => reports.push(value.report),
  };
  const context = { window, hostedMcpActionsApplied: false, hostedMcpSceneInitialized: false,
    executeBuretteAgentAction: async action => { executed.push(action); return { ok: true }; },
    hostedMcpSelectionFromResults: () => ({ atoms: 33 }),
    agentActionFailure: (command, code, message) => ({ ok: false, command, error: { code, message } }),
  };
  runInNewContext(source.slice(start, end), context);
  await context.applyHostedMcpActions();
  assert.equal(executed.length, 0, 'agent readiness must not race initial camera framing');
  context.hostedMcpSceneInitialized = true;
  const pending = context.applyHostedMcpActions();
  const host = nested ? bridgeHost : window;
  host.BuretteHostedAppBridge = { ready: Promise.resolve(true), sanitizeViewerActions };
  release(true);
  await pending;
  assert.deepEqual(JSON.parse(JSON.stringify(executed)), sanitizeViewerActions(actions));
  assert.equal(reports[0].results.length, 2);
  await context.applyHostedMcpActions();
  assert.equal(executed.length, 2, 'initial scene actions run only once');
  context.hostedMcpActionsApplied = false;
  window.BuretteConfig.hostedMcpActions = [{ type: 'delete_file', path: '/private' }];
  await context.applyHostedMcpActions();
  assert.equal(executed.length, 2, 'parent bridge does not bypass the action allowlist');
  assert.equal(reports.at(-1).results[0].error.code, 'ACTION_ERROR');
}
console.log('Hosted scene actions work in standalone and nested viewer frames');

// Execute the real load path: hosted author-residue selectors must not silently
// expand one ligand into every symmetry copy. Native defaults stay unchanged.
const loadStart = source.indexOf('  async function loadPreparedStructure(viewer, prepared)');
const loadEnd = source.indexOf('  async function loadMolstarEntry(', loadStart);
for (const hosted of [false, true]) {
  const presets = [];
  const context = {
    activeConfig: { hostedMcpWidgetBootstrap: hosted },
    cancelScheduledMolstarWaterRepresentation() {}, updateSdfPoseButton() {},
    notifyStructureOverlayModeChanged() {}, installDockingPoseControls() {},
    configuredMolstarStyle: () => 'auto', applyMolstarStyle: async () => {},
    applyMolstarWaterLineRepresentation: async () => {}, trajectoryControlsForPrepared: () => null,
    parseMolstarStructureTrajectories: async () => ['trajectory'],
  };
  runInNewContext(source.slice(loadStart, loadEnd), context);
  const viewer = { plugin: { builders: { data: { rawData: async () => 'data' }, structure: {
    hierarchy: { applyPreset: async (...args) => presets.push(args) },
  } } } };
  await context.loadPreparedStructure(viewer, { format: 'pdb', data: 'ATOM', label: '1STP' });
  assert.deepEqual(JSON.parse(JSON.stringify(presets[0])), hosted
    ? ['trajectory', 'default', { structure: { name: 'model', params: {} } }]
    : ['trajectory', 'default', null]);
  await context.loadPreparedStructure(viewer, { format: 'pdb', data: 'ATOM', loadPreset: 'all-models' });
  assert.equal(presets[1][2].useDefaultIfSingleModel, !hosted);
}
console.log('Hosted PDB view preserves source coordinates; native assembly defaults unchanged');

const showStart = source.indexOf('  async function showMolstarComponents(');
const showEnd = source.indexOf('  async function ensureMolstarComponentsByKind(', showStart);
for (const visible of [true, false]) {
  let added = 0;
  const component = { representations: visible ? [{ cell: { obj: { data: { repr: { state: { visible: true } } } } } }] : [] };
  const context = {
    normalizeSceneComponentKind: kind => kind,
    activeMolstarViewer: () => ({ plugin: { builders: { structure: { representation: {
      addRepresentation: async () => { added += 1; },
    } } } } }),
    ensureMolstarComponentsByKind: async () => [component],
    representationForSceneComponentKind: () => ({ type: 'cartoon' }),
  };
  runInNewContext(source.slice(showStart, showEnd), context);
  const result = await context.showMolstarComponents({ kind: 'polymer' });
  assert.equal(result.ok, true);
  assert.equal(added, visible ? 0 : 1, 'show must not duplicate a visible polymer');
}
console.log('Showing an already visible polymer is idempotent');

const kindStart = source.indexOf('  function molstarComponentsByKind(');
const kindEnd = source.indexOf('  async function hideMolstarWaters(', kindStart);
{
  const component = (key, label) => ({ key, cell: { obj: { label } } });
  const components = [
    component('structure-component-static-ion', 'Ion'),
    component('burette-selection,structure-component-burette-selection-resi-5', 'Selection'),
    component('burette-lasso', 'Lasso selection · 12 atoms'),
    component('structure-component-static-polymer', 'Polymer'),
    component('structure-component-static-water', 'Water'),
  ];
  const context = {
    isMolstarWaterComponent: item => item.key.endsWith('-water'),
  };
  runInNewContext(source.slice(kindStart, kindEnd), context);
  const viewer = { plugin: { managers: { structure: { hierarchy: { current: { structures: [{ components }] } } } } } };
  const labels = kind => Array.from(context.molstarComponentsByKind(viewer, kind), item => item.cell.obj.label);
  assert.deepEqual(labels('ions'), ['Ion'], 'ion must not match selection or lasso components');
  assert.deepEqual(labels('protein'), ['Polymer']);
  assert.deepEqual(labels('water'), ['Water']);
}
console.log('Scene component kinds match whole words, not substrings');

const backgroundStart = source.indexOf('  function resolvedCanvasBackground()');
const backgroundEnd = source.indexOf('  function canvasBackgroundCSS()', backgroundStart);
for (const hosted of [false, true]) {
  for (const theme of ['light', 'dark']) {
    const context = { canvasBackground: 'auto', resolveViewerTheme: () => theme,
      window: { BuretteConfig: { hostedMcpWidgetBootstrap: hosted } } };
    runInNewContext(source.slice(backgroundStart, backgroundEnd), context);
    assert.equal(context.resolvedCanvasBackground(), theme === 'light' ? 'white' : hosted ? 'black' : 'graphite');
    context.canvasBackground = 'white';
    assert.equal(context.resolvedCanvasBackground(), 'white', 'explicit background choice is preserved');
  }
}
const { createViewerWidgetHtml } = await import('../apps/burette-public-plugin/lib/widget.ts');
const shell = createViewerWidgetHtml('https://burette-plugin.vercel.app');
assert.ok(shell.includes('html { height: 100vh; }'));
assert.ok(!shell.includes('height: min(80vh, 760px)'));
console.log('Hosted scene fills its host and matches black/white background; native graphite unchanged');
