import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { StateTransformer } from '@molstar/core/state';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Task } from '@molstar/core/task';
import { CustomProperties } from '@molstar/model/model/custom-property';
import { Volume } from '@molstar/model/model/volume';
import { BodyLabels, computeCandidates, isBodyMaskCell, removeDustInPlace, flipHandednessInPlace } from '@molstar/volume-tools-extension/segmentor';
import { assignPolygons, assignRemainder, countVoxels } from '@molstar/volume-tools-extension/segmentor/internal/label-ops';

const EmptyDefinition = { bodies: [], nextId: 1, threshold: { kind: 'relative', relativeValue: 3 }, defaults: { extend: 6, softEdge: 2, pruneBelowThreshold: true }, preview: 'none' };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const vec3 = value => Array.isArray(value) && value.length === 3 && value.every(finite);

function validateDefinition(value) {
  if (!value || !Array.isArray(value.bodies) || value.bodies.length > 255) throw new Error('Invalid map body definitions.');
  const ids = new Set();
  let points = 0;
  for (const body of value.bodies) {
    if (!Number.isInteger(body.id) || body.id < 1 || body.id > 255 || ids.has(body.id) || typeof body.name !== 'string' || body.name.length > 100 || !Array.isArray(body.views) || body.views.length > 64) throw new Error('Invalid map body.');
    if (typeof body.remainder !== 'boolean' || !Number.isInteger(body.color) || body.color < 0 || body.color > 0xffffff) throw new Error('Invalid map body appearance.');
    ids.add(body.id);
    const viewIds = new Set();
    for (const key of ['extend', 'softEdge']) if (body[key] !== undefined && (!finite(body[key]) || body[key] < 0 || body[key] > 100)) throw new Error('Invalid body mask width.');
    for (const view of body.views) {
      if (typeof view.id !== 'string' || !view.id || view.id.length > 100 || viewIds.has(view.id) || typeof view.label !== 'string' || view.label.length > 100 || (view.inverted !== undefined && typeof view.inverted !== 'boolean')) throw new Error('Invalid map view.');
      viewIds.add(view.id);
      if (!Array.isArray(view.polygon) || view.polygon.length < 3 || view.polygon.length > 1024) throw new Error('Invalid map polygon.');
      points += view.polygon.length;
      if (points > 16384 || !view.polygon.every(point => Array.isArray(point) && point.length === 2 && point.every(finite))) throw new Error('Map polygons exceed the vertex limit.');
      for (const key of ['canvasWidth', 'canvasHeight', 'viewportWidth', 'viewportHeight']) if (!finite(view[key]) || view[key] <= 0 || view[key] > 65536) throw new Error('Invalid map view dimensions.');
      const camera = view.cameraSnapshot;
      if (!camera || !vec3(camera.position) || !vec3(camera.target) || !vec3(camera.up) || !finite(camera.radius) || camera.radius <= 0 || !['perspective', 'orthographic'].includes(camera.mode)) throw new Error('Invalid map view camera.');
    }
  }
  const iso = value.threshold;
  if (!iso || !['relative', 'absolute'].includes(iso.kind) || !finite(iso.kind === 'relative' ? iso.relativeValue : iso.absoluteValue)) throw new Error('Invalid map threshold.');
  for (const key of ['extend', 'softEdge']) if (!finite(value.defaults?.[key]) || value.defaults[key] < 0 || value.defaults[key] > 100) throw new Error('Invalid mask defaults.');
  if (typeof value.defaults.pruneBelowThreshold !== 'boolean') throw new Error('Invalid mask pruning option.');
  if (!['none', 'active', 'all'].includes(value.preview)) throw new Error('Invalid map preview.');
  if (!Number.isInteger(value.nextId) || value.nextId < 1 || value.nextId > 256 || [...ids].some(id => id >= value.nextId)) throw new Error('Invalid map body sequence.');
  if (JSON.stringify(value).length > 1024 * 1024) throw new Error('Map definitions exceed the 1 MiB limit.');
  return value;
}

async function restore(volume, definition, ctx) {
  validateDefinition(definition);
  const store = BodyLabels.ensure(volume);
  store.bodies = structuredClone(definition.bodies);
  store.nextId = definition.nextId;
  store.labels.fill(0);
  const threshold = Volume.IsoValue.toAbsolute(definition.threshold, volume.grid.stats).absoluteValue;
  const candidates = computeCandidates(volume, threshold);
  for (const body of store.bodies) if (!body.remainder && body.views.length) await assignPolygons(store.labels, candidates, volume, body.views, body.id, 'unassigned-only', ctx);
  const remainder = store.bodies.find(body => body.remainder);
  if (remainder) assignRemainder(store.labels, candidates, remainder.id);
  const counts = countVoxels(store.labels);
  store.bodies = store.bodies.map(body => ({ ...body, voxelCount: counts[body.id] }));
  BodyLabels.bump(store);
}

const Definitions = PluginStateTransform.BuiltIn({
  name: 'burette-volume-body-definitions', display: { name: 'Map bodies' }, from: SO.Volume.Data, to: SO.Volume.Data, isDecorator: true,
  params: { definition: PD.Value(EmptyDefinition, { isHidden: true }) }
})({
  apply({ a, params }) { return Task.create('Restore map bodies', async ctx => { await restore(a.data, params.definition, ctx); return new SO.Volume.Data(a.data, { label: a.label }); }); },
  update({ a, b, newParams }) { return Task.create('Update map bodies', async ctx => { await restore(a.data, newParams.definition, ctx); b.data = a.data; return StateTransformer.UpdateResult.Updated; }); }
});

const EditedMap = PluginStateTransform.BuiltIn({
  name: 'burette-edited-volume', display: { name: 'Map edits' }, from: SO.Volume.Data, to: SO.Volume.Data, isDecorator: true,
  params: { edits: PD.Value([], { isHidden: true }) }
})({
  apply({ a, params }) {
    return Task.create('Apply map edits', async ctx => {
      if (!Array.isArray(params.edits) || params.edits.length > 64 || JSON.stringify(params.edits).length > 16384) throw new Error('Map edits exceed the 64-operation limit.');
      if (!params.edits.length) return new SO.Volume.Data(a.data, { label: a.label });
      const source = a.data;
      const data = Float32Array.from(source.grid.cells.data);
      const volume = { ...source, grid: { ...source.grid, cells: { ...source.grid.cells, data }, stats: { ...source.grid.stats } }, customProperties: new CustomProperties(), _propertyData: {}, _localPropertyData: {} };
      for (const edit of params.edits) {
        await ctx.update({ message: 'Applying map edit' });
        if (edit.kind === 'flip') flipHandednessInPlace(volume);
        else if (edit.kind === 'dust' && finite(edit.threshold) && Number.isInteger(edit.minVoxels) && edit.minVoxels > 0 && edit.minVoxels <= 1e8) removeDustInPlace(volume, edit.minVoxels, edit.threshold);
        else throw new Error('Invalid map edit.');
      }
      return new SO.Volume.Data(volume, { label: a.label });
    });
  }
});

function definitionsCell(plugin, rootRef) {
  return [...plugin.state.data.cells.values()].find(cell => cell.transform.transformer === Definitions && (cell.transform.ref === rootRef || cell.transform.parent === rootRef || plugin.state.data.cells.get(cell.transform.parent)?.transform.parent === rootRef));
}

export const BuretteVolumeSegmentationState = {
  volumes(plugin) {
    return plugin.managers.volume.hierarchy.current.volumes.filter(v => !isBodyMaskCell(v.cell)).map(v => ({ ...v, cell: definitionsCell(plugin, v.cell.transform.ref) || v.cell }));
  },
  async attach(plugin, ref) {
    const existing = definitionsCell(plugin, ref);
    if (existing) return existing.transform.ref;
    const edit = plugin.state.data.build().to(ref).insert(EditedMap, {}, { state: { isGhost: true } });
    const bodies = edit.insert(Definitions, {}, { state: { isGhost: true } });
    await bodies.commit({ canUndo: false });
    return bodies.ref;
  },
  definition(plugin, ref) { return plugin.state.data.cells.get(ref)?.transform.params?.definition; },
  async addView(manager, bodyId, view) {
    validateDefinition({ bodies: manager.state.bodies.map(body => body.id === bodyId ? { ...body, views: [...body.views, view] } : body), nextId: manager.store.nextId, threshold: manager.state.threshold, defaults: manager.state.defaults, preview: manager.state.preview });
    await manager.addView(bodyId, view);
  },
  async persist(plugin, manager) {
    const ref = manager.state.targetVolumeRef;
    const cell = plugin.state.data.cells.get(ref);
    if (cell?.transform.transformer !== Definitions || manager.state.busy) return;
    const definition = validateDefinition({ bodies: manager.state.bodies, nextId: manager.store.nextId, threshold: manager.state.threshold, defaults: manager.state.defaults, preview: manager.state.preview });
    if (JSON.stringify(cell.transform.params.definition) === JSON.stringify(definition)) return;
    await plugin.state.data.build().to(ref).update({ definition: structuredClone(definition) }).commit({ canUndo: false });
  },
  editCount(plugin, ref) { return plugin.state.data.cells.get(plugin.state.data.cells.get(ref)?.transform.parent)?.transform.params?.edits?.length || 0; },
  async edit(plugin, manager, operation) {
    const ref = manager.state.targetVolumeRef;
    const edit = plugin.state.data.cells.get(plugin.state.data.cells.get(ref)?.transform.parent);
    if (edit?.transform.transformer !== EditedMap) return;
    const edits = edit.transform.params.edits.slice();
    if (operation === 'undo') edits.pop();
    else edits.push(operation);
    if (edits.length > 64) throw new Error('Map edits exceed the 64-operation limit.');
    await this.persist(plugin, manager);
    const definition = this.definition(plugin, ref);
    await manager.setPreview('none');
    await plugin.state.data.build().to(edit.transform.ref).update({ edits }).commit({ canUndo: false });
    await manager.setTargetVolume(ref);
    await manager.setDefaults(definition.defaults);
    await manager.buretteSetThreshold(definition.threshold);
    await manager.setPreview(definition.preview);
  }
};
