import { Canvas3DParams, Canvas3DContext } from 'molstar/lib/mol-canvas3d/canvas3d.js';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition.js';
import { deepEqual } from 'molstar/lib/mol-util/index.js';
import { PluginStateSnapshotManager } from 'molstar/lib/mol-plugin-state/manager/snapshots.js';

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
  return { canvasDelta, contextDelta };
}
function capture(plugin) {
  const snapshots = snapshotOwner(plugin), values = data(plugin);
  return { ...values, owner: { snapshots, canvas: plugin.canvas3d ?? null, context: plugin.canvas3dContext ?? null, fingerprint: JSON.stringify(values) } };
}
function validate(plugin, owner) {
  sameSnapshot(plugin, owner.snapshots);
  if ((plugin.canvas3d ?? null) !== owner.canvas || (plugin.canvas3dContext ?? null) !== owner.context || JSON.stringify(data(plugin)) !== owner.fingerprint) fail('The viewer settings changed while topology was prepared.');
  return true;
}
function validateData(value) {
  json(value.canvasDelta); json(value.contextDelta);
  const canvas = value.canvasDelta === null ? null : full(Canvas3DParams, value.canvasDelta, defaults);
  const context = value.contextDelta === null ? null : full(Canvas3DContext.Params, value.contextDelta, contextDefaults);
  if (canvas) resourceGuard(canvas);
  return { canvas, context };
}
function prepare(plugin, value) {
  const values = validateData(value), snapshots = snapshotOwner(plugin);
  if (values.canvas && typeof plugin.canvas3d?.setProps !== 'function' || values.context && typeof plugin.canvas3dContext?.setProps !== 'function') fail('The candidate has no matching settings owner.');
  return { ...values, snapshots, canvasOwner: plugin.canvas3d ?? null, contextOwner: plugin.canvas3dContext ?? null };
}
function apply(plugin, value) {
  sameSnapshot(plugin, value.snapshots);
  if ((plugin.canvas3d ?? null) !== value.canvasOwner || (plugin.canvas3dContext ?? null) !== value.contextOwner) fail('The candidate settings owner changed.');
  if (value.context) plugin.canvas3dContext.setProps(value.context);
  if (value.canvas) plugin.canvas3d.setProps(value.canvas);
}
export const BuretteTopologyEnvironment = { capture, validate, validateData, prepare, apply };
