import type { PeptideGeometry } from "./peptide-geometry";

/** Saves named atoms, physical coordinates, formal charges and explicit bonds. */
export function peptideMmcif(model: PeptideGeometry): string {
  const chain = model.atoms[0].chain;
  const residues = [...new Map(model.atoms.map(atom => [atom.residueNumber, atom.residue])).entries()];
  const components = [...new Set(residues.map(([, name]) => name))];
  // A mixed D/L chain is not declared to be an all-L polypeptide. The generic
  // peptide component type and each atom's 3D coordinates retain its chemistry.
  const polymerType = model.chirality.every(value => value === "L") ? "polypeptide(L)" : model.chirality.every(value => value === "D") ? "polypeptide(D)" : "other";
  const lines = [
    "data_peptide", "_entry.id peptide", "_exptl.entry_id peptide", '_exptl.method "THEORETICAL MODEL"',
    "_entity.id 1", "_entity.type polymer", "_entity_poly.entity_id 1", `_entity_poly.type '${polymerType}'`,
    `_entity_poly.pdbx_strand_id ${chain}`, "_entity_poly.nstd_linkage no", "_entity_poly.nstd_monomer yes",
    "loop_", "_entity_poly_seq.entity_id", "_entity_poly_seq.num", "_entity_poly_seq.mon_id", "_entity_poly_seq.hetero",
    ...residues.map(([number, name]) => `1 ${number} ${name} n`), "#",
    `_struct_asym.id ${chain}`, "_struct_asym.entity_id 1", "loop_", "_chem_comp.id", "_chem_comp.type",
    ...components.map(name => `${name} 'peptide linking'`), "#",
    "loop_", "_chem_comp_bond.comp_id", "_chem_comp_bond.atom_id_1", "_chem_comp_bond.atom_id_2", "_chem_comp_bond.value_order", "_chem_comp_bond.pdbx_aromatic_flag",
  ];
  const bonds = new Map<string, string>();
  for (const bond of model.bonds) {
    const a = model.atoms[bond.a], b = model.atoms[bond.b];
    if (a.residueNumber !== b.residueNumber) continue;
    const key = `${a.residue}:${[a.name, b.name].sort().join(":")}`;
    bonds.set(key, `${a.residue} ${a.name} ${b.name} ${bond.order === 2 ? "DOUB" : "SING"} N`);
  }
  lines.push(...bonds.values(), "#", "loop_", ...[
    "group_PDB", "id", "type_symbol", "label_atom_id", "label_alt_id", "label_comp_id", "label_asym_id", "label_entity_id", "label_seq_id",
    "pdbx_PDB_ins_code", "Cartn_x", "Cartn_y", "Cartn_z", "occupancy", "B_iso_or_equiv", "pdbx_formal_charge", "auth_seq_id", "auth_comp_id", "auth_asym_id", "auth_atom_id", "pdbx_PDB_model_num",
  ].map(field => `_atom_site.${field}`));
  model.atoms.forEach((atom, index) => lines.push(`ATOM ${index + 1} ${atom.element} ${atom.name} . ${atom.residue} ${chain} 1 ${atom.residueNumber} ? ${atom.position.map(value => value.toFixed(10)).join(" ")} 1 0 ${atom.charge} ${atom.residueNumber} ${atom.residue} ${chain} ${atom.name} 1`));
  // A component dictionary alone still permits distance-based bonds between
  // residues. Write every explicit bond, including peptide links, and the native
  // exact atom-id table so close nonbonded contacts never become connectivity.
  lines.push("#", "loop_", "_struct_conn.id", "_struct_conn.conn_type_id",
    ...[1, 2].flatMap(partner => ["label_asym_id", "label_comp_id", "label_seq_id", "label_atom_id", "symmetry"].map(field => `_struct_conn.ptnr${partner}_${field}`)), "_struct_conn.pdbx_value_order");
  model.bonds.forEach((bond, index) => {
    const a = model.atoms[bond.a], b = model.atoms[bond.b];
    lines.push(`bond${index + 1} covale ${chain} ${a.residue} ${a.residueNumber} ${a.name} 1_555 ${chain} ${b.residue} ${b.residueNumber} ${b.name} 1_555 ${bond.order === 2 ? "DOUB" : "SING"}`);
  });
  lines.push("#", "loop_", "_molstar_bond_site.atom_id_1", "_molstar_bond_site.atom_id_2", "_molstar_bond_site.value_order", "_molstar_bond_site.type_id",
    ...model.bonds.map(bond => `${bond.a + 1} ${bond.b + 1} ${bond.order === 2 ? "DOUB" : "SING"} covale`));
  return lines.join("\n") + "\n#\n";
}
