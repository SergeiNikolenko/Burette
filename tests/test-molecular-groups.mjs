import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupExactAtoms } from '../scripts/molecular-groups.js';

test('metadata truncation does not truncate group membership or counts', () => {
  const atoms = Array.from({ length: 10 }, (_, i) => ({ structureId: 's', modelId: 'm', unitId: 0,
    residue_index: 4, chain_index: 1, label_comp_id: `name-${i}` }));
  const result = groupExactAtoms(atoms, atoms.slice(0, 1), 'residue', { offset: 0, limit: 1 });
  assert.equal(result.total, 1);
  const row = result.groups[0];
  assert.deepEqual(row.metadata.label_comp_id, { values: atoms.slice(0, 8).map(atom => atom.label_comp_id), truncated: true });
  assert.equal(row.matchedAtoms, 1);
  assert.equal(row.wholeGroupAtoms, 10);
  assert.equal(row.partial, true);
  assert.equal(atoms.filter(atom => Object.entries(row.groupExpression.fields).every(([key, value]) => atom[key] === value)).length, 10);
  assert.deepEqual(groupExactAtoms(atoms, atoms, 'residue', { offset: 1, limit: 1 }), { total: 1, groups: [] });
});
