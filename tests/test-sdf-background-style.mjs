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
  // Atom/bond styles use the batched collection scene; this exercises the
  // per-molecule path that surface representations keep.
  sdfCollectionRepresentationForStyle: () => ({ type: 'molecular-surface' }), window: {},
};
runInNewContext(['sdfCollectionStateKey', 'molstarRefsStillLoaded', 'sdfCollectionVisibilityStateStillLoaded',
  'molstarStructuresByRefs', 'applySdfCollectionVisibilityNow'].map(extract).join('\n'), context);
const state = context.activeSdfCollectionVisibilityState = {
  viewer, key: context.sdfCollectionStateKey(prepared, 'illustrative', true),
  activeIndex: 0, activeRefs: ['s0'], backgroundRefs: targets.map(s => s.cell.transform.ref),
  allRefsByIndex: targets.map(s => [s.cell.transform.ref]), appearanceKey: 'line|0.4|gray',
};
for (const style of ['ball-and-stick', 'spacefill', 'molecular-surface', 'blob-surface', 'match', 'line']) {
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

// Inspector opacity messages must use the same bounded appearance queue for
// docking scenes; a fast pointer must not enqueue one scene edit per pixel.
const dockingApplied = [];
let releaseDocking;
const dockingContext = {
  activeViewer: viewer, activeConfig: {}, activeMolstarPrepared: { dockingSceneMode: 'structureAll', poseCount: 3 },
  molstarSceneRebuildChain: Promise.resolve(), pendingSceneAppearance: new Map(),
  readTrajectoryControlIndex: () => 0, setSdfCollectionContextOpacity: value => value,
  withMolstarDrawHold: (_viewer, run) => run(),
  applyDockingSceneVisibilityNow: async (_viewer, _prepared, _pose, options) => {
    dockingApplied.push(options.contextOpacity);
    if (dockingApplied.length === 1) await new Promise(resolve => { releaseDocking = resolve; });
  },
};
runInNewContext(['queueMolstarSceneRebuild', 'applyDockingSceneVisibility', 'setSdfCollectionContextOpacityFromAction']
  .map(extract).join('\n'), dockingContext);
const firstOpacity = dockingContext.setSdfCollectionContextOpacityFromAction({ opacity: 0.4, notify: false });
await Promise.resolve();
const pendingOpacity = Array.from({ length: 60 }, (_, index) =>
  dockingContext.setSdfCollectionContextOpacityFromAction({ opacity: 0.41 + index * 0.01, notify: false }));
assert.deepEqual(dockingApplied, [0.4]);
assert.equal(dockingContext.pendingSceneAppearance.size, 1);
releaseDocking();
const opacityResults = await Promise.all([firstOpacity, ...pendingOpacity]);
assert.ok(opacityResults.every(result => result.ok));
assert.deepEqual(dockingApplied, [0.4, 1]);

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
const providers = new Map(['line', 'spacefill', 'molecular-surface', 'blob-surface', 'ball-and-stick'].map(name => [name, {
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
  molstarHydrogenRepresentation: representation => representation,
});
for (const type of providers.keys()) {
  assert.equal(await update(plugin, targets, [{ type, color: 'element-symbol', typeParams: { alpha: 0.4 } }]), true);
  assert.deepEqual(plain(params.get('r0')), {
    type: { name: type, params: { ...cache.get(targets[0].cell)[0].defaults, ignoreHydrogens: true, ignoreHydrogensVariant: 'non-polar', alpha: 0.4 } },
    colorTheme: { name: 'element-symbol', params: { carbonColor: 'element' } },
    sizeTheme: { name: 'physical', params: { scale: 1 } },
  });
}
assert.equal(commits, 1 + (providers.size - 1) * 2);
assert.equal(yields, providers.size - 1);
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
runInNewContext(extract('applySdfCollectionMolstarStyle') + extract('applySdfCollectionMolstarRepresentations')
  + extract('sdfCollectionRepresentationPlan'), styleContext);
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

// Surface tasks yield within state commits. Render only a completed snapshot.
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

// A completed pose step must remain selected when storage is denied and a
// later appearance action reads the active index (including a reparsed input).
{
  let selectedIndex = 0;
  const values = new Map();
  const poseContext = {
    activeConfig: { documentId: 'pose-storage', activeModel: 0 },
    activeMolstarPrepared: prepared, activeViewer: viewer, activeSdfPoseMode: 'all',
    activeSdfCollectionPoseSetter: null, trajectoryControlIndices: new Map(),
    sessionStorage: { getItem() { throw Error('SecurityError'); }, setItem() { throw Error('SecurityError'); } },
    setSdfCollectionContextStyle: value => value,
    setSdfCollectionContextColor: value => value,
    setSdfCollectionContextOpacity: value => value,
    applySdfCollectionVisibility: async (_viewer, _prepared, index) => { selectedIndex = index; },
    agentActionFailure: (_action, _code, message) => { throw Error(message); },
    postSdfCollectionContextChanged() {},
  };
  const names = ['trajectoryControlStorageKey', 'readTrajectoryControlIndex', 'writeTrajectoryControlIndex',
    'setSdfCollectionMoleculeFromAction', 'agentFrameIndexFailure', 'normalizeSdfCollectionContextStyle',
    ...['Style', 'Color', 'Opacity'].map(name => `setSdfCollectionContext${name}FromAction`)];
  runInNewContext(names.map(extract).join('\n'), poseContext);
  assert.equal((await poseContext.setSdfCollectionMoleculeFromAction({ index: 1 })).ok, true);
  assert.equal(selectedIndex, 1);
  poseContext.activeMolstarPrepared = { ...prepared };
  for (const [name, action] of [['Style', { style: 'line' }], ['Color', { color: 'gray' }], ['Opacity', { opacity: 0.4 }]]) {
    assert.equal((await poseContext[`setSdfCollectionContext${name}FromAction`](action)).ok, true);
    assert.equal(selectedIndex, 1, 'Appearance must retain Pose 2 even when session storage throws');
  }
  assert.equal(poseContext.readTrajectoryControlIndex({ documentId: 'other', activeModel: 3 }, prepared, 9), 3);
  // Successful persistence restores the position in a new page runtime.
  poseContext.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  await poseContext.setSdfCollectionMoleculeFromAction({ index: 2 });
  poseContext.trajectoryControlIndices.clear();
  assert.equal(poseContext.readTrajectoryControlIndex(poseContext.activeConfig, prepared, 9), 2);
}
console.log('Pose selection survives denied storage and subsequent background appearance actions');

// Agent background actions reject unknown values instead of silently applying
// Match/Colored/40%, and report the applied set so the inspector cannot show a
// stale choice. The inspector's own actions (notify: false) are not echoed.
{
  const stored = new Map();
  const posted = [];
  const appearanceContext = {
    activeConfig: { documentId: 'doc-1' }, activeMolstarPrepared: { kind: 'sdf-collection' },
    activeViewer: {}, activeSdfPoseMode: 'single',
    setSdfCollectionContextStyle: value => (stored.set('style', value), value),
    setSdfCollectionContextOpacity: value => (stored.set('opacity', value), value),
    setSdfCollectionContextColor: value => (stored.set('color', value), value),
    readSdfCollectionContextStyle: () => stored.get('style') ?? 'match',
    readSdfCollectionContextOpacity: () => stored.get('opacity') ?? 0.4,
    readSdfCollectionContextColor: () => stored.get('color') ?? 'colored',
    postHostMessage: message => posted.push(message),
  };
  runInNewContext(['agentActionFailure', 'normalizeSdfCollectionContextStyle', 'postSdfCollectionContextChanged',
    ...['Style', 'Color', 'Opacity'].map(name => `setSdfCollectionContext${name}FromAction`)].map(extract).join('\n'), appearanceContext);
  for (const [name, action, code] of [
    ['Style', { style: 'surface' }, 'INVALID_STYLE'],
    ['Color', { color: 'blue' }, 'INVALID_COLOR'],
    ['Opacity', { opacity: '0.7' }, 'INVALID_OPACITY'],
  ]) {
    assert.equal((await appearanceContext[`setSdfCollectionContext${name}FromAction`](action)).error.code, code);
  }
  assert.equal(stored.size, 0, 'Rejected values must not change stored preferences');
  assert.equal(posted.length, 0);
  await appearanceContext.setSdfCollectionContextStyleFromAction({ style: 'molecular-surface' });
  await appearanceContext.setSdfCollectionContextOpacityFromAction({ opacity: 0.7, notify: false });
  assert.deepEqual(plain(posted), [{ type: 'sdfContextChanged', documentId: 'doc-1', style: 'molecular-surface', opacity: 0.4, color: 'colored' }]);
}
console.log('Background agent actions validate values and notify the inspector');

// Match must fade the loaded preset's mixed representations, not replace a
// ligand's ball-and-stick with a cartoon or silently leave every pose opaque.
{
  let structures = [], loads = 0, focuses = 0, outlineSyncs = 0, waterPasses = 0;
  const hidden = new Map();
  const originalParams = role => ({
    type: { name: role === 2 ? 'line' : role ? 'ball-and-stick' : 'cartoon', params: { alpha: role === 1 ? 0.3 : 1, sizeFactor: role ? 0.2 : 0.8 } },
    colorTheme: { name: role ? 'element-symbol' : 'chain-id', params: { value: role } },
  });
  const sceneViewer = { plugin: {
    clear: async () => { structures = []; hidden.clear(); },
    state: { data: {
      get cells() {
        return new Map(structures.flatMap(s => s.components.flatMap(c => c.representations.map(r => [r.cell.transform.ref, r.cell]))));
      },
      updateCellState: (ref, value) => hidden.set(ref, value.isHidden),
      build: () => {
        const updates = [];
        return {
          to: ref => ({ update: change => updates.push([ref, change]) }),
          commit: async () => {
            for (const [ref, change] of updates) {
              const representation = structures.flatMap(s => s.components.flatMap(c => c.representations))
                .find(r => r.cell.transform.ref === ref);
              representation.cell.transform.params = change(representation.cell.transform.params);
            }
          },
        };
      },
    } },
  } };
  const prepared = { kind: 'docking', dockingSceneMode: 'structureAll', poses: ['a', 'b', 'c'] };
  const config = { style: 'illustrative', contextStyle: 'match', opacity: 0.4, color: 'gray' };
  const ctx = {
    activeConfig: config, activeSdfPoseMode: 'all', activeDockingSceneVisibilityState: null,
    dockingSceneStateKey: (_prepared, style) => style, molstarCurrentStructures: () => structures,
    normalizeMolstarStyle: value => value, configuredMolstarStyle: value => value.style,
    readSdfCollectionContextStyle: value => value.contextStyle,
    readSdfCollectionContextOpacity: value => value.opacity, readSdfCollectionContextColor: value => value.color,
    resetXyzFrameOverlayState() {}, resetSdfCollectionVisibilityState() {}, resetDockingPoseCollectionState() {},
    loadMolstarEntry: async (_viewer, ref) => {
      loads++;
      structures.push({ cell: { transform: { ref } }, components: [0, 1, 2].map(role => ({
        key: role === 2 ? 'water' : 'polymer',
        cell: { transform: { ref: `${ref}-c${role}` } },
        representations: [{ cell: { transform: { ref: `${ref}-r${role}`, params: originalParams(role) } } }],
      })) });
    },
    applyMolstarStyle: async () => {},
    applyMolstarWaterLineRepresentation: async () => {
      waterPasses++;
      for (const structure of structures) {
        structure.components[2].representations[0].cell.transform.params = originalParams(2);
      }
    },
    applySdfCollectionMolstarStyle: async (_viewer, style, targets, alpha) => {
      for (const structure of targets) for (const component of structure.components) {
        component.representations[0].cell.transform.params = { type: { name: style, params: { alpha } }, colorTheme: { name: 'uniform' } };
      }
    },
    isMolstarWaterComponent: component => component.key === 'water', isMolstarBoxComponent: () => false,
    syncMolstarOutlineTransparency: () => outlineSyncs++, activeStructureAlignmentControl: null,
    document: { querySelector: () => null }, updateStructureOverlayToggleButton() {},
    scheduleMolstarStructureFocus: () => focuses++,
  };
  runInNewContext(['resetDockingSceneVisibilityState', 'molstarStructureCellRefs', 'dockingSceneVisibilityStateStillLoaded',
    'setDockingSceneRefsHidden', 'dockingSceneStructuresByPose', 'dockingSceneStyleNeedsReload', 'applyDockingSceneMatchAppearance',
    'styleDockingScenePoses', 'ensureDockingSceneState', 'showDockingScenePoses', 'applyDockingSceneSinglePose',
    'applyDockingSceneOverlayPoses', 'dockingSceneBackgroundStyle', 'applyDockingSceneVisibilityNow'].map(extract).join('\n'), ctx);
  const all = index => ctx.applyDockingSceneOverlayPoses(sceneViewer, prepared, index, { focus: false });
  const params = index => structures[index].components.map(c => c.representations[0].cell.transform.params);
  const alphas = index => params(index).map(p => Number(p.type.params.alpha.toFixed(6)));
  await all(0);
  const originalComponents = structures.flatMap(s => s.components);
  assert.deepEqual(alphas(0), [1, 0.3, 1]);
  assert.deepEqual(alphas(1), [0.4, 0.12, 0.4]);
  assert.deepEqual(params(1).map(p => p.type.name), ['cartoon', 'ball-and-stick', 'line']);
  config.opacity = 0.19;
  await all(0);
  assert.deepEqual(alphas(1), [0.19, 0.057, 0.19]);
  structures.flatMap(s => s.components).forEach((component, index) => assert.equal(component, originalComponents[index]));
  assert.equal(loads, 3, 'opacity does not reload the scene');
  assert.equal(focuses, 1, 'opacity does not refocus the camera');
  config.color = 'colored'; await all(0);
  assert.deepEqual(plain(params(1).map(p => p.colorTheme)), [originalParams(0).colorTheme, originalParams(1).colorTheme, originalParams(2).colorTheme]);
  await all(1);
  assert.deepEqual(alphas(0), [0.19, 0.057, 0.19]);
  assert.deepEqual(alphas(1), [1, 0.3, 1]);
  await ctx.applyDockingSceneSinglePose(sceneViewer, prepared, 2, { focus: false });
  assert.deepEqual(alphas(2), [1, 0.3, 1]);
  assert.equal(hidden.get('c'), false); assert.equal(hidden.get('a'), true);
  assert.equal(loads, 3, 'Match pose switches and Single reuse the loaded geometry');
  assert.equal(waterPasses, 1, 'Match edits must not rebuild water or reset background alpha');
  await all(0);
  const edited = sceneViewer.plugin.state.data.cells.get('b-r0');
  const red = { name: 'uniform', params: { value: 0xff0000 } };
  edited.transform.params = { ...edited.transform.params, colorTheme: red };
  ctx.activeMolstarViewer = () => sceneViewer;
  ctx.updateSceneTreeRepresentation = async (ref, change) => {
    const update = sceneViewer.plugin.state.data.build();
    update.to(ref).update(change);
    await update.commit();
  };
  runInNewContext(extract('applySceneTreeReprAlpha'), ctx);
  await ctx.applySceneTreeReprAlpha('b-r0', 0.6);
  await ctx.applyDockingSceneSinglePose(sceneViewer, prepared, 1, { focus: false });
  assert.equal(params(1)[0].type.params.alpha, 0.6, 'Single immediately preserves a later explicit alpha edit');
  assert.deepEqual(plain(params(1)[0].colorTheme), red);
  await all(0);
  config.opacity = 0.2; await all(0);
  assert.equal(params(1)[0].type.params.alpha, 0.12, 'a subsequent context factor uses the explicit alpha as its base');
  assert.deepEqual(plain(params(1)[0].colorTheme), red, 'opacity must retain a later custom colour');
  await ctx.applyDockingSceneSinglePose(sceneViewer, prepared, 1, { focus: false });
  assert.equal(params(1)[0].type.params.alpha, 0.6, 'Single restores the explicit scene-tree alpha, not the first cached value');
  assert.deepEqual(plain(params(1)[0].colorTheme), red);
  config.opacity = 0.19;
  config.contextStyle = 'line'; await all(2);
  assert.equal(params(0)[0].type.name, 'line');
  await all(0);
  assert.deepEqual(alphas(0), [1, 1, 1], 'a non-Match backdrop becoming foreground uses the existing full-opacity restyler');
  assert.equal(params(0)[0].type.name, 'illustrative', 'the old backdrop type must not become a cached native preset');
  config.contextStyle = 'match'; await all(2);
  assert.equal(loads, 6, 'replaced non-Match geometry restores the native preset through the existing reload');
  assert.deepEqual(params(0).map(p => p.type.name), ['cartoon', 'ball-and-stick', 'line']);
  assert.deepEqual(alphas(0), [0.19, 0.057, 0.19]);
  assert.ok(outlineSyncs > 0);
  // The legacy renderer fallback also loads native presets rather than asking
  // for an empty preset and replacing it with a generic cartoon.
  delete sceneViewer.plugin.state.data.updateCellState;
  await ctx.applyDockingSceneVisibilityNow(sceneViewer, prepared, 0, { focus: false });
  assert.deepEqual(params(0).map(p => p.type.name), ['cartoon', 'ball-and-stick', 'line']);
  assert.deepEqual(alphas(0), [0.19, 0.057, 0.19]);
  assert.deepEqual(alphas(2), [1, 0.3, 1]);
}
console.log('Docking Match preserves native geometry, fades background, restores foreground and Single, and reuses poses');
