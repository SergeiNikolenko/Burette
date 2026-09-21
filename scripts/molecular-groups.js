// Groups are loaded Mol* unit instances, not reconstructed biological entities.
export function groupExactAtoms(atoms, matched, groupBy, { offset, limit }) {
  if (!['residue', 'chain'].includes(groupBy)) throw Object.assign(new Error('groupBy must be residue or chain.'), { code: 'INVALID_GROUP' });
  const indexKey = `${groupBy}_index`;
  const metadataKeys = ['instance_id', 'label_entity_id', 'label_asym_id', 'auth_asym_id', 'kind',
    ...(groupBy === 'residue' ? ['label_seq_id', 'auth_seq_id', 'pdbx_PDB_ins_code', 'label_comp_id', 'auth_comp_id'] : [])];
  const selected = new Set(matched);
  const groups = new Map();
  const idOf = atom => JSON.stringify([groupBy, atom.structureId, atom.modelId, atom.unitId, atom[indexKey]]);
  for (const atom of atoms) {
    const index = atom[indexKey];
    if (!Number.isInteger(index) || index < 0) throw Object.assign(new Error('Loaded atomic hierarchy has no exact group index.'), { code: 'INVALID_GROUP' });
    const id = idOf(atom);
    let group = groups.get(id);
    if (!group) {
      group = { id, first: atom, matchedAtoms: 0, wholeGroupAtoms: 0 };
      groups.set(id, group);
    }
    group.wholeGroupAtoms++;
    if (selected.has(atom)) group.matchedAtoms++;
  }
  let total = 0;
  const page = new Map();
  for (const group of groups.values()) {
    if (!group.matchedAtoms) continue;
    if (total++ < offset || page.size >= limit) continue;
    const atom = group.first;
    page.set(group.id, { id: group.id,
      groupExpression: { fields: { structureId: atom.structureId, modelId: atom.modelId, unitId: atom.unitId, [indexKey]: atom[indexKey] } },
      selectionScope: 'whole-loaded-group', matchedAtoms: group.matchedAtoms, wholeGroupAtoms: group.wholeGroupAtoms,
      partial: group.matchedAtoms < group.wholeGroupAtoms,
      metadata: Object.fromEntries(metadataKeys.map(key => [key, { values: [], truncated: false }])) });
  }
  // Aggregate verbose metadata only for the requested page, not every group.
  for (const atom of atoms) {
    const group = page.get(idOf(atom));
    if (!group) continue;
    for (const key of metadataKeys) {
      const values = group.metadata[key];
      const value = atom[key] ?? null;
      if (values.values.includes(value)) continue;
      if (values.values.length < 8) values.values.push(value);
      else values.truncated = true;
    }
  }
  return { total, groups: [...page.values()] };
}
