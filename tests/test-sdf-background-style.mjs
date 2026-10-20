import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => {
  const match = source.match(new RegExp(`\\n  (?:async )?function ${name}\\([\\s\\S]*?\\n  \\}`, 'u'));
  assert.ok(match, name);
  return match[0];
};
const plain = value => JSON.parse(JSON.stringify(value));

// Exercise the collection controller with a loaded scene: changing any
// background control must preserve every structure and the foreground.
const targets = Array.from({ length: 9 }, (_, i) => ({ cell: { transform: { ref: `s${i}` } } }));
const styled = [];
const viewer = { plugin: {
  builders: { data: { rawData() {} }, structure: { parseTrajectory() {}, hierarchy: { applyPreset() {} } } },
  clear() { throw Error('Appearance must not clear the scene'); },
} };
const prepared = { kind: 'sdf-collection', poseCount: 9, collectionSinglePdbs: targets.map(() => 'pdb') };
const context = {
  activeConfig: { documentId: 'test', style: 'line', opacity: 0.4, color: 'gray' },
  activeSdfPoseMode: 'all', activeSdfCollectionLayout: 'overlap',
  restoreSdfCollectionAlignment() {}, configuredMolstarStyle: () => 'illustrative',
  readSdfCollectionContextStyle: c => c.style, readSdfCollectionContextOpacity: c => c.opacity,
  readSdfCollectionContextColor: c => c.color,
  molstarStructureCellRefs: () => new Set(targets.map(s => s.cell.transform.ref)),
  molstarCurrentStructures: () => targets,
  applySdfCollectionMolstarStyle: async (_viewer, style, structures, alpha, color) => styled.push({
    style, refs: structures.map(s => s.cell.transform.ref), alpha, color,
  }),
  document: { querySelector: () => null }, updateStructureOverlayToggleButton() {},
};
runInNewContext(['sdfCollectionStateKey', 'molstarRefsStillLoaded', 'sdfCollectionVisibilityStateStillLoaded',
  'molstarStructuresByRefs', 'applySdfCollectionVisibilityNow'].map(extract).join('\n'), context);
const state = context.activeSdfCollectionVisibilityState = {
  viewer, key: context.sdfCollectionStateKey(prepared, 'illustrative', true),
  activeIndex: 0, activeRefs: ['s0'], backgroundRefs: targets.map(s => s.cell.transform.ref),
  allRefsByIndex: targets.map(s => [s.cell.transform.ref]), appearanceKey: 'line|0.4|gray',
};
for (const style of ['ball-and-stick', 'spacefill', 'molecular-surface', 'match', 'line']) {
  context.activeConfig.style = style;
  await context.applySdfCollectionVisibilityNow(viewer, prepared);
  assert.deepEqual(plain(styled.at(-1)), {
    style: style === 'match' ? 'illustrative' : style, refs: targets.slice(1).map(s => s.cell.transform.ref), alpha: 0.4, color: 'gray',
  });
  assert.equal(context.activeSdfCollectionVisibilityState, state);
}
context.activeConfig.color = 'colored';
context.activeConfig.opacity = 0.7;
await context.applySdfCollectionVisibilityNow(viewer, prepared);
assert.deepEqual(plain(styled.at(-1)), { style: 'line', refs: targets.slice(1).map(s => s.cell.transform.ref), alpha: 0.7, color: 'colored' });

// A mixed burst uses the latest complete settings, does not pause drawing,
// and a failure cannot poison subsequent queue entries.
let release;
let holds = 0;
const queueContext = {
  sdfCollectionAppearanceUpdates: new WeakMap(), AbortController,
  activeViewer: viewer, molstarSceneRebuildChain: Promise.resolve(), pendingSceneAppearance: new Map(),
  withMolstarDrawHold: async (_viewer, run) => { holds++; return run(); },
  applySdfCollectionVisibilityNow: context.applySdfCollectionVisibilityNow,
};
runInNewContext(extract('queueMolstarSceneRebuild') + extract('applySdfCollectionVisibility'), queueContext);
const blocker = queueContext.queueMolstarSceneRebuild(() => new Promise(resolve => { release = resolve; }));
await Promise.resolve();
const old = queueContext.applySdfCollectionVisibility(viewer, prepared, 0, { contextStyle: 'spacefill' });
const newest = queueContext.applySdfCollectionVisibility(viewer, prepared, 0, { contextOpacity: 0.2 });
context.activeConfig.style = 'line';
context.activeConfig.opacity = 0.2;
const before = styled.length;
release();
await Promise.all([blocker, old, newest]);
assert.equal(styled.length, before + 1);
assert.equal(holds, 1, 'Only the structural job holds drawing');
assert.equal(styled.at(-1).alpha, 0.2);
await assert.rejects(queueContext.queueMolstarSceneRebuild(() => { throw Error('failed'); }), /failed/);
await queueContext.queueMolstarSceneRebuild(() => {});

// The representation transforms themselves change type, color and alpha in
// bounded commits, preserving refs and resetting defaults across style changes.
const cache = new WeakMap();
const params = new Map();
const reps = targets.map((target, i) => {
  const entries = [{ ref: `r${i}`, role: 0, type: 'line', defaults: { alpha: 1, sizeFactor: 1 } }];
  entries.layout = 1;
  cache.set(target.cell, entries);
  params.set(`r${i}`, { type: { name: 'line', params: { ignoreHydrogens: true, ignoreHydrogensVariant: 'non-polar' } }, colorTheme: { name: 'uniform' } });
  return entries[0].ref;
});
let commits = 0, yields = 0, fail = false;
const providers = new Map(['line', 'spacefill', 'molecular-surface', 'ball-and-stick'].map(name => [name, {
  defaultValues: { alpha: 1, sizeFactor: 1, quality: 'auto' }, defaultSizeTheme: { name: 'physical' },
}]));
const plugin = {
  state: { data: { cells: new Map(reps.map(ref => [ref, {}])), build() {
    const changes = [];
    return { to(ref) { return { update(fn) { changes.push([ref, fn]); } }; }, async commit() {
      if (fail) throw Error('commit failed');
      assert.ok(changes.length <= 32);
      for (const [ref, fn] of changes) params.set(ref, fn(params.get(ref)));
      commits++;
    } };
  } } },
  representation: { structure: { registry: { get: name => providers.get(name) }, themes: {
    colorThemeRegistry: { get: name => ({ name, defaultValues: name === 'uniform' ? { value: 0 } : { carbonColor: 'element' } }) },
    sizeThemeRegistry: { get: name => ({ name, defaultValues: { scale: 1 } }) },
  } } },
};
const update = runInNewContext(extract('updateCollectionRepresentations') + '\nupdateCollectionRepresentations', {
  collectionRepresentations: cache, setTimeout: callback => { yields++; setTimeout(callback, 0); },
});
for (const type of providers.keys()) {
  assert.equal(await update(plugin, targets, [{ type, color: 'element-symbol', typeParams: { alpha: 0.4 } }]), true);
  assert.deepEqual(plain(params.get('r0')), {
    type: { name: type, params: { ...cache.get(targets[0].cell)[0].defaults, ignoreHydrogens: true, ignoreHydrogensVariant: 'non-polar', alpha: 0.4 } },
    colorTheme: { name: 'element-symbol', params: { carbonColor: 'element' } },
    sizeTheme: { name: 'physical', params: { scale: 1 } },
  });
}
assert.equal(commits, 7);
assert.equal(yields, 3);
assert.equal(await update(plugin, targets, [{ type: 'line', color: 'uniform', colorParams: { value: 123 }, typeParams: {} }]), true);
assert.equal(params.get('r0').type.params.alpha, 1);
assert.deepEqual(plain(params.get('r0').colorTheme), { name: 'uniform', params: { value: 123 } });
assert.equal(await update(plugin, targets, [{ type: 'cartoon' }, { type: 'ball-and-stick' }]), false,
  'Match must partition polymer/ligand components instead of converting the whole molecule to cartoon');
fail = true;
await assert.rejects(update(plugin, targets, [{ type: 'spacefill', color: 'uniform' }]), /commit failed/);
assert.equal(cache.get(targets[0].cell)[0].type, 'line');
console.log('SDF background preserves structures/foreground, coalesces mixed updates, yields and retains representation refs');

// Stop an in-flight geometry update at its next yield, then repair every
// representation with the newer style rather than accepting a partial scene.
fail = false;
const abort = new AbortController();
const first = update(plugin, targets, [{ type: 'spacefill', color: 'uniform' }], abort.signal);
abort.abort();
await assert.rejects(first, { name: 'AbortError' });
await update(plugin, targets, [{ type: 'line', color: 'uniform', typeParams: { alpha: 0.2 } }]);
assert.ok([...params.values()].every(p => p.type.name === 'line' && p.type.params.alpha === 0.2));
console.log('Superseded representation updates stop and the latest style repairs the complete scene');

// A failed/interrupted pass must be retried even if the next choice is the
// appearance that preceded it (the visible scene can now be partially changed).
const restyle = context.applySdfCollectionMolstarStyle;
context.activeConfig.style = 'spacefill';
context.applySdfCollectionMolstarStyle = async () => { throw Error('interrupted'); };
await assert.rejects(context.applySdfCollectionVisibilityNow(viewer, prepared), /interrupted/);
assert.equal(state.appearanceKey, null);
context.applySdfCollectionMolstarStyle = restyle;
context.activeConfig.style = 'line';
await context.applySdfCollectionVisibilityNow(viewer, prepared);
assert.equal(state.appearanceKey, 'line|0.2|colored');

// Match for a non-polymer SDF retains the whole-molecule component. Protein
// structures still use the existing polymer/ligand partition.
const routes = [];
const styleContext = {
  activeMolstarPrepared: prepared, activeConfig: {}, normalizeMolstarStyle: s => s,
  sdfCollectionCartoonRepresentation: () => ({ type: 'cartoon' }),
  sdfCollectionLigandRepresentationForStyle: () => ({ type: 'ball-and-stick' }),
  applyMolstarRepresentationsToStructures: async (_v, _s, repr) => routes.push(repr.type),
  applyMolstarPolymerLigandRepresentationToStructures: async () => routes.push('partition'),
  configuredMolstarAppearance: () => 'illustrative', applyMolstarAppearance: async () => {},
};
runInNewContext(extract('applySdfCollectionMolstarStyle'), styleContext);
for (const polymerResidueCount of [0, 3]) {
  await styleContext.applySdfCollectionMolstarStyle(viewer, 'illustrative', [{ cell: { obj: { data: { polymerResidueCount } } } }]);
}
assert.deepEqual(routes, ['ball-and-stick', 'partition']);
console.log('Failed passes remain retryable; Match retains SDF components without changing protein routing');

// Native asset-origin storage can throw: the next action must still see every
// previously chosen setting, while another document keeps its own defaults.
const preferences = {
  sceneContextPreferences: new Map(), activeConfig: { documentId: 'one' },
  SDF_CONTEXT_STYLE_STORAGE_KEY: 'style', SDF_CONTEXT_OPACITY_STORAGE_KEY: 'opacity', SDF_CONTEXT_COLOR_STORAGE_KEY: 'color',
  window: { get localStorage() { throw Error('SecurityError'); } },
};
runInNewContext(['readSceneContextPreference', 'writeSceneContextPreference',
  ...['Style', 'Opacity', 'Color'].flatMap(suffix => [`normalizeSdfCollectionContext${suffix}`, `sdfCollectionContext${suffix}StorageKey`, `readSdfCollectionContext${suffix}`, `setSdfCollectionContext${suffix}`]),
  'readXyzFrameContextColor'].map(extract).join('\n'), preferences);
preferences.setSdfCollectionContextStyle('line');
preferences.setSdfCollectionContextColor('gray');
preferences.setSdfCollectionContextOpacity(0.7);
const readPreferences = config => ['Style', 'Color', 'Opacity'].map(suffix => preferences[`readSdfCollectionContext${suffix}`](config));
assert.deepEqual(readPreferences(preferences.activeConfig), ['line', 'gray', 0.7]);
assert.deepEqual(readPreferences({ documentId: 'two' }), ['match', 'colored', 0.4]);
preferences.setSdfCollectionContextColor('colored');
assert.equal(preferences.readXyzFrameContextColor(preferences.activeConfig), 'colored');
console.log('Native storage failures preserve complete background choices with document isolation');

// Surface tasks yield within state commits. Render only a completed snapshot,
// and reuse its child index when resolving editable measurement descendants.
const scheduled = [];
const updateState = { value: true };
let renders = 0, reports = 0;
const treeContext = {
  sceneTreeRenderHandle: 0,
  window: { setTimeout: fn => { scheduled.push(fn); return scheduled.length; } },
  activeMolstarViewer: () => ({ plugin: { behaviors: { state: { isUpdating: updateState } } } }),
  renderSceneTree: () => renders++, reportMolstarCompositionVisibility: () => reports++,
};
runInNewContext(extract('scheduleSceneTreeRender'), treeContext);
treeContext.scheduleSceneTreeRender();
treeContext.scheduleSceneTreeRender();
assert.equal(scheduled.length, 1);
scheduled.shift()();
assert.deepEqual([renders, reports], [0, 0]);
updateState.value = false;
treeContext.scheduleSceneTreeRender();
scheduled.shift()();
assert.deepEqual([renders, reports], [1, 1]);
const cells = new Map([
  ['root', { transform: { parent: 'root' } }],
  ['structure', { transform: { parent: 'root' } }],
  ['measurement', { transform: { parent: 'structure', params: { textColor: 1 } }, obj: { label: 'Distance' } }],
]);
let scans = 0;
const forEach = cells.forEach.bind(cells);
cells.forEach = (...args) => { scans++; return forEach(...args); };
const measurementContext = { SCENE_TREE_MEASUREMENT_PARAM_KEYS: new Set(['textColor']) };
runInNewContext(['sceneTreeChildRefs', 'sceneTreeSubtreeRefs', 'sceneTreeMeasurementTargets'].map(extract).join(''), measurementContext);
const treeState = { cells };
const treeViewer = { plugin: { state: { data: treeState } } };
const childIndex = measurementContext.sceneTreeChildRefs(treeState).children;
for (const ref of ['root', 'structure', 'measurement']) {
  assert.equal(measurementContext.sceneTreeMeasurementTargets(treeViewer, ref, childIndex)[0], cells.get('measurement'));
}
assert.equal(scans, 1);
assert.equal(measurementContext.sceneTreeMeasurementTargets(treeViewer, 'structure')[0], cells.get('measurement'));
assert.equal(scans, 2); // Independent inspector actions build a fresh index.
