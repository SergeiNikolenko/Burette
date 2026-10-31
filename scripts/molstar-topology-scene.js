import { ElementSymbol } from 'molstar/lib/mol-model/structure/model/types.js';
import { Structure, StructureElement } from 'molstar/lib/mol-model/structure.js';
import { OrderedSet } from 'molstar/lib/mol-data/int.js';
import { StateTransformer } from 'molstar/lib/mol-state/transformer.js';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms.js';
import { UUID } from 'molstar/lib/mol-util/uuid.js';
import { IndexPairBonds } from 'molstar/lib/mol-model-formats/structure/property/bonds/index-pair.js';
import { Camera } from 'molstar/lib/mol-canvas3d/camera.js';
import { StructureRepresentationStateBuilder } from 'molstar/lib/mol-repr/structure/representation.js';
import { deepEqual } from 'molstar/lib/mol-util/index.js';
import { BuretteGeometry } from './molstar-geometry.js';
import { listSceneLayers } from './molstar-scene-layers.js';

// A retained receipt guards audited child settings and camera as well as the Geometry owner.
// Transfers contain source atom indices; the host remaps them before restoring an unread candidate.
const receipts = new WeakMap();
const modelProviders = ['asym_id_offset', 'index', 'max_index'];
const structureProviders = ['index', 'max_index', 'molstar_accessible_surface_area', 'molstar_computed_interactions', 'molstar_computed_secondary_structure', 'molstar_computed_valence_model'];
const staticKinds = ['all', 'polymer', 'protein', 'nucleic', 'branched', 'ligand', 'non-standard', 'water', 'ion', 'lipid', 'coarse'];
const geometryType = StateTransformer.get('ms-plugin.burette-geometry-model');
const measurementKinds = ['Distance', 'Angle', 'Dihedral', 'Label', 'Orientation', 'Plane'];
const measurementTypes = measurementKinds.map(name => StateTransforms.Representation[`StructureSelections${name}3D`]);
const measurementSelectionType = StateTransforms.Model.MultiStructureSelectionFromBundle;
const sourceRoles = { raw: StateTransforms.Data.RawData, trajectory: StateTransforms.Model.TrajectoryFromXYZ, baseModel: StateTransforms.Model.ModelFromTrajectory,
  root: StateTransforms.Model.StructureFromModel, modelProperties: StateTransforms.Model.CustomModelProperties, structureProperties: StateTransforms.Model.CustomStructureProperties };
const componentType = StateTransforms.Model.StructureComponent, representationType = StateTransforms.Representation.StructureRepresentation3D;
const fail = message => { throw Object.assign(new Error(message), { code: 'UNSUPPORTED_TOPOLOGY_SCENE' }); };
const plain = value => value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
function copy(value, depth = 0) {
  if (depth > 20) fail('A scene setting exceeds the transfer depth limit.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(v => copy(v, depth + 1));
  if (!plain(value) || Object.keys(value).some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) fail('A scene setting cannot be retained.');
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v, depth + 1)]));
}
function visualState(state) {
  const names = ['visible', 'alphaFactor', 'pickable', 'colorOnly', 'syncManually', 'themeStrength', 'markerActions'];
  const visual = Object.fromEntries(names.map(k => [k, copy(state[k])]));
  if (!deepEqual(state, { ...StructureRepresentationStateBuilder.create(), ...visual })) fail('Custom visual decorations prevent topology editing.');
  const defaults = { ...StructureRepresentationStateBuilder.create(), syncManually: true };
  return Object.fromEntries(Object.entries(visual).filter(([k, v]) => !deepEqual(v, defaults[k])));
}
function flags(cell) {
  const names = ['isHidden', 'isCollapsed', 'isGhost', 'isLocked'];
  if (Object.keys(cell.state).some(k => !names.includes(k))) fail('Unsupported native cell state prevents topology editing.');
  return Object.fromEntries(names.filter(k => cell.state[k]).map(k => [k, true]));
}
function boundedTags(tags = []) {
  if (!Array.isArray(tags) || tags.length > 16 || new Set(tags).size !== tags.length || tags.some(t => typeof t !== 'string' || !t.length || t.length > 100)) fail('Invalid source role tags.');
  return tags.slice();
}
const wrongRoleTag = tag => ['burette-scene-layer-v1', 'structure-component-static-', 'structure-focus-'].some(prefix => tag.startsWith(prefix));
function sourceTagValues(tags) {
  const values = boundedTags(tags);
  if (values.some(t => wrongRoleTag(t) || ['measurement-group', 'measurement-order-label'].includes(t))) fail('Reserved source tags cannot be copied to this role.');
  return values;
}
function measurementGroupTags(tags) {
  const values = boundedTags(tags);
  if (!values.includes('measurement-group') || values.some(t => wrongRoleTag(t) || t === 'measurement-order-label')) fail('Reserved measurement group tags cannot be retained.');
  return values;
}
function descriptors(values, allowed = ['index', 'max_index']) { return values.every(p => allowed.includes(p.name)); }
function canonical(model) {
  if (model.sourceData.kind !== 'xyz' || !descriptors(model.customProperties.all, modelProviders)) fail('This model has unsupported atom properties.');
  const statics = ['index', 'asym_id_offset', 'max_index', '__CoarseGrained__', '__AtomicRadii__', '__srcIndexArray__', '__InvertedAtomSrcIndex__', '__IndexPairBonds__'];
  const dynamics = ['__TrajectoryInfo__', '__AsymIdCount__', 'ElementSetIntraBondCache', 'index_pair_bonds'];
  if (Object.keys(model._staticPropertyData).some(k => !statics.includes(k)) || Object.keys(model._dynamicPropertyData).some(k => !dynamics.includes(k))) fail('This model has unsupported atom properties.');
  const props = model.properties, entity = model.entities.data;
  const component = new Map([['MOL', { formula: '', formula_weight: 0, id: 'MOL', mon_nstd_flag: 'n', name: 'Unknown Molecule', type: 'other', pdbx_synonyms: [] }]]);
  const entityDefaults = { details: '', formula_weight: 0, id: '1', src_method: '', type: 'non-polymer', pdbx_description: ['Unknown Entity'], pdbx_number_of_molecules: 0, pdbx_parent_entity_id: '', pdbx_mutation: '', pdbx_fragment: '', pdbx_ec: [] };
  if (!keys(props, ['missingResidues', 'chemicalComponentMap', 'saccharideComponentMap', 'structAsymMap']) || props.missingResidues?.size !== 0
    || !(props.chemicalComponentMap instanceof Map) || !deepEqual([...props.chemicalComponentMap], [...component]) || props.saccharideComponentMap?.size !== 0
    || !(props.structAsymMap instanceof Map) || !deepEqual([...props.structAsymMap], [['A', { id: 'A', auth_id: 'A', entity_id: '1' }]])
    || entity._rowCount !== 1 || entity._columns.some(k => !Object.hasOwn(entityDefaults, k) || !deepEqual(entity[k].value(0), entityDefaults[k]))) fail('This XYZ model has noncanonical chemical metadata.');
  const h = model.atomicHierarchy, atoms = h.atoms, source = model.sourceData.data.molecules;
  if (source.length !== 1 || source[0].count !== atoms._rowCount) fail('The XYZ atom metadata has no single source frame.');
  const inverse = model._staticPropertyData.__InvertedAtomSrcIndex__;
  if (inverse !== undefined && (!keys(inverse, ['isIdentity', 'invertedIndex']) || typeof inverse.isIdentity !== 'boolean'
    || !(inverse.invertedIndex instanceof Int32Array) || inverse.invertedIndex.length !== atoms._rowCount
    || inverse.invertedIndex.some((_, i) => inverse.invertedIndex[h.atomSourceIndex.value(i)] !== i))) fail('The native atom-source cache is inconsistent.');
  for (let i = 0; i < atoms._rowCount; i++) {
    if (model.atomicConformation.atomId.value(i) !== i || h.atomSourceIndex.value(i) !== i || atoms.auth_atom_id.value(i) !== source[0].type_symbol.value(i)
      || atoms.label_atom_id.value(i) !== source[0].type_symbol.value(i) || atoms.type_symbol.value(i) !== ElementSymbol(source[0].type_symbol.value(i))
      || atoms.label_comp_id.value(i) !== 'MOL' || atoms.auth_comp_id.value(i) !== 'MOL' || atoms.label_alt_id.value(i) !== ''
      || atoms.pdbx_formal_charge.value(i) !== 0 || model.atomicConformation.occupancy.value(i) !== 1 || model.atomicConformation.B_iso_or_equiv.value(i) !== 0) fail('This XYZ model has noncanonical atom metadata.');
  }
  if (h.residues.group_PDB.value(0) !== '' || h.residues._rowCount !== 1 || h.chains._rowCount !== 1 || h.residues.label_seq_id.value(0) !== 1 || h.residues.auth_seq_id.value(0) !== 1
    || h.residues.pdbx_PDB_ins_code.value(0) !== '' || h.chains.label_asym_id.value(0) !== 'A' || h.chains.auth_asym_id.value(0) !== 'A'
    || h.chains.label_entity_id.value(0) !== '1') fail('This XYZ model has noncanonical residue metadata.');
}
function providerParams(cell, names) {
  const params = cell.params.values;
  if (!keys(params, ['autoAttach', 'properties']) || !Array.isArray(params.autoAttach) || !plain(params.properties)) fail('Invalid custom property parameters.');
  if (params.autoAttach.length || Object.keys(params.properties).some(k => !names.includes(k))) fail('A custom property provider prevents topology editing.');
  const data = cell.obj?.data, store = data?._staticPropertyData ?? data?.inheritedPropertyData;
  const attached = data?.customProperties?.all ?? data?.customPropertyDescriptors?.all ?? [];
  for (const name of ['index', 'max_index', 'asym_id_offset']) if (attached.some(p => p.name === name)
    && !deepEqual(store?.[name]?.data?.value, params.properties[name]?.value)) fail('A property value differs from its saved provider parameters.');
  return copy(params);
}
function sourceIndices(root, structure) {
  const result = [];
  for (const unit of structure.units) {
    if (unit.kind !== 0 || unit.model !== root.models[0] || !unit.conformation.operator.isIdentity) fail('A scene layer has no unique source atoms.');
    for (const element of unit.elements) result.push(unit.model.atomicHierarchy.atomSourceIndex.value(element));
  }
  result.sort((a, b) => a - b);
  if (!result.length || result.length > 256 || new Set(result).size !== result.length || result.some(i => !Number.isInteger(i) || i < 0 || i >= root.elementCount)) fail('A scene layer has invalid source atoms.');
  return result;
}
function structureProperties(structure, root = structure) {
  if (!descriptors(structure.customPropertyDescriptors.all)) fail('A structure property prevents topology editing.');
  for (const store of [structure.currentPropertyData, structure.inheritedPropertyData]) for (const [key, value] of Object.entries(store)) {
    if (!structureProviders.includes(key) || (!['index', 'max_index'].includes(key) && value?.data?.value !== undefined)
      || (['index', 'max_index'].includes(key) && !deepEqual(value, root.inheritedPropertyData[key]))) fail('Unsupported structure metadata prevents topology editing.');
  }
}
function lociIndices(root, loci) {
  if (!loci || loci.kind === 'empty-loci') return [];
  if (!StructureElement.Loci.is(loci)) fail('The current selection cannot be retained.');
  return StructureElement.Loci.isEmpty(loci) ? [] : sourceIndices(root, StructureElement.Loci.toStructure(loci));
}
function newLoci(root, indices) {
  const groups = new Map();
  for (const unit of root.units) {
    const selected = [];
    for (let i = 0; i < unit.elements.length; i++) if (indices.includes(unit.model.atomicHierarchy.atomSourceIndex.value(unit.elements[i]))) selected.push(i);
    if (selected.length) groups.set(unit, selected);
  }
  if ([...groups.values()].reduce((n, g) => n + g.length, 0) !== indices.length) fail('The topology selection atoms changed.');
  return StructureElement.Loci(root, [...groups].map(([unit, values]) => ({ unit, indices: OrderedSet.ofSortedArray(Int32Array.from(values)) })));
}
function rootFor(plugin) {
  const roots = plugin.managers.structure.hierarchy.current.structures;
  if (roots.length !== 1) fail('Topology editing requires one structure.');
  const cell = roots[0].cell, root = cell.obj?.data;
  if (cell.status !== 'ok' || root?.models.length !== 1 || root.elementCount < 1 || root.elementCount > 256 || root.units.length !== 1
    || root.units[0].kind !== 0 || !root.units[0].conformation.operator.isIdentity) fail('Topology editing requires one atomic XYZ model of at most 256 atoms.');
  canonical(root.models[0]);
  structureProperties(root);
  return { cell, root };
}
function audit(plugin) {
  if (plugin.managers.structure.focus.current) fail('Clear native focus before changing topology.');
  const state = plugin.state.data;
  if (state.tree.transforms.size > 10000) fail('The scene has too many objects.');
  const sceneRoot = state.cells.get(state.tree.root.ref);
  if (sceneRoot.transform.tags?.length || Object.values(flags(sceneRoot)).some(Boolean) || Object.keys(sceneRoot.params.values).length) fail('Unsupported scene-root metadata prevents topology editing.');
  const { cell: rootCell, root } = rootFor(plugin), known = new Set([state.tree.root.ref]);
  const decorators = [], components = [], sourceTags = {}, layers = new Map(listSceneLayers(plugin).map(l => [l.componentRef, l]));
  let raw, base, geometry;
  for (let cell = rootCell; cell && cell.transform.parent !== cell.transform.ref; cell = state.cells.get(cell.transform.parent)) {
    const type = cell.transform.transformer;
    if (type === StateTransforms.Data.RawData) raw = cell;
    else if (type === StateTransforms.Model.ModelFromTrajectory) { base = cell; canonical(cell.obj.data); }
    else if (type === StateTransforms.Model.CustomModelProperties) decorators.push({ kind: 'model', params: providerParams(cell, modelProviders), state: flags(cell) });
    else if (type === geometryType) geometry = cell;
    else if (![StateTransforms.Model.TrajectoryFromXYZ, StateTransforms.Model.StructureFromModel].includes(type)) fail('A foreign coordinate decorator prevents topology editing.');
    if (type === geometryType && cell.transform.tags?.length) fail('Geometry decorator tags cannot be retained.');
    const role = Object.keys(sourceRoles).find(name => sourceRoles[name] === type);
    if (role) sourceTags[role] = sourceTagValues(cell.transform.tags);
    if (cell !== rootCell && type !== StateTransforms.Model.CustomModelProperties && Object.values(flags(cell)).some(Boolean)) fail('Nondefault source-branch visibility prevents topology editing.');
    known.add(cell.transform.ref);
  }
  if (!raw || !base || base.params.values.modelIndex !== 0 || !deepEqual(rootCell.params.values, { type: { name: 'model', params: { dynamicBonds: false } } })) fail('The XYZ source branch is unsupported.');
  if (base.obj.data._dynamicPropertyData.index_pair_bonds) fail('Custom source bond metadata prevents topology editing.');
  if (geometry) {
    const original = Structure.ofModel(base.obj.data).units[0], graph = original.bonds;
    const bonds = { indexA: [], indexB: [], order: [], flag: [] };
    for (let i = 0; i < graph.a.length; i++) if (graph.a[i] < graph.b[i]) {
      bonds.indexA.push(original.model.atomicHierarchy.atomSourceIndex.value(original.elements[graph.a[i]]));
      bonds.indexB.push(original.model.atomicHierarchy.atomSourceIndex.value(original.elements[graph.b[i]]));
      bonds.order.push(graph.edgeProps.order[i]); bonds.flag.push(graph.edgeProps.flags[i]);
    }
    if (JSON.stringify(bonds) !== JSON.stringify(geometry.params.values.bonds)) fail('Custom bond metadata prevents topology editing.');
    const expected = IndexPairBonds.fromData({ count: root.elementCount, pairs: Object.fromEntries(Object.entries(bonds).map(([k, v]) => [k, { toArray: () => v }])) }, { maxDistance: -1 });
    if (!deepEqual(IndexPairBonds.Provider.get(root.models[0]), expected)) fail('Custom live bond metadata prevents topology editing.');
  } else if (base.obj.data._staticPropertyData.__IndexPairBonds__) fail('Custom bond metadata prevents topology editing.');
  let parent = rootCell;
  const children = [...(state.tree.children.get(parent.transform.ref) || [])];
  const props = children.map(ref => state.cells.get(ref)).filter(c => c.transform.transformer === StateTransforms.Model.CustomStructureProperties);
  if (props.length > 1) fail('Branched structure properties prevent topology editing.');
  if (props.length) {
    parent = props[0]; known.add(parent.transform.ref); sourceTags.structureProperties = sourceTagValues(parent.transform.tags);
    decorators.push({ kind: 'structure', params: providerParams(parent, structureProviders), state: flags(parent) });
  }
  for (const ref of state.tree.children.get(parent.transform.ref) || []) {
    const component = state.cells.get(ref);
    if (component.transform.transformer !== componentType || component.status !== 'ok') fail('A foreign structure child prevents topology editing.');
    structureProperties(component.obj.data, root);
    const layer = layers.get(ref), params = component.params.values;
    if (layer ? params.type.name !== 'bundle' : params.type.name !== 'static' || !staticKinds.includes(params.type.params)) fail('Only static components and owned scene layers can be retained.');
    const representations = [];
    known.add(ref);
    for (const child of state.tree.children.get(ref) || []) {
      const representation = state.cells.get(child);
      if (representation.transform.transformer !== representationType || representation.status !== 'ok') fail('A foreign component child prevents topology editing.');
      known.add(child);
      representations.push({ params: copy(representation.params.values), state: flags(representation), visual: visualState(representation.obj.data.repr.state), tags: copy(representation.transform.tags || []) });
    }
    const entry = { kind: layer ? 'bundle' : 'static', params: copy(layer ? { ...params, type: { name: 'bundle', params: null } } : params),
      state: flags(component), tags: copy(component.transform.tags || []), representations };
    if (layer) { entry.layerId = layer.layerId; entry.indices = sourceIndices(root, component.obj.data); }
    components.push(entry);
  }
  if (components.length > 32) fail('The scene has too many components.');
  // C2 carries normal group parameters, flags and source points; unknown annotation metadata refuses.
  const groups = [...state.cells.values()].filter(c => c.transform.tags?.includes('measurement-group'));
  if (groups.length > 1 || groups.some(c => c.transform.transformer !== StateTransforms.Misc.CreateGroup || c.transform.parent !== state.tree.root.ref
    || c.status !== 'ok')) fail('Only one normal native measurement group can be retained.');
  const group = groups[0];
  if (group) measurementGroupTags(group.transform.tags);
  for (const cell of state.cells.values()) if (!known.has(cell.transform.ref)) {
    const type = cell.transform.transformer;
    if (type === StateTransforms.Misc.CreateGroup && cell.transform.tags?.includes('measurement-group')) {
      const params = cell.params.values;
      if (cell !== group || !keys(params, ['label', 'description']) || typeof params.label !== 'string' || params.label.length > 256
        || (params.description !== undefined && (typeof params.description !== 'string' || params.description.length > 1024))
        || new TextEncoder().encode(JSON.stringify(params)).byteLength > 2048) fail('Invalid native measurement group metadata.');
      known.add(cell.transform.ref); continue;
    }
    if (type === measurementSelectionType || measurementTypes.includes(type)) {
      if (cell.status !== 'ok' || cell.transform.tags?.some(t => t !== 'measurement-order-label')) fail('Custom measurement tags cannot be retained.');
      const selection = type === measurementSelectionType ? cell : state.cells.get(cell.transform.parent), params = selection?.params?.values;
      if (!group || selection?.transform.transformer !== measurementSelectionType || selection.transform.parent !== group.transform.ref
        || !keys(params, ['selections', 'isTransitive', 'label']) || params.isTransitive !== true || !measurementKinds.includes(params.label)
        || !Array.isArray(params.selections) || !params.selections.length || params.selections.length > 8) fail('Unsupported native measurement selection metadata.');
      if (type !== measurementSelectionType && params.label !== measurementKinds[measurementTypes.indexOf(type)]) fail('Custom measurement selection labels cannot be retained.');
      for (const [i, point] of params.selections.entries()) {
        const key = ['Orientation', 'Plane'].includes(params.label) ? `l${i}` : 'abcd'[i];
        const groupIdValid = params.label === 'Distance' ? point.groupId === key : point.groupId === '' || point.groupId === undefined;
        if (!key || !keys(point, ['key', 'groupId', 'ref', 'bundle']) || point.key !== key || !groupIdValid) fail('Custom measurement point metadata cannot be retained.');
      }
      known.add(cell.transform.ref); continue;
    }
    fail('An unsupported scene object prevents topology editing.');
  }
  for (const component of components) if (component.kind === 'bundle') {
    const layer = [...layers.values()].find(l => l.layerId === component.layerId);
    const allowed = new Set([layer.componentRef, layer.representationRef]);
    for (const ref of allowed) for (const dependent of state.cells.get(ref).dependencies.dependentBy) if (!allowed.has(dependent.transform.ref)) fail('A foreign dependent prevents retaining this scene layer.');
  }
  const selection = [...new Set([...plugin.managers.structure.selection.entries.values()].flatMap(e => lociIndices(root, e.selection)))].sort((a, b) => a - b);
  const focus = null; // Focus behavior owns derived cells/settings; refuse rather than drop them.
  return { version: 1, atomCount: root.elementCount, rawLabel: raw.params.values.label, rootState: flags(rootCell), sourceTags, decorators, components, selection, focus, camera: plugin.canvas3d ? copy(plugin.canvas3d.camera.getSnapshot()) : null };
}
const keys = (value, names) => plain(value) && Object.keys(value).every(k => names.includes(k));
function transferFlags(value) {
  if (!keys(value, ['isHidden', 'isCollapsed', 'isGhost', 'isLocked']) || Object.values(value).some(v => typeof v !== 'boolean')) fail('Invalid scene visibility transfer.');
}
function appearance(value) {
  if (!keys(value, ['type', 'colorTheme', 'sizeTheme']) || !['ball-and-stick', 'spacefill', 'line', 'cartoon'].includes(value.type?.name)
    || !['element-symbol', 'chain-id', 'uniform'].includes(value.colorTheme?.name) || !['physical', 'uniform'].includes(value.sizeTheme?.name)) fail('An unsupported representation provider prevents topology editing.');
}
function indices(value, count) {
  if (!Array.isArray(value) || value.length > 256 || new Set(value).size !== value.length || value.some(i => !Number.isInteger(i) || i < 0 || i >= count)) fail('Invalid topology source indices.');
}
function validateTransfer(value) {
  if (!keys(value, ['version', 'atomCount', 'rawLabel', 'rootState', 'sourceTags', 'decorators', 'components', 'selection', 'focus', 'camera']) || value.version !== 1
    || !Number.isInteger(value.atomCount) || value.atomCount < 1 || value.atomCount > 256 || typeof value.rawLabel !== 'string' || value.rawLabel.length > 256
    || !Array.isArray(value.decorators) || value.decorators.length > 2 || !Array.isArray(value.components) || value.components.length > 32) fail('Invalid topology scene transfer.');
  transferFlags(value.rootState); indices(value.selection, value.atomCount);
  if (value.focus !== null) fail('Native focus transfer is unsupported.');
  if (value.camera !== null) {
    const defaults = Camera.createDefaultSnapshot();
    if (!keys(value.camera, Object.keys(defaults)) || Object.keys(value.camera).length !== Object.keys(defaults).length
      || !['perspective', 'orthographic'].includes(value.camera.mode) || typeof value.camera.clipFar !== 'boolean'
      || ['position', 'up', 'target'].some(k => !Array.isArray(value.camera[k]) || value.camera[k].length !== 3 || value.camera[k].some(n => !Number.isFinite(n)))
      || Object.keys(defaults).filter(k => typeof defaults[k] === 'number').some(k => !Number.isFinite(value.camera[k]))) fail('Invalid topology camera transfer.');
  }
  const seen = new Set();
  for (const d of value.decorators) {
    if (!keys(d, ['kind', 'params', 'state']) || !['model', 'structure'].includes(d.kind) || seen.has(d.kind)) fail('Invalid topology property transfer.');
    seen.add(d.kind); transferFlags(d.state);
    providerParams({ params: { values: d.params } }, d.kind === 'model' ? modelProviders : structureProviders);
  }
  const tagRoles = ['raw', 'trajectory', 'baseModel', 'root', ...value.decorators.map(d => `${d.kind}Properties`)];
  if (!keys(value.sourceTags, Object.keys(sourceRoles)) || Object.keys(value.sourceTags).length !== tagRoles.length || tagRoles.some(role => !Object.hasOwn(value.sourceTags, role))) fail('Invalid source tag roles.');
  for (const tags of Object.values(value.sourceTags)) sourceTagValues(tags);
  const layerIds = new Set();
  for (const item of value.components) {
    if (!keys(item, ['kind', 'params', 'state', 'tags', 'representations', 'indices', 'layerId']) || !['static', 'bundle'].includes(item.kind)
      || !keys(item.params, ['type', 'nullIfEmpty', 'label']) || item.params.type?.name !== item.kind || typeof item.params.label !== 'string'
      || typeof item.params.nullIfEmpty !== 'boolean' || !Array.isArray(item.representations) || item.representations.length > 8) fail('Invalid topology component transfer.');
    transferFlags(item.state);
    if (item.kind === 'static' ? !staticKinds.includes(item.params.type.params) : !/^[a-z][a-z0-9_-]{0,47}$/.test(item.layerId || '')) fail('Invalid topology component identity.');
    if (item.kind === 'bundle') {
      indices(item.indices, value.atomCount);
      if (!item.indices.length || layerIds.has(item.layerId)) fail('Invalid topology layer identity.');
      layerIds.add(item.layerId);
    } else if (item.indices !== undefined || item.layerId !== undefined) fail('Invalid static component identity.');
    for (const object of [item, ...item.representations]) {
      if (!Array.isArray(object.tags) || object.tags.length > 16 || object.tags.some(t => typeof t !== 'string' || t.length > 100)) fail('Invalid scene ownership tags.');
      const owned = object.tags.filter(t => t.startsWith('burette-scene-layer-v1'));
      if (item.kind === 'bundle' ? owned.length !== 2 || !owned.includes('burette-scene-layer-v1') || !owned.includes(`burette-scene-layer-v1:${item.layerId}`) : owned.length) fail('Invalid scene layer ownership.');
    }
    for (const r of item.representations) { if (!keys(r, ['params', 'state', 'visual', 'tags'])) fail('Invalid representation transfer.'); appearance(r.params); transferFlags(r.state);
      const v = r.visual;
      if (!keys(v, ['visible', 'alphaFactor', 'pickable', 'colorOnly', 'syncManually', 'themeStrength', 'markerActions'])
        || ['visible', 'pickable', 'colorOnly', 'syncManually'].some(k => v[k] !== undefined && typeof v[k] !== 'boolean')
        || (v.alphaFactor !== undefined && (!Number.isFinite(v.alphaFactor) || v.alphaFactor < 0 || v.alphaFactor > 1))
        || (v.markerActions !== undefined && (!Number.isInteger(v.markerActions) || v.markerActions < 0 || v.markerActions > 63))
        || (v.themeStrength !== undefined && (!keys(v.themeStrength, ['overpaint', 'transparency', 'emissive', 'substance', 'wiggle']) || Object.keys(v.themeStrength).length !== 5 || Object.values(v.themeStrength).some(n => !Number.isFinite(n))))) fail('Invalid representation visual state.'); }
  }
  return value;
}
function size(transfer) { if (new TextEncoder().encode(JSON.stringify(transfer)).byteLength > 6144) fail('Scene settings exceed the topology transfer limit.'); return transfer; }
function signature(plugin, data) {
  const cells = [...plugin.state.data.cells.values()].map(c => [c.transform.ref, flags(c), c.transform.tags || [],
    c.transform.transformer === StateTransforms.Misc.CreateGroup || c.transform.transformer === measurementSelectionType || measurementTypes.includes(c.transform.transformer) ? c.params?.values : null]);
  return JSON.stringify([data, cells, plugin.managers.structure.selection.getSnapshot(), plugin.managers.structure.focus.getSnapshot(), plugin.canvas3d?.camera.getSnapshot() ?? null]);
}
function capture(plugin, lease) {
  if (typeof lease !== 'string' || !lease) fail('Read Geometry before changing topology.');
  BuretteGeometry.capture(plugin, () => true, lease);
  const transfer = size(validateTransfer(audit(plugin))), receipt = UUID.create22();
  let values = receipts.get(plugin); if (!values) { values = new Map(); receipts.set(plugin, values); }
  values.set(receipt, { tree: plugin.state.data.tree, lease, signature: signature(plugin, transfer) });
  while (values.size > 16) values.delete(values.keys().next().value);
  BuretteGeometry.capture(plugin, () => true, lease);
  return { ...transfer, receipt };
}
function validate(plugin, receipt, lease) {
  const own = receipts.get(plugin)?.get(receipt);
  if (!own || own.lease !== lease || own.tree !== plugin.state.data.tree) fail('The scene changed while topology was prepared.');
  BuretteGeometry.capture(plugin, () => true, lease);
  if (own.signature !== signature(plugin, size(audit(plugin)))) fail('The scene changed while topology was prepared.');
  return true;
}
async function restore(plugin, value) {
  const transfer = size(validateTransfer(copy(value)));
  const { root, cell } = rootFor(plugin), state = plugin.state.data, tree = state.tree;
  if (root.elementCount !== transfer.atomCount || state.inTransaction || state.burettePreconditionVersion !== 1) fail('The candidate structure does not match the scene transfer.');
  audit(plugin);
  let parent = cell.transform.ref;
  const builder = state.build();
  for (const [role, tags] of Object.entries(transfer.sourceTags)) {
    const node = [...state.cells.values()].find(c => c.transform.transformer === sourceRoles[role]);
    if (!node) fail('The candidate source tag role differs.');
    builder.to(node).updateTagged(node.transform.params, tags);
  }
  for (const decorator of transfer.decorators) {
    const transformer = decorator.kind === 'model' ? StateTransforms.Model.CustomModelProperties : decorator.kind === 'structure' ? StateTransforms.Model.CustomStructureProperties : undefined;
    if (!transformer) fail('Invalid topology property transfer.');
    const existing = [...state.cells.values()].find(c => c.transform.transformer === transformer);
    if (!existing) fail('The candidate property branch differs.');
    builder.to(existing).update(decorator.params); builder.to(existing).updateState(decorator.state);
    if (decorator.kind === 'structure') parent = existing.transform.ref;
  }
  const raw = [...state.cells.values()].find(c => c.transform.transformer === StateTransforms.Data.RawData);
  builder.to(raw).update({ ...raw.params.values, label: transfer.rawLabel });
  for (const ref of state.tree.children.get(parent) || []) builder.delete(ref);
  const expected = [];
  for (const item of transfer.components) {
    if (!['static', 'bundle'].includes(item.kind) || !Array.isArray(item.representations) || item.representations.length > 8) fail('Invalid topology component transfer.');
    let params = item.params;
    if (item.kind === 'bundle') {
      const loci = newLoci(root, item.indices);
      params = { ...params, type: { name: 'bundle', params: StructureElement.Bundle.fromLoci(loci) } };
    } else if (params.type?.name !== 'static') fail('Invalid static component transfer.');
    const component = builder.to(parent).apply(componentType, params, { state: item.state, tags: item.tags });
    for (const repr of item.representations) expected.push({ ref: component.apply(representationType, repr.params, { state: repr.state, tags: repr.tags }).ref, visual: repr.visual });
  }
  builder.to(cell).updateState(transfer.rootState);
  await plugin.runTask(state.updateTree(builder.getTree(), { revertOnError: true, revertIfAborted: true, doNotUpdateCurrent: true,
    burettePrecondition() { if (state.tree !== tree || state.inTransaction) fail('The candidate scene changed.'); },
  }));
  if (expected.some(item => state.cells.get(item.ref)?.status !== 'ok')) fail('The scene settings could not be restored.');
  for (const item of expected) state.cells.get(item.ref).obj.data.repr.setState({ ...StructureRepresentationStateBuilder.create(), syncManually: true, ...item.visual });
  const currentRoot = rootFor(plugin).root;
  plugin.managers.structure.selection.clear();
  if (transfer.selection.length) plugin.managers.structure.selection.fromLoci('set', newLoci(currentRoot, transfer.selection), false);
  plugin.managers.structure.focus.clear();
  if (transfer.camera && plugin.canvas3d) plugin.managers.camera.setSnapshot(transfer.camera, 0);
  return true;
}
export const BuretteTopologyScene = { capture, validate, restore };
