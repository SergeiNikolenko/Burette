import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BuretteSelection } from '../scripts/molstar-selection-facade.js';
import { OrderedSet } from 'molstar/lib/mol-data/int.js';
import { StructureElement } from 'molstar/lib/mol-model/structure.js';

function emitter() {
  const listeners = new Set();
  return { subscribe(fn) { listeners.add(fn); return { unsubscribe: () => listeners.delete(fn) }; }, next() { for (const fn of listeners) fn(); } };
}

function fixture() {
  const event = emitter();
  const changed = () => event.next();
  const cameraEvents = [emitter(), emitter(), emitter()];
  const moveCamera = () => { for (const cameraEvent of cameraEvents) cameraEvent.next(); };
  const entries = ['object-a', 'object-b'].map(ref => ({ ref, data: { elementCount: 4,
    units: [1, 2].map(id => ({ id, kind: 0, model: { id: 'model-1' }, elements: Int32Array.from([0, 1]) })),
  } }));
  const atoms = entries.flatMap(entry => entry.data.units.flatMap(unit => [...unit.elements].map(atom_index => ({
    structureId: entry.ref, modelId: unit.model.id, unitId: unit.id, atom_index, modelIndex: 1,
    instance_id: `operator-${unit.id}`, kind: 'protein', label_asym_id: 'A', auth_asym_id: 'X',
    label_seq_id: 10, auth_seq_id: 100, label_alt_id: atom_index === 0 ? 'A' : 'B',
    occupancy: atom_index === 0 ? 0 : 0.5, position: [unit.id, atom_index, 0], residue_index: 0, chain_index: 0,
  }))));
  const selected = new Map();
  const calls = [];
  const selection = { events: { changed: event }, getLoci: structure => selected.get(structure) ?? StructureElement.Loci(structure, []) };
  const interactivity = {
    deselectAll() { selected.clear(); changed(); },
    select({ loci }, granularity) { calls.push(granularity); selected.set(loci.structure, loci); changed(); },
  };
  const plugin = { state: { data: { events: { changed: event } } }, managers: { structure: { selection }, interactivity: { lociSelects: interactivity } },
    canvas3d: { camera: { stateChanged: cameraEvents[0], changed: cameraEvents[1] } }, events: { canvas3d: { settingsUpdated: cameraEvents[2] } } };
  const controller = BuretteSelection.forPlugin(plugin, { structures: () => entries, atoms: () => atoms });
  const query = (expression, extra = {}) => controller.query({ selectionVersion: 1, expression, ...extra });
  const select = (expression, mode = 'set', extra = {}) => controller.select({ selectionVersion: 1, expression, mode,
    sceneId: controller.state().sceneId, expectedRevision: controller.state().revision, ...extra });
  const selectedAtoms = () => [...selected.values()].flatMap(loci => loci.elements.flatMap(element => {
    const result = [];
    OrderedSet.forEach(element.indices, i => result.push([entries.find(entry => entry.data === loci.structure).ref, element.unit.id, element.unit.elements[i]]));
    return result;
  }));
  return { controller, query, select, selectedAtoms, calls, changed, moveCamera, atoms, entries, interactivity };
}

test('strict namespaces, zero occupancy, altloc and object/operator identities', () => {
  const f = fixture();
  assert.equal(f.query({ fields: { auth_asym_id: 'A' } }).total, 0);
  assert.equal(f.query({ fields: { auth_seq_id: 10 } }).total, 0);
  const found = f.query({ allOf: [{ kind: 'all' }, { fields: { structureId: 'object-b', unitId: 2, label_alt_id: 'A', occupancy: 0 } }] });
  assert.equal(found.total, 1);
  assert.deepEqual(JSON.parse(found.atoms[0].id), ['object-b', 'model-1', 2, 0]);
  assert.equal(found.atoms[0].occupancy, 0);
  assert.equal(f.query({ not: { fields: { label_alt_id: 'A' } } }).total, 4);
  assert.equal(f.query({ anyOf: [{ fields: { unitId: 1 } }, { fields: { unitId: 2 } }] }).total, 8);
  assert.equal(f.query({ fields: { pdbx_PDB_ins_code: '' } }).total, 8);
  delete f.atoms[0].auth_asym_id;
  assert.equal(f.query({ fields: { auth_asym_id: 'A' } }).total, 0, 'Missing author namespace does not fall back');
  f.controller.dispose();
});

test('fixed revision pages fail on UI mutation and new scene', () => {
  const f = fixture();
  const first = f.query({ kind: 'all' }, { limit: 2 });
  const second = f.query({ kind: 'all' }, { limit: 2, offset: first.nextOffset, sceneId: first.sceneId, expectedRevision: first.revision });
  assert.equal(second.atoms.length, 2);
  assert.notEqual(second.atoms[0].id, first.atoms[0].id);
  assert.throws(() => f.query({ kind: 'all' }, { offset: 2 }), /sceneId/);
  f.changed();
  assert.throws(() => f.query({ kind: 'all' }, { offset: 2, sceneId: first.sceneId, expectedRevision: first.revision }), /scene changed/);
  assert.throws(() => f.select({ kind: 'all' }, 'set', { sceneId: crypto.randomUUID() }), /sceneId/);
  f.controller.dispose();
});

test('camera motion and canvas settings do not invalidate atom references', () => {
  const f = fixture();
  const applied = f.select({ fields: { structureId: 'object-a', unitId: 1, atom_index: 0 } });
  // Focus/reset animations emit camera events on every frame, and Mol* refits
  // the camera one frame after a new representation is committed.
  for (let frame = 0; frame < 60; frame++) f.moveCamera();
  assert.equal(f.controller.state().revision, applied.revision);
  const chained = f.select({ fields: { structureId: 'object-b' } }, 'add',
    { sceneId: applied.sceneId, expectedRevision: applied.revision });
  assert.equal(chained.applied, true);
  f.changed();
  assert.throws(() => f.select({ kind: 'all' }, 'set', { sceneId: chained.sceneId, expectedRevision: chained.revision }),
    { code: 'STALE_REVISION' });
  f.controller.dispose();
});

test('group pages preserve loaded instances, partial filters and full-group selectors', () => {
  const f = fixture();
  const expression = { fields: { occupancy: 0 } };
  const args = { selectionVersion: 1, groupBy: 'residue', expression, limit: 2 };
  const first = f.controller.groups(args);
  const second = f.controller.groups({ ...args, offset: first.nextOffset, sceneId: first.sceneId, expectedRevision: first.revision });
  assert.equal(first.total, 4);
  assert.equal(second.nextOffset, null);
  const rows = [...first.groups, ...second.groups];
  assert.equal(new Set(rows.map(row => row.id)).size, 4);
  for (const row of rows) {
    assert.equal(row.matchedAtoms, 1);
    assert.equal(row.wholeGroupAtoms, 2);
    assert.equal(row.partial, true);
    assert.equal(f.query(row.groupExpression).total, row.wholeGroupAtoms);
    assert.equal(f.query({ allOf: [expression, row.groupExpression] }).total, row.matchedAtoms);
  }
  f.atoms[0].label_comp_id = 'CYS'; f.atoms[1].label_comp_id = 'SER';
  assert.deepEqual(f.controller.groups(args).groups[0].metadata.label_comp_id.values, ['CYS', 'SER']);
  assert.equal(f.controller.groups({ ...args, groupBy: 'chain' }).total, 4);
  f.changed();
  assert.throws(() => f.controller.groups({ ...args, offset: 2, sceneId: first.sceneId, expectedRevision: first.revision }), /scene changed/);
  assert.throws(() => f.controller.groups({ ...args, groupBy: 'label' }), /groupBy/);
  delete f.atoms[0].residue_index;
  assert.throws(() => f.controller.groups(args), /exact group index/);
  f.controller.dispose();
});

test('hierarchy indices, not author or label residue names, define groups', () => {
  const f = fixture();
  f.atoms[0].residue_index = 1; f.atoms[0].pdbx_PDB_ins_code = 'A';
  f.atoms[1].pdbx_PDB_ins_code = 'B'; f.atoms[1].label_seq_id = undefined;
  const result = f.controller.groups({ selectionVersion: 1, groupBy: 'residue', expression: { kind: 'all' } });
  assert.equal(result.total, 5);
  assert.notEqual(result.groups[0].id, result.groups[1].id);
  assert.deepEqual(result.groups[1].metadata.label_seq_id.values, [null]);
  f.controller.dispose();
});

test('spatial expressions include the cutoff and expand only loaded group instances', () => {
  const f = fixture();
  const of = { fields: { structureId: 'object-a', unitId: 1, atom_index: 0 } };
  const nearby = { within: { radiusAngstrom: 1, of } };
  assert.equal(f.query(nearby).total, 6);
  const center = { within: { radiusAngstrom: 0.99, of } };
  assert.equal(f.query(center).total, 2, 'Spatial selection keeps explicit zero-occupancy atoms and self');
  assert.equal(f.query({ byResidue: center }).total, 4);
  assert.equal(f.query({ byChain: { allOf: [center, { fields: { structureId: 'object-b' } }] } }).total, 2);
  assert.equal(f.query({ allOf: [nearby, { not: of }] }).total, 5);
  f.select(center);
  assert.deepEqual(f.selectedAtoms(), [['object-a', 1, 0], ['object-b', 1, 0]]);
  for (const within of [{ of, radiusAngstrom: 0 }, { of, radiusAngstrom: 1, extra: true }, { radiusAngstrom: 1 }, false]) {
    assert.throws(() => f.query({ within }));
  }
  assert.throws(() => f.query({ allOf: Array(5).fill(center) }), /spatial nodes/);
  f.controller.dispose();
});

test('current uses real selection state while named selections freeze addresses and fence revisions', () => {
  const f = fixture();
  assert.equal(f.query({ current: true }).total, 0);
  assert.throws(() => f.query({ current: false }), /current must be true/);
  f.select({ fields: { structureId: 'object-a', unitId: 1, atom_index: 0 } });
  const target = f.query({ current: true });
  assert.equal(target.total, 1);
  const args = { selectionVersion: 1, sceneId: target.sceneId, expectedRevision: target.revision,
    operation: 'save', name: 'site', expression: { current: true } };
  assert.equal(f.controller.named({ ...args, dryRun: true }).applied, false);
  assert.equal(f.controller.state().revision, target.revision);
  const saved = f.controller.named(args);
  assert.ok(saved.revision > target.revision);
  assert.throws(() => f.controller.named(args), /scene changed/);
  f.select({ fields: { structureId: 'object-b', unitId: 2, atom_index: 1 } });
  assert.notEqual(f.query({ current: true }).atoms[0].id, target.atoms[0].id);
  assert.deepEqual(f.query({ named: 'site' }).atoms, target.atoms);
  assert.equal(f.query({ within: { radiusAngstrom: 0.01, of: { named: 'site' } } }).total, 2);
  f.atoms[0].atom_index = 99;
  assert.throws(() => f.query({ named: 'site' }), { code: 'STALE_SELECTION' });
  assert.deepEqual(f.controller.named({ selectionVersion: 1, operation: 'list' }).selections,
    [{ name: 'site', atomCount: 1, availableAtoms: 0, status: 'stale' }]);
  f.controller.named({ selectionVersion: 1, sceneId: saved.sceneId, expectedRevision: f.controller.state().revision, operation: 'delete', name: 'site' });
  assert.throws(() => f.query({ named: 'site' }), { code: 'UNKNOWN_SELECTION' });
  f.controller.dispose();
});

test('spatial nodes share a work budget and never truncate large reference sets', () => {
  const f = fixture();
  const template = f.atoms[0];
  f.entries.splice(1);
  f.entries[0].data.units.splice(1);
  const populate = count => {
    f.atoms.splice(0, f.atoms.length, ...Array.from({ length: count }, (_, atom_index) => ({ ...template, atom_index,
      label_asym_id: atom_index < 1000 ? 'R1' : atom_index < 2000 ? 'R2' : 'T',
      position: atom_index < 2000 ? [0, 0, 0] : [0.9, 0.9, 0.9] })));
    f.entries[0].data.elementCount = count;
    f.entries[0].data.units[0].elements = Int32Array.from({ length: count }, (_, i) => i);
  };
  populate(3000);
  const expressions = ['R1', 'R2'].map(label_asym_id => ({ within: { radiusAngstrom: 1, of: { fields: { label_asym_id } } } }));
  for (const expression of expressions) assert.equal(f.query(expression).total, 2000);
  assert.throws(() => f.query({ anyOf: expressions }), { code: 'WORK_LIMIT' });
  populate(5001);
  assert.throws(() => f.query({ within: { radiusAngstrom: 1, of: { kind: 'all' } } }), { code: 'INPUT_LIMIT' });
  f.controller.dispose();
});

test('exact loci set/add/subtract/intersect retain object and symmetry instance', () => {
  const f = fixture();
  assert.equal(f.select({ fields: { structureId: 'object-b', unitId: 2, atom_index: 1 } }).selectedCount, 1);
  assert.deepEqual(f.selectedAtoms(), [['object-b', 2, 1]]);
  assert.equal(f.select({ fields: { structureId: 'object-a', atom_index: 0 } }, 'add').selectedCount, 3);
  assert.equal(f.select({ fields: { unitId: 1 } }, 'subtract').selectedCount, 2);
  assert.equal(f.select({ fields: { structureId: 'object-a' } }, 'intersect').selectedCount, 1);
  assert.deepEqual(f.selectedAtoms(), [['object-a', 2, 0]]);
  assert.ok(f.calls.every(granularity => granularity === false));
  const before = f.controller.state();
  assert.equal(f.select({ kind: 'all' }, 'set', { dryRun: true }).applied, false);
  assert.deepEqual(f.controller.state(), before);
  assert.deepEqual(f.selectedAtoms(), [['object-a', 2, 0]]);
  f.controller.dispose();
});

test('invalid and oversized inputs fail before mutation; failed application rolls back', () => {
  const f = fixture();
  f.select({ fields: { atom_index: 1 } });
  const selected = f.selectedAtoms();
  assert.throws(() => f.select({ kind: 'all' }, 'set', { dryRun: 'true' }), /boolean/);
  assert.deepEqual(f.selectedAtoms(), selected);
  for (const expression of [{}, { typo: 1 }, { fields: { auth_se_id: 1 } }, { anyOf: [] }, { kind: 'unknown' }]) {
    assert.throws(() => f.select(expression));
    assert.deepEqual(f.selectedAtoms(), selected);
  }
  const originalSelect = f.interactivity.select;
  let once = true;
  f.interactivity.select = (...args) => { if (once) { once = false; throw new Error('render failed'); } originalSelect(...args); };
  assert.throws(() => f.select({ kind: 'all' }), /render failed/);
  assert.deepEqual(f.selectedAtoms(), selected);
  f.entries[0].data.units[1].kind = 1;
  assert.throws(() => f.query({ kind: 'all' }), /atomic units/);
  f.entries[0].data.units[1].kind = 0;
  f.entries[0].data.elementCount++;
  assert.throws(() => f.query({ kind: 'all' }), /entirely atomic/);
  f.entries[0].data.elementCount = 250001;
  assert.throws(() => f.query({ kind: 'all' }), /never truncated/);
  f.controller.dispose();
});
