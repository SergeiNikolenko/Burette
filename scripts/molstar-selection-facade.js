import { OrderedSet } from 'molstar/lib/mol-data/int.js';
import { StructureElement, Unit } from 'molstar/lib/mol-model/structure.js';
import { measureGeometry } from './molecular-geometry.js';
import { groupExactAtoms } from './molecular-groups.js';
import { distanceIndex } from './molecular-spatial-index.js';
import { selectionBookmarks } from './molecular-selection-bookmarks.js';
import { listSceneLayers, patchSceneLayers } from './molstar-scene-layers.js';

const controllers = new WeakMap();
const fields = new Set(['structureId', 'modelId', 'modelIndex', 'unitId', 'instance_id',
  'atom_index', 'atom_id', 'residue_index', 'chain_index', 'label_entity_id', 'label_asym_id', 'auth_asym_id',
  'label_seq_id', 'auth_seq_id', 'pdbx_PDB_ins_code', 'label_comp_id', 'auth_comp_id',
  'label_atom_id', 'auth_atom_id', 'type_symbol', 'label_alt_id', 'occupancy']);
const kinds = new Set(['all', 'protein', 'nucleic', 'polymer', 'ligand', 'ion', 'water']);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const idOf = atom => JSON.stringify([atom.structureId, atom.modelId, atom.unitId, atom.atom_index]);

function predicate(expression, atoms, bindings, depth = 0, budget = { nodes: 0, spatial: 0, checks: 0 }) {
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)
    || depth > 8 || ++budget.nodes > 128) fail('INVALID_SELECTION', 'Selection expression exceeds its shape/depth/node limits.');
  const keys = Object.keys(expression);
  if (!keys.length || keys.some(key => !['kind', 'fields', 'ids', 'allOf', 'anyOf', 'not', 'within', 'byResidue', 'byChain', 'current', 'named'].includes(key))) {
    fail('INVALID_SELECTION', 'Use kind, fields, ids, allOf, anyOf, not, within, byResidue, byChain, current or named.');
  }
  const checks = [];
  if (expression.current !== undefined) {
    if (expression.current !== true) fail('INVALID_SELECTION', 'current must be true.');
    const ids = bindings.current();
    checks.push(atom => ids.has(idOf(atom)));
  }
  if (expression.named !== undefined) {
    const ids = bindings.named(expression.named);
    checks.push(atom => ids.has(idOf(atom)));
  }
  if (expression.kind !== undefined) {
    if (!kinds.has(expression.kind)) fail('INVALID_SELECTION', 'Unknown molecular kind.');
    checks.push(atom => expression.kind === 'all' || atom.kind === expression.kind
      || (expression.kind === 'polymer' && ['protein', 'nucleic'].includes(atom.kind)));
  }
  if (expression.fields !== undefined) {
    if (!expression.fields || typeof expression.fields !== 'object' || Array.isArray(expression.fields) || !Object.keys(expression.fields).length) fail('INVALID_SELECTION', 'fields must be a nonempty object.');
    for (const [key, expected] of Object.entries(expression.fields)) {
      const values = Array.isArray(expected) ? expected : [expected];
      if (!fields.has(key) || !values.length || values.length > 128
        || values.some(value => !['string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)) || String(value).length > 256)) {
        fail('INVALID_SELECTION', 'Invalid exact field or value.');
      }
      // No namespace fallback. Empty insertion/altloc explicitly means blank.
      checks.push(atom => values.some(value => {
        const actual = atom[key] ?? (['label_alt_id', 'pdbx_PDB_ins_code'].includes(key) ? '' : undefined);
        return actual !== undefined && String(actual) === String(value);
      }));
    }
  }
  if (expression.ids !== undefined) {
    if (!Array.isArray(expression.ids) || expression.ids.length > 256
      || expression.ids.some(id => typeof id !== 'string' || id.length > 512)) fail('INVALID_SELECTION', 'ids must contain at most 256 atom references.');
    const ids = new Set(expression.ids);
    checks.push(atom => ids.has(idOf(atom)));
  }
  for (const key of ['allOf', 'anyOf']) {
    if (expression[key] === undefined) continue;
    if (!Array.isArray(expression[key]) || !expression[key].length || expression[key].length > 32) fail('INVALID_SELECTION', `${key} needs 1–32 expressions.`);
    const children = expression[key].map(child => predicate(child, atoms, bindings, depth + 1, budget));
    checks.push(atom => key === 'allOf' ? children.every(test => test(atom)) : children.some(test => test(atom)));
  }
  if (expression.not !== undefined) {
    const test = predicate(expression.not, atoms, bindings, depth + 1, budget);
    checks.push(atom => !test(atom));
  }
  for (const [key, indexKey] of [['byResidue', 'residue_index'], ['byChain', 'chain_index']]) {
    if (expression[key] === undefined) continue;
    const test = predicate(expression[key], atoms, bindings, depth + 1, budget);
    const groupId = atom => {
      if (!Number.isInteger(atom[indexKey]) || atom[indexKey] < 0) fail('INVALID_SELECTION', 'Group expansion requires exact atomic-hierarchy indices.');
      return JSON.stringify([atom.structureId, atom.modelId, atom.unitId, atom[indexKey]]);
    };
    const ids = new Set(atoms.filter(test).map(groupId));
    checks.push(atom => ids.has(groupId(atom)));
  }
  if (expression.within !== undefined) {
    const within = expression.within;
    if (!within || typeof within !== 'object' || Array.isArray(within)
      || Object.keys(within).some(key => !['radiusAngstrom', 'of'].includes(key)) || ++budget.spatial > 4) fail('INVALID_SELECTION', 'within requires radiusAngstrom and of; at most 4 spatial nodes.');
    const test = predicate(within.of, atoms, bindings, depth + 1, budget);
    const reference = atoms.filter(test);
    if (reference.length > 5000) fail('INPUT_LIMIT', 'within supports at most 5000 reference atoms; input is never truncated.');
    const index = distanceIndex(reference, within.radiusAngstrom, budget);
    checks.push(atom => {
      let found = false;
      index.visitWithin(atom, () => { found = true; return false; });
      return found;
    });
  }
  return atom => checks.every(test => test(atom));
}

function create(plugin, source) {
  const sceneId = crypto.randomUUID();
  let revision = 1;
  const bookmarks = selectionBookmarks();
  const changed = () => { revision++; };
  // The revision guards atom addresses, the current selection and owned scene
  // layers. Camera motion and canvas settings change none of those, yet Mol*
  // emits camera events on every animation frame and after each scene commit
  // (radiusMax refits one frame after a new representation), so subscribing to
  // them made a mutation's returned revision stale before the caller could use it.
  const subscriptions = [plugin.state?.data?.events?.changed, plugin.state?.data?.events?.cell?.stateUpdated,
    plugin.managers?.structure?.selection?.events?.changed]
    .filter(event => event?.subscribe).map(event => event.subscribe(changed));
  function check(args, required = false) {
    if ((required || args.sceneId !== undefined) && args.sceneId !== sceneId) fail('STALE_SCENE', 'Query the current sceneId before using atom references.');
    if ((required || args.expectedRevision !== undefined) && args.expectedRevision !== revision) fail('STALE_REVISION', 'The scene changed; repeat the query.');
  }
  function resolve(args) {
    if (args.selectionVersion !== 1) fail('INVALID_SELECTION', 'selectionVersion must be 1.');
    const structures = source.structures();
    if (structures.some(entry => entry.data.units.some(unit => !Unit.isAtomic(unit)))) fail('UNSUPPORTED_STRUCTURE', 'Exact selection requires entirely atomic units.');
    const count = structures.reduce((sum, entry) => sum + (entry.data?.elementCount ?? 0), 0);
    if (count > 250000) fail('INPUT_LIMIT', 'Exact selection supports at most 250000 scene atoms; inputs are never truncated.');
    const atoms = source.atoms(250001);
    if (atoms.length > 250000) fail('INPUT_LIMIT', 'Exact selection supports at most 250000 scene atoms.');
    if (count && atoms.length !== count) fail('UNSUPPORTED_STRUCTURE', 'Exact selection requires an entirely atomic structure.');
    let available, selected;
    const test = predicate(args.expression, atoms, {
      current: () => selected ??= currentIds(structures),
      named: name => bookmarks.resolve(name, available ??= new Set(atoms.map(idOf))),
    });
    return { atoms, matched: atoms.filter(test), structures };
  }
  function page(args) {
    const offset = args.offset ?? 0, limit = args.limit ?? 32;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 32) fail('INVALID_PAGE', 'offset must be nonnegative; limit must be 1–32.');
    check(args, offset > 0);
    return { offset, limit };
  }
  function bounded(result) {
    if (new TextEncoder().encode(JSON.stringify(result)).length > 60000) fail('OUTPUT_LIMIT', 'Metadata exceeds the result limit; request a smaller page.');
    return result;
  }
  function lociFor(structures, atoms) {
    const ids = new Set(atoms.map(idOf));
    return structures.map(entry => StructureElement.Loci(entry.data, entry.data.units.flatMap(unit => {
      const indices = [];
      for (let index = 0; index < unit.elements.length; index++) {
        if (ids.has(idOf({ structureId: entry.ref, modelId: unit.model.id, unitId: unit.id, atom_index: unit.elements[index] }))) indices.push(index);
      }
      return indices.length ? [{ unit, indices: OrderedSet.ofSortedArray(Int32Array.from(indices)) }] : [];
    })));
  }
  function currentIds(structures) {
    const ids = new Set();
    for (const entry of structures) {
      const loci = plugin.managers.structure.selection.getLoci(entry.data);
      for (const element of loci.elements || []) OrderedSet.forEach(element.indices, index => {
        ids.add(idOf({ structureId: entry.ref, modelId: element.unit.model.id, unitId: element.unit.id, atom_index: element.unit.elements[index] }));
      });
    }
    return ids;
  }
  return {
    state: () => ({ sceneId, revision }),
    dispose() { for (const subscription of subscriptions) subscription.unsubscribe(); controllers.delete(plugin); },
    sceneLayers(args) {
      check(args);
      if (args.selectionVersion !== 1) fail('INVALID_SELECTION', 'selectionVersion must be 1.');
      return bounded({ sceneId, revision, layers: listSceneLayers(plugin) });
    },
    async patchLayers(args) {
      check(args, true);
      if (args.selectionVersion !== 1) fail('INVALID_SELECTION', 'selectionVersion must be 1.');
      const result = await patchSceneLayers(plugin, { operations: args.operations, dryRun: args.dryRun,
        check: () => check(args, true), resolve: operation => {
          if (typeof operation.structureId !== 'string' || !operation.structureId.length || operation.structureId.length > 512) fail('INVALID_SCENE_LAYER', 'An expression requires an exact loaded structureId.');
          const { matched, structures } = resolve({ selectionVersion: 1,
            expression: { allOf: [operation.expression, { fields: { structureId: operation.structureId } }] } });
          const entry = structures.find(item => item.ref === operation.structureId);
          if (!entry) fail('INVALID_SCENE_LAYER', 'The loaded structureId does not exist.');
          return { entry, loci: lociFor([entry], matched)[0] };
        } });
      return bounded({ ...result, sceneId, revision, layers: listSceneLayers(plugin) });
    },
    named(args) {
      check(args, args.operation !== 'list');
      if (args.selectionVersion !== 1) fail('INVALID_SELECTION', 'selectionVersion must be 1.');
      if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') fail('INVALID_SELECTION', 'dryRun must be boolean.');
      let result;
      if (args.operation === 'list') {
        const { atoms } = resolve({ selectionVersion: 1, expression: { kind: 'all' } });
        result = { selections: bookmarks.list(new Set(atoms.map(idOf))) };
      } else if (args.operation === 'save') {
        const { matched } = resolve(args);
        result = bookmarks.save(args.name, new Set(matched.map(idOf)), args);
      } else if (args.operation === 'delete') result = bookmarks.remove(args.name, args.dryRun === true);
      else fail('INVALID_SELECTION', 'Named selection operation must be list, save or delete.');
      if (result.applied) changed();
      return { sceneId, revision, selectionVersion: 1, lifetime: 'viewer-instance', binding: 'frozen-atom-addresses', ...result };
    },
    measure(args) {
      check(args, true);
      const count = { distance: 2, angle: 3, dihedral: 4 }[args.measurement];
      if (!count || !Array.isArray(args.atomIds) || args.atomIds.length !== count
        || args.atomIds.some(id => typeof id !== 'string' || id.length > 512)
        || new Set(args.atomIds).size !== count) fail('INVALID_GEOMETRY', 'Supply exactly 2/3/4 distinct ordered atomIds for distance/angle/dihedral.');
      const { matched } = resolve({ selectionVersion: args.selectionVersion, expression: { ids: args.atomIds } });
      const byId = new Map(matched.map(atom => [idOf(atom), atom]));
      if (byId.size !== count) fail('UNKNOWN_ATOM', 'An endpoint no longer exists in this scene.');
      const endpoints = args.atomIds.map(id => ({ ...byId.get(id), id }));
      return { sceneId, revision, ...measureGeometry(args.measurement, endpoints) };
    },
    query(args) {
      const { offset, limit } = page(args);
      const { matched } = resolve(args);
      const atoms = matched.slice(offset, offset + limit).map(atom => ({ id: idOf(atom),
        ...Object.fromEntries([...fields].map(key => [key, atom[key] ?? null])), kind: atom.kind,
        position: atom.position?.every(Number.isFinite) ? atom.position : null,
      }));
      const result = { sceneId, revision, selectionVersion: 1, coordinateSpace: 'scene', units: 'angstrom', total: matched.length,
        offset, atoms, nextOffset: offset + atoms.length < matched.length ? offset + atoms.length : null };
      return bounded(result);
    },
    groups(args) {
      const { offset, limit } = page(args);
      const { atoms, matched } = resolve(args);
      const { total, groups } = groupExactAtoms(atoms, matched, args.groupBy, { offset, limit });
      return bounded({ sceneId, revision, selectionVersion: 1, groupBy: args.groupBy, groupScope: 'loaded-unit-instance',
        total, matchedAtoms: matched.length, offset, groups,
        nextOffset: offset + groups.length < total ? offset + groups.length : null });
    },
    select(args) {
      check(args, true);
      if (args.dryRun !== undefined && typeof args.dryRun !== 'boolean') fail('INVALID_SELECTION', 'dryRun must be boolean.');
      if (!['set', 'add', 'subtract', 'intersect'].includes(args.mode)) fail('INVALID_SELECTION', 'mode must be set, add, subtract or intersect.');
      const { atoms, matched, structures } = resolve(args);
      const current = currentIds(structures);
      const selected = new Set(matched.map(idOf));
      const next = atoms.filter(atom => {
        const id = idOf(atom);
        return args.mode === 'set' ? selected.has(id) : args.mode === 'add' ? selected.has(id) || current.has(id)
          : args.mode === 'subtract' ? current.has(id) && !selected.has(id) : current.has(id) && selected.has(id);
      });
      const before = lociFor(structures, atoms.filter(atom => current.has(idOf(atom))));
      const after = lociFor(structures, next);
      if (args.dryRun === true) return { sceneId, revision, applied: false, matchedCount: matched.length, selectedCount: next.length };
      const interactivity = plugin.managers.interactivity.lociSelects;
      const apply = loci => { interactivity.deselectAll(); for (const item of loci) interactivity.select({ loci: item }, false); };
      try { apply(after); }
      catch (error) { apply(before); throw error; }
      changed();
      return { sceneId, revision, applied: true, matchedCount: matched.length, selectedCount: next.length };
    },
  };
}

export const BuretteSelection = Object.freeze({
  forPlugin(plugin, source) {
    let controller = controllers.get(plugin);
    if (!controller) { controller = create(plugin, source); controllers.set(plugin, controller); }
    return controller;
  },
});
