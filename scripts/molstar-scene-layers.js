import { StructureElement } from 'molstar/lib/mol-model/structure.js';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms.js';
import { createStructureRepresentationParams } from 'molstar/lib/mol-plugin-state/helpers/structure-representation-params.js';
import { deepEqual } from 'molstar/lib/mol-util/index.js';

const tag = 'burette-scene-layer-v1', prefix = `${tag}:`;
const componentType = StateTransforms.Model.StructureComponent;
const representationType = StateTransforms.Representation.StructureRepresentation3D;
const fail = message => { throw Object.assign(new Error(message), { code: 'INVALID_SCENE_LAYER' }); };
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(id);
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => allowed.includes(key));

function inventory(state) {
  if (state.tree.transforms.size > 10000) fail('Scene layers support at most 10000 state nodes.');
  const layers = new Map();
  state.tree.transforms.forEach(transform => {
    const tags = transform.tags || [], ids = tags.filter(value => value.startsWith(prefix));
    if (!ids.length && !tags.includes(tag)) return;
    if (ids.length !== 1 || !tags.includes(tag) || !validId(ids[0].slice(prefix.length))) fail('Layer ownership tags are ambiguous.');
    const id = ids[0].slice(prefix.length), layer = layers.get(id) || { layerId: id };
    const role = transform.transformer === componentType ? 'component' : transform.transformer === representationType ? 'representation' : undefined;
    const cell = state.cells.get(transform.ref);
    if (!role || layer[role] || cell?.status !== 'ok' || !cell.obj?.data) fail('Layer ownership or state is unavailable.');
    layer[role] = cell;
    layers.set(id, layer);
  });
  if (layers.size > 32) fail('At most 32 named scene layers are supported.');
  for (const layer of layers.values()) {
    if (!layer.component || !layer.representation || layer.representation.transform.parent !== layer.component.transform.ref
      || layer.component.params?.values?.type?.name !== 'bundle') fail('A layer must own one bundle component and one representation.');
  }
  return layers;
}

function assertExclusive(state, layer) {
  const refs = new Set([layer.component.transform.ref, layer.representation.transform.ref]);
  for (const ref of refs) {
    for (const child of state.tree.children.get(ref) || []) if (!refs.has(child)) fail('A foreign descendant prevents changing this layer.');
    for (const dependent of state.tree.dependencies.get(ref) || []) if (!refs.has(dependent)) fail('A foreign dependent prevents changing this layer.');
    for (const dependent of state.cells.get(ref).dependencies.dependentBy) {
      if (!refs.has(dependent.transform.ref)) fail('A foreign resolved dependent prevents changing this layer.');
    }
  }
  return refs;
}

function parentFor(state, entry) {
  if (!entry) fail('The loaded structureId does not exist.');
  let ref = entry.ref;
  for (let depth = 0; depth < 64; depth++) {
    const cell = state.cells.get(ref);
    if (cell?.status !== 'ok') fail('The structure parent is unavailable.');
    const children = [...(state.tree.children.get(ref) || [])];
    const decorators = children.filter(child => state.cells.get(child)?.transform.transformer.definition.isDecorator);
    if (!decorators.length) {
      if (cell.obj?.data !== entry.data) fail('The selection and component parent have different coordinate spaces.');
      return ref;
    }
    if (decorators.length !== 1 || children.length !== 1) fail('Branched coordinate decorators are not supported.');
    ref = decorators[0];
    if (![StateTransforms.Model.TransformStructureConformation, StateTransforms.Model.CustomStructureProperties]
      .includes(state.cells.get(ref).transform.transformer)) fail('Unsupported structure decorator.');
  }
  fail('Structure decorator depth exceeds 64.');
}

function appearanceParams(plugin, structure, appearance) {
  if (!keys(appearance, ['type', 'color', 'opacity'])
    || !['cartoon', 'ball-and-stick', 'spacefill', 'line'].includes(appearance.type)
    || !keys(appearance.color, ['name', 'value'])
    || !['element-symbol', 'chain-id', 'uniform'].includes(appearance.color.name)
    || (appearance.color.name === 'uniform' ? !/^#[0-9a-f]{6}$/i.test(appearance.color.value || '') : appearance.color.value !== undefined)
    || (appearance.opacity !== undefined && (!Number.isFinite(appearance.opacity) || appearance.opacity < 0 || appearance.opacity > 1))) {
    fail('Use an allowed representation type, explicit color theme and opacity between 0 and 1.');
  }
  return createStructureRepresentationParams(plugin, structure, {
    type: appearance.type, color: appearance.color.name,
    colorParams: appearance.color.name === 'uniform' ? { value: parseInt(appearance.color.value.slice(1), 16) } : {},
    typeParams: { alpha: appearance.opacity ?? 1 },
  });
}

export function listSceneLayers(plugin) {
  return [...inventory(plugin.state.data).values()].sort((a, b) => a.layerId.localeCompare(b.layerId)).map(({ layerId, component, representation }) => ({
    layerId, componentRef: component.transform.ref, parentRef: component.transform.parent,
    representationRef: representation.transform.ref, label: component.obj.label,
    atomCount: component.obj.data.elementCount, visible: !representation.state.isHidden,
    representationVisible: representation.obj.data.repr.state.visible,
    appearance: { type: representation.params.values.type.name, opacity: representation.params.values.type.params.alpha,
      color: { name: representation.params.values.colorTheme.name,
        ...(representation.params.values.colorTheme.name === 'uniform'
          ? { value: `#${representation.params.values.colorTheme.params.value.toString(16).padStart(6, '0')}` } : {}) } },
  }));
}

// One guarded data-tree update and Undo entry, not observer isolation. Camera,
// selection, foreign nodes and direct UI writes during the update are outside
// this transaction. Passing the immutable tree is required for visibility state.
export async function patchSceneLayers(plugin, { operations, dryRun = false, check, resolve }) {
  const state = plugin.state.data;
  if (state.burettePreconditionVersion !== 1) fail('Reload a runtime supporting conditional scene updates.');
  if (state.inTransaction) fail('Scene layers require an independent Undo transaction.');
  check();
  if (typeof dryRun !== 'boolean' || !Array.isArray(operations) || !operations.length || operations.length > 8) fail('A layer patch requires 1–8 operations and a boolean dryRun.');
  const tree = state.tree, layers = inventory(state), seen = new Set(), removed = new Set();
  const builder = state.build(), expected = [];
  let changed = false, count = layers.size;
  for (const operation of operations) {
    if (!keys(operation, ['type', 'layerId', 'structureId', 'expression', 'appearance', 'label', 'visible'])
      || !validId(operation.layerId) || seen.has(operation.layerId)
      || !['create', 'update', 'delete'].includes(operation.type)) fail('Use unique valid layer IDs and create/update/delete operations.');
    seen.add(operation.layerId);
    const layer = layers.get(operation.layerId), creating = operation.type === 'create';
    if (creating ? !!layer : !layer) fail('The layer already exists or the requested layer is missing.');
    if (layer) assertExclusive(state, layer);
    if (operation.type === 'delete') {
      if (Object.keys(operation).some(key => !['type', 'layerId'].includes(key))) fail('Delete accepts only type and layerId.');
      for (const ref of assertExclusive(state, layer)) removed.add(ref);
      builder.delete(layer.component.transform.ref);
      expected.push({ deleted: layer }); count--; changed = true; continue;
    }
    if (operation.visible !== undefined && typeof operation.visible !== 'boolean') fail('visible must be boolean.');
    if (operation.label !== undefined && (typeof operation.label !== 'string' || !operation.label.length
      || operation.label.length > 80 || /[\x00-\x1f\x7f<>]/.test(operation.label))) fail('label must be 1–80 plain-text characters.');
    if (creating && (!operation.expression || !operation.appearance)) fail('Create requires expression and appearance.');
    if (operation.expression === undefined && operation.structureId !== undefined) fail('structureId requires an expression.');
    let parent = layer?.component.transform.parent, componentParams = layer?.component.params.values;
    let structure = layer?.component.obj.data;
    if (operation.expression !== undefined) {
      const selection = resolve(operation);
      parent = parentFor(state, selection.entry);
      if (layer && parent !== layer.component.transform.parent) fail('Update cannot move a layer to another structure parent.');
      const loci = selection.loci, bundle = StructureElement.Bundle.fromLoci(loci);
      // Bundle groups equal index sets and may reorder operator-copy units.
      const canonical = value => StructureElement.Loci(value.structure, [...value.elements].sort((a, b) => a.unit.id - b.unit.id));
      if (bundle.hash !== selection.entry.data.hashCode
        || !StructureElement.Loci.areEqual(canonical(loci), canonical(StructureElement.Bundle.toLoci(bundle, selection.entry.data)))) fail('The exact selection cannot round-trip through its structure bundle.');
      structure = StructureElement.Loci.toStructure(loci);
      if (!structure.elementCount || structure.elementCount > 50000) fail('A layer requires 1–50000 selected atoms.');
      componentParams = { type: { name: 'bundle', params: bundle }, nullIfEmpty: true,
        label: operation.label ?? layer?.component.obj.label ?? operation.layerId };
    } else if (operation.label !== undefined) componentParams = { ...componentParams, label: operation.label };
    const representationParams = operation.appearance === undefined ? layer.representation.params.values
      : appearanceParams(plugin, structure, operation.appearance);
    const provider = plugin.representation.structure.registry.get(representationParams.type.name);
    if (!provider.isApplicable(structure)) fail('The representation is not applicable to the selected atoms.');
    const hidden = operation.visible === undefined ? !!layer?.representation.state.isHidden : !operation.visible;
    let componentRef = layer?.component.transform.ref, representationRef = layer?.representation.transform.ref;
    if (creating) {
      const tags = [tag, `${prefix}${operation.layerId}`];
      componentRef = builder.to(parent).apply(componentType, componentParams, { tags }).ref;
      representationRef = builder.to(componentRef).apply(representationType, representationParams, { tags, state: { isHidden: hidden } }).ref;
      count++; changed = true;
    } else {
      if (!deepEqual(componentParams, layer.component.params.values)) { builder.to(componentRef).update(componentParams); changed = true; }
      if (!deepEqual(representationParams, layer.representation.params.values)) { builder.to(representationRef).update(representationParams); changed = true; }
      if (hidden !== !!layer.representation.state.isHidden) { builder.to(representationRef).updateState({ isHidden: hidden }); changed = true; }
    }
    expected.push({ componentRef, representationRef, componentParams, representationParams, hidden });
  }
  if (count > 32) fail('At most 32 named scene layers are supported.');
  const candidate = builder.getTree();
  if (candidate.transforms.size > 10000) fail('The resulting scene would exceed 10000 state nodes.');
  tree.transforms.forEach(transform => {
    if (!candidate.transforms.has(transform.ref) && !removed.has(transform.ref)) fail('The patch would delete a foreign node or dependent.');
  });
  const summary = { scope: 'owned-representation-layers', applied: false, noOp: !changed, layerCount: count };
  if (dryRun || !changed) return summary;
  await plugin.runTask(state.updateTree(candidate, {
    canUndo: 'Edit Burette scene layers', revertOnError: true, revertIfAborted: true, doNotUpdateCurrent: true,
    burettePrecondition() {
      check();
      if (state.inTransaction) fail('Scene layers require an independent Undo transaction.');
      if (state.tree !== tree) fail('The scene tree changed while the patch waited.');
    },
  }));
  for (const item of expected) {
    if (item.deleted) {
      if (state.cells.has(item.deleted.component.transform.ref) || state.cells.has(item.deleted.representation.transform.ref)) fail('The layer deletion was reverted.');
    } else {
      const component = state.cells.get(item.componentRef), representation = state.cells.get(item.representationRef);
      if (component?.status !== 'ok' || representation?.status !== 'ok'
        || !deepEqual(component.params.values, item.componentParams) || !deepEqual(representation.params.values, item.representationParams)
        || !!representation.state.isHidden !== item.hidden) fail('The scene layer update failed or was reverted.');
    }
  }
  return { ...summary, applied: true };
}
