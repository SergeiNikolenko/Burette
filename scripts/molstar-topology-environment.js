import { ExtensionMap } from 'molstar/lib/apps/viewer/extensions.js';
import { FocusLoci, DefaultFocusLociBindings } from 'molstar/lib/mol-plugin/behavior/dynamic/camera.js';
import { PluginBehavior } from 'molstar/lib/mol-plugin/behavior.js';
import { StateTransformer } from 'molstar/lib/mol-state/index.js';
import { DefaultPluginSpec } from 'molstar/lib/mol-plugin/spec.js';
import { AnimateModelIndex } from 'molstar/lib/mol-plugin-state/animation/built-in/model-index.js';
import { Canvas3DParams, Canvas3DContext } from 'molstar/lib/mol-canvas3d/canvas3d.js';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition.js';
import { deepEqual } from 'molstar/lib/mol-util/index.js';
import { InteractivityManager } from 'molstar/lib/mol-plugin-state/manager/interactivity.js';
import { StructureComponentManager } from 'molstar/lib/mol-plugin-state/manager/structure/component.js';
import { PluginStateSnapshotManager } from 'molstar/lib/mol-plugin-state/manager/snapshots.js';

const nativeAnimations = DefaultPluginSpec().animations, animationRevisions = new WeakMap();
const managerRevisions = new WeakMap(), behaviorRevisions = new WeakMap();
const nativeBehaviors = [...DefaultPluginSpec().behaviors, ...Object.values(ExtensionMap)];
const interactivityDefaults = PD.getDefaultValues(InteractivityManager.Params), componentDefaults = PD.getDefaultValues(StructureComponentManager.OptionsParams);
const defaults = PD.getDefaultValues(Canvas3DParams), contextDefaults = PD.getDefaultValues(Canvas3DContext.Params);
const fail = message => { throw Object.assign(new Error(message), { code: 'UNSUPPORTED_TOPOLOGY_ENVIRONMENT' }); };
const plain = value => value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const copy = value => JSON.parse(JSON.stringify(value));
function object(value, keys) {
  if (!plain(value) || Reflect.ownKeys(value).some(k => typeof k !== 'string' || !keys.includes(k)
    || ['__proto__', 'constructor', 'prototype'].includes(k) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, k), 'value') || !Object.getOwnPropertyDescriptor(value, k).enumerable)) fail('Unknown or non-JSON canvas settings cannot be retained.');
}
function checked(schema, value, partial = false, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 8192 || depth > 24) fail('Canvas settings exceed the structural limit.');
  object(value, Object.keys(schema));
  const result = {};
  for (const [key, param] of Object.entries(schema)) {
    if (!Object.hasOwn(value, key)) { if (partial || param.isOptional) continue; fail('Canvas settings are incomplete.'); }
    result[key] = parameter(param, value[key], partial, budget, depth + 1);
  }
  return result;
}
function parameter(param, value, partial, budget, depth) {
  if (++budget.nodes > 8192 || depth > 24) fail('Canvas settings exceed the structural limit.');
  switch (param.type) {
    case 'group': return checked(param.params, value, partial, budget, depth);
    case 'mapped': {
      object(value, ['name', 'params']);
      if (Object.keys(value).length !== 2 || !param.select.options.some(([name]) => name === value.name)) fail('Unknown canvas variant.');
      return { name: value.name, params: parameter(param.map(value.name), value.params, false, budget, depth + 1) };
    }
    case 'object-list':
      if (!Array.isArray(value) || value.length > 64) fail('Canvas setting lists exceed the limit.');
      return Array.from(value, entry => checked(param.element, entry, false, budget, depth + 1));
    case 'multi-select':
      if (!Array.isArray(value) || value.length > param.options.length || new Set(value).size !== value.length || value.some(entry => !param.options.some(([option]) => option === entry))) fail('Invalid native multiple selection.'); return value.slice();
    case 'value':
      if (!deepEqual(value, param.defaultValue)) fail('Custom native input bindings cannot be retained.'); return copy(value);
    case 'select':
      if (!param.options.some(([option]) => option === value)) fail('Invalid canvas selection.'); return value;
    case 'boolean': if (typeof value !== 'boolean') fail('Invalid canvas boolean.'); return value;
    case 'text': if (typeof value !== 'string' || value.length > 1024) fail('Invalid canvas text.'); return value;
    case 'color': if (!Number.isInteger(value) || value < 0 || value > 0xffffff) fail('Invalid canvas color.'); return value;
    case 'number':
      // UI ranges are not validity ranges: native derived clipping can be outside them.
      if (!Number.isFinite(value) || Math.abs(value) > Math.max(1e12, Math.abs(param.defaultValue))) fail('Invalid canvas number.'); return value;
    case 'interval': case 'vec3': case 'mat4': {
      const count = { interval: 2, vec3: 3, mat4: 16 }[param.type];
      if (!Array.isArray(value) || value.length !== count || Array.from(value).some(n => !Number.isFinite(n) || Math.abs(n) > 1e12)) fail('Invalid canvas vector.');
      return value.slice();
    }
    default: fail('Resource-backed or unsupported canvas settings cannot be retained.');
  }
}
function json(value, seen = new Set(), depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 8192 || depth > 24) fail('Canvas JSON exceeds the depth limit.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return;
  if ((!plain(value) && !Array.isArray(value)) || seen.has(value)) fail('Canvas values must be finite plain JSON.');
  seen.add(value);
  if (Array.isArray(value) && (Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length)) fail('Canvas arrays must be dense plain JSON.');
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('Canvas values must be plain JSON properties.');
    json(descriptor.value, seen, depth + 1, budget);
  }
  seen.delete(value);
}
function resourceGuard(value) {
  if (['image', 'skybox'].includes(value?.postprocessing?.background?.variant?.name)) fail('Image and skybox resources cannot be retained by this topology transaction.');
}
function delta(schema, values, base) {
  const result = {};
  for (const [key, value] of Object.entries(values)) {
    if (schema[key].type === 'group') {
      const child = delta(schema[key].params, value, base[key]); if (Object.keys(child).length) result[key] = child;
    } else if (!deepEqual(value, base[key])) result[key] = copy(value);
  }
  return result;
}
function full(schema, changes, base) {
  const values = checked(schema, changes, true), result = copy(base);
  for (const [key, value] of Object.entries(values)) result[key] = schema[key].type === 'group' ? full(schema[key].params, value, base[key]) : value;
  return result;
}
function props(schema, values, base) {
  json(values);
  const verified = checked(schema, values);
  if (new TextEncoder().encode(JSON.stringify(verified)).byteLength > 32768) fail('Canvas settings exceed the byte limit.');
  return delta(schema, verified, base);
}
function snapshotOwner(plugin) {
  const manager = plugin.managers.snapshot, state = manager?.state;
  if (!state || state.entries.size > 1 || state.isPlaying || state.nextSnapshotDelayInMs !== PluginStateSnapshotManager.DefaultNextSnapshotDelayInMs) fail('This snapshot library cannot be retained by a topology edit.');
  const entry = state.entries.get(0), snapshot = entry?.snapshot, current = state.current, defaultId = manager.defaultSnapshotId;
  // Version-pinned private invariant, exactly matching native syncCurrent canReplace.
  if (entry && (!current || defaultId && current !== defaultId || manager.getEntry(current) !== entry || snapshot?.id !== current)) fail('This saved snapshot is not replaceable by the current scene.');
  if (entry && (!plain(entry) || !plain(snapshot) || typeof snapshot.id !== 'string' || snapshot.id.length > 128
    || !Number.isFinite(entry.timestamp) || entry.timestamp < 0 || entry.timestamp > 1e15
    || Reflect.ownKeys(entry).some(k => typeof k !== 'string' || !Object.hasOwn(Object.getOwnPropertyDescriptor(entry, k), 'value') || !['snapshot', 'timestamp'].includes(k) && entry[k] !== undefined))) fail('Named or resource-backed snapshot metadata cannot be retained.');
  return { manager, entries: state.entries, current, defaultId, entry, snapshot,
    stamp: entry?.timestamp, snapshotId: snapshot?.id };
}
function sameSnapshot(plugin, owner) {
  const next = snapshotOwner(plugin);
  if (Object.keys(owner).some(key => owner[key] !== next[key])) fail('The snapshot library changed while topology was prepared.');
}
function animationRevision(manager) {
  let record = animationRevisions.get(manager);
  if (!record) {
    record = { value: 0 }; animationRevisions.set(manager, record);
    manager.subscribe(manager.events.updated, () => { record.value++; }); // disposed by the native manager
  }
  return record.value;
}
function animationOwner(plugin) {
  const manager = plugin.managers.animation, current = manager?.current;
  if (!manager || manager.animations.length !== nativeAnimations.length || manager.animations.some((animation, index) => animation !== nativeAnimations[index])) fail('Custom native animation catalogs cannot be retained by a topology edit.');
  // Only the native stopped trajectory-animation default is representable by the new candidate.
  if (!current || current.anim !== AnimateModelIndex || manager.isAnimating || !manager.isStopped || manager.isApplying
    || plugin.behaviors.state.isAnimating.value || current.startedTime !== -1 || current.lastTime !== 0) fail('Native animation must be reset to its stopped default before changing topology.');
  const snapshot = manager.getSnapshot(), expected = { state: { params: { current: AnimateModelIndex.name }, animationState: 'stopped' },
    current: { paramValues: PD.getDefaultValues(AnimateModelIndex.params(plugin)), state: {} } };
  if (!deepEqual(snapshot, expected)) fail('Nondefault native animation settings cannot be retained by a topology edit.');
  return { manager, catalog: manager.animations, revision: animationRevision(manager), state: manager.state, current, params: current.paramValues, runtime: current.state, snapshot: JSON.stringify(snapshot) };
}
function sameAnimation(plugin, owner) {
  const next = animationOwner(plugin);
  if (Object.keys(owner).some(key => owner[key] !== next[key])) fail('Native animation changed while topology was prepared.');
}
function nativeOwners(plugin) {
  const interactivity = plugin.managers.interactivity, component = plugin.managers.structure.component;
  if (!(interactivity instanceof InteractivityManager) || !(component instanceof StructureComponentManager)) fail('The native settings managers are unavailable.');
  const result = { interactivity, component };
  for (const [key, manager, event] of [['interactivityRevision', interactivity, interactivity.events.propsUpdated], ['componentRevision', component, component.events.optionsUpdated]]) {
    let record = managerRevisions.get(manager);
    if (!record) {
      record = { value: 0 }; managerRevisions.set(manager, record);
      manager.subscribe(event, () => { record.value++; }); // native manager disposal owns the subscription
    }
    result[key] = record.value;
  }
  return result;
}
function sameNativeOwners(plugin, owner) {
  const next = nativeOwners(plugin);
  if (Object.keys(owner).some(key => owner[key] !== next[key])) fail('Native settings changed while topology was prepared.');
}
function nativeDefault(value, base) {
  if (Object.is(value, base)) return true;
  if (Array.isArray(base)) return Array.isArray(value) && value.length === base.length && Array.from(base).every((entry, index) => nativeDefault(value[index], entry));
  if (!plain(base) || !plain(value)) return false;
  object(value, Object.keys(base));
  return Object.keys(base).every(key => nativeDefault(value[key], base[key]));
}
// Burette's context menu owns secondary clicks; retain only its exact native-default derivative.
const contextFocusBindings = PD.clone(Object.fromEntries(Object.entries(DefaultFocusLociBindings).map(([name, binding]) => [name, {
  ...binding, triggers: binding.triggers.filter(trigger => !(Number(trigger.buttons) & 2)),
}])));
function behaviorParameter(transformer, key, param, value) {
  if (transformer === FocusLoci && key === 'bindings' && nativeDefault(value, contextFocusBindings)) return copy(value);
  json(value);
  return parameter(param, value, false, { nodes: 0 }, 0);
}
function behaviorState(plugin) {
  const state = plugin.state.behaviors, root = state.tree.root, categories = PluginBehavior.Categories;
  const catalog = nativeBehaviors.filter(b => state.cells.has(b.transformer.id));
  if (state.inTransaction || state.inUpdate || state.behaviors.isUpdating.value || state.burettePreconditionVersion !== 1 || state.cells.size !== catalog.length + Object.keys(categories).length + 1) fail('Custom or pending native behaviors cannot be retained.');
  function node(ref, transformer, parent, locked) {
    const cell = state.cells.get(ref), t = cell?.transform;
    if (!cell || cell.status !== 'ok' || t.transformer !== transformer || t.parent !== parent || t.tags?.length
      || !deepEqual(t.state, locked ? { isLocked: true } : {})) fail('Native behavior metadata cannot be retained.');
    return cell;
  }
  node(root.ref, StateTransformer.ROOT, root.ref, true);
  for (const [ref, label] of Object.entries(categories)) {
    if (!deepEqual(node(ref, PluginBehavior.CreateCategory, root.ref, true).params.values, { label })) fail('Native behavior category metadata cannot be retained.');
  }
  const values = {}, schemas = {};
  for (const { transformer } of catalog) {
    const cell = node(transformer.id, transformer, PluginBehavior.getCategoryId(transformer), false);
    const schema = typeof transformer.definition.params === 'function' ? transformer.definition.params(undefined, plugin) : transformer.definition.params || {};
    const base = PD.getDefaultValues(schema);
    // These dynamic provider trees require their own provider-identity transfer contract.
    for (const name of ['targetParams', 'surroundingsParams', 'nciParams']) if (name in base && !deepEqual(cell.params.values[name], base[name])) fail('Custom native focus representation providers cannot be retained.');
    schemas[transformer.id] = { transformer, schema, base };
    object(cell.params.values, Object.keys(schema));
    if (Object.keys(schema).some(key => !Object.hasOwn(cell.params.values, key) && base[key] !== undefined)) fail('Native behavior parameters are incomplete.');
    const changes = {};
    for (const [key, value] of Object.entries(cell.params.values)) if (!deepEqual(value, base[key]) && !(schema[key].type === 'value' && nativeDefault(value, base[key]))) {
      changes[key] = behaviorParameter(transformer, key, schema[key], value);
    }
    if (Object.keys(changes).length) values[transformer.id] = changes;
  }
  let record = behaviorRevisions.get(state);
  if (!record) {
    record = { value: 0 }; behaviorRevisions.set(state, record);
    state.events.changed.subscribe(() => { record.value++; }); // completed by native State.dispose
  }
  return { values, schemas, catalog: catalog.map(b => nativeBehaviors.indexOf(b)), owner: { state, tree: state.tree, revision: record.value, fingerprint: JSON.stringify(values) } };
}
function sameBehaviors(plugin, owner) {
  const next = behaviorState(plugin).owner;
  if (Object.keys(owner).some(key => owner[key] !== next[key])) fail('Native behaviors changed while topology was prepared.');
}
function data(plugin) {
  let canvasDelta = null, contextDelta = null;
  if (plugin.canvas3d) {
    if (typeof plugin.canvas3d.setProps !== 'function') fail('The canvas settings owner is unavailable.');
    canvasDelta = props(Canvas3DParams, plugin.canvas3d.props, defaults); resourceGuard(plugin.canvas3d.props);
  }
  if (plugin.canvas3dContext) {
    if (typeof plugin.canvas3dContext.setProps !== 'function') fail('The canvas context settings owner is unavailable.');
    contextDelta = props(Canvas3DContext.Params, plugin.canvas3dContext.props, contextDefaults);
  }
  return { canvasDelta, contextDelta,
    interactivityDelta: props(InteractivityManager.Params, plugin.managers.interactivity.props, interactivityDefaults),
    componentDelta: props(StructureComponentManager.OptionsParams, plugin.managers.structure.component.state.options, componentDefaults) };
}
function capture(plugin) {
  const snapshots = snapshotOwner(plugin), animation = animationOwner(plugin), native = nativeOwners(plugin), behaviors = behaviorState(plugin), values = data(plugin);
  return { ...values, behaviorDelta: behaviors.values, behaviorCatalog: behaviors.catalog, owner: { snapshots, animation, native, behaviors: behaviors.owner, canvas: plugin.canvas3d ?? null, context: plugin.canvas3dContext ?? null, fingerprint: JSON.stringify(values) } };
}
function validate(plugin, owner) {
  sameSnapshot(plugin, owner.snapshots); sameAnimation(plugin, owner.animation); sameNativeOwners(plugin, owner.native); sameBehaviors(plugin, owner.behaviors);
  if ((plugin.canvas3d ?? null) !== owner.canvas || (plugin.canvas3dContext ?? null) !== owner.context || JSON.stringify(data(plugin)) !== owner.fingerprint) fail('The viewer settings changed while topology was prepared.');
  return true;
}
function validateData(value) {
  json(value.canvasDelta); json(value.contextDelta);
  const canvas = value.canvasDelta === null ? null : full(Canvas3DParams, value.canvasDelta, defaults);
  const context = value.contextDelta === null ? null : full(Canvas3DContext.Params, value.contextDelta, contextDefaults);
  if (canvas) resourceGuard(canvas);
  json(value.interactivityDelta); json(value.componentDelta); json(value.behaviorDelta);
  object(value.behaviorDelta, nativeBehaviors.map(b => b.transformer.id));
  if (!Array.isArray(value.behaviorCatalog) || value.behaviorCatalog.length > nativeBehaviors.length || new Set(value.behaviorCatalog).size !== value.behaviorCatalog.length || value.behaviorCatalog.some(index => !Number.isInteger(index) || index < 0 || index >= nativeBehaviors.length) || Object.keys(value.behaviorDelta).some(id => !value.behaviorCatalog.includes(nativeBehaviors.findIndex(b => b.transformer.id === id)))) fail('Invalid native behavior catalog.');
  const interactivity = full(InteractivityManager.Params, value.interactivityDelta, interactivityDefaults);
  const component = full(StructureComponentManager.OptionsParams, value.componentDelta, componentDefaults);
  return { canvas, context, interactivity, component };
}
function prepare(plugin, value) {
  const snapshots = snapshotOwner(plugin), animation = animationOwner(plugin), native = nativeOwners(plugin), behaviors = behaviorState(plugin), values = validateData(value);
  if (!deepEqual(value.behaviorCatalog, behaviors.catalog)) fail('The candidate native behavior catalog differs.');
  const behaviorParams = {};
  for (const [id, { transformer, schema, base }] of Object.entries(behaviors.schemas)) {
    const changes = value.behaviorDelta[id] || {}, params = PD.clone(base);
    object(changes, Object.keys(schema));
    for (const [key, entry] of Object.entries(changes)) params[key] = behaviorParameter(transformer, key, schema[key], entry);
    for (const name of ['targetParams', 'surroundingsParams', 'nciParams']) if (name in base && !deepEqual(params[name], base[name])) fail('Custom native focus representation providers cannot be retained.');
    behaviorParams[id] = params;
  }
  if (values.canvas && typeof plugin.canvas3d?.setProps !== 'function' || values.context && typeof plugin.canvas3dContext?.setProps !== 'function') fail('The candidate has no matching settings owner.');
  return { ...values, snapshots, animation, native, behaviors: behaviors.owner, behaviorParams, canvasOwner: plugin.canvas3d ?? null, contextOwner: plugin.canvas3dContext ?? null };
}
async function apply(plugin, value) {
  sameSnapshot(plugin, value.snapshots); sameAnimation(plugin, value.animation); sameNativeOwners(plugin, value.native);
  if ((plugin.canvas3d ?? null) !== value.canvasOwner || (plugin.canvas3dContext ?? null) !== value.contextOwner) fail('The candidate settings owner changed.');
  sameBehaviors(plugin, value.behaviors);
  const state = plugin.state.behaviors, tree = state.build();
  for (const [ref, params] of Object.entries(value.behaviorParams)) if (!deepEqual(state.cells.get(ref).params.values, params)) tree.to(ref).update(params);
  await plugin.runTask(state.updateTree(tree, { revertOnError: true, revertIfAborted: true, doNotUpdateCurrent: true,
    burettePrecondition() { sameBehaviors(plugin, value.behaviors); },
  }));
  sameSnapshot(plugin, value.snapshots); sameAnimation(plugin, value.animation); sameNativeOwners(plugin, value.native);
  if ((plugin.canvas3d ?? null) !== value.canvasOwner || (plugin.canvas3dContext ?? null) !== value.contextOwner) fail('The candidate settings owner changed.');
  // Match native PluginState.setSnapshot: setOptions would overwrite the restored per-representation overrides.
  plugin.managers.structure.component._setSnapshotState(value.component);
  plugin.managers.interactivity.setProps(value.interactivity);
  if (value.context) plugin.canvas3dContext.setProps(value.context);
  if (value.canvas) plugin.canvas3d.setProps(value.canvas);
}
export const BuretteTopologyEnvironment = { capture, validate, validateData, prepare, apply };
