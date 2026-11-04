import { Column, Table } from '@molstar/core/data/db';
import { Mat3, Tensor } from '@molstar/core/math/linear-algebra';
import { CifWriter } from '@molstar/io/writer/cif';
import { mmCIF_Schema } from '@molstar/io/reader/cif/schema/mmcif';
import { AtomSiteAnisotrop } from '@molstar/model/formats/structure/property/anisotropic';
import { StructureProperties as P } from '@molstar/model/model/structure';

export const currentAtomSiteAnisotrop = (options) => ({
  name: 'atom_site_anisotrop',
  instance({ structures }) {
    const rows = [];
    let atomId = 0;
    for (const structure of structures) {
      const locations = structure.elementLocations();
      while (locations.hasNext) {
        const location = locations.move();
        ++atomId;
        const property = AtomSiteAnisotrop.Provider.get(location.unit.model);
        const index = property?.elementToAnsiotrop[location.element];
        if (index === undefined || index < 0) continue;
        const rotation = Mat3.fromMat4(Mat3(), location.unit.conformation.operator.matrix);
        const identityRotation = rotation.every((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) < 1e-10);
        let uncertainty = property.data.U_esd.value(index);
        if (!identityRotation && property.data.U_esd.isDefined && property.data.U_esd.valueKind(index) === 0) {
          // U_esd contains marginal standard uncertainties, not a covariance tensor.
          // Signed permutations map each component to exactly one source component;
          // signs disappear for standard deviations. General rotations mix components
          // and require their unavailable covariances, so explicitly refuse those.
          const permutation = [];
          for (let i = 0; i < 3; ++i) {
            const axis = [0, 1, 2].find(j => Math.abs(Math.abs(Mat3.getValue(rotation, i, j)) - 1) < 1e-10);
            if (axis === undefined || permutation.includes(axis)
              || [0, 1, 2].some(j => j !== axis && Math.abs(Mat3.getValue(rotation, i, j)) >= 1e-10)) {
              throw new Error('Cannot rotate anisotropic displacement uncertainties without their component covariance matrix.');
            }
            permutation.push(axis);
          }
          const errors = Tensor.toMat3(Mat3(), property.data._schema.U_esd.space, uncertainty);
          Mat3.symmtricFromLower(errors, errors);
          const errorSpace = mmCIF_Schema.atom_site_anisotrop.U_esd.space;
          uncertainty = errorSpace.create();
          for (let i = 0; i < 3; ++i) for (let j = 0; j < 3; ++j) {
            errorSpace.set(uncertainty, i, j, Mat3.getValue(errors, permutation[i], permutation[j]));
          }
        }
        const u = Tensor.toMat3(Mat3(), property.data._schema.U.space, property.data.U.value(index));
        Mat3.symmtricFromLower(u, u);
        const rotated = Mat3.mul(Mat3(), Mat3.mul(Mat3(), rotation, u), Mat3.transpose(Mat3(), rotation));
        const space = mmCIF_Schema.atom_site_anisotrop.U.space;
        const tensor = space.create();
        for (let i = 0; i < 3; ++i) for (let j = 0; j < 3; ++j) space.set(tensor, i, j, Mat3.getValue(rotated, i, j));
        const model = location.unit.model;
        const suffix = location.unit.conformation.operator.suffix;
        rows.push({
          index, property,
          labelSeqKind: model.atomicHierarchy.residues.label_seq_id.valueKind(model.atomicHierarchy.residueAtomSegments.index[location.element]),
          values: {
            id: options?.keepId ? P.atom.id(location) : atomId,
            type_symbol: P.atom.type_symbol(location), U: tensor,
            U_esd: uncertainty,
            pdbx_auth_seq_id: P.residue.auth_seq_id(location),
            pdbx_auth_asym_id: P.chain.auth_asym_id(location) + suffix,
            pdbx_auth_atom_id: P.atom.auth_atom_id(location),
            pdbx_auth_comp_id: P.atom.auth_comp_id(location),
            pdbx_label_seq_id: P.residue.label_seq_id(location),
            pdbx_label_alt_id: P.atom.label_alt_id(location),
            pdbx_label_asym_id: P.chain.label_asym_id(location) + suffix,
            pdbx_label_atom_id: P.atom.label_atom_id(location),
            pdbx_label_comp_id: P.atom.label_comp_id(location),
            pdbx_PDB_ins_code: P.residue.pdbx_PDB_ins_code(location),
          },
        });
      }
    }
    if (!rows.length) return CifWriter.Category.Empty;
    const schema = mmCIF_Schema.atom_site_anisotrop;
    const columns = {};
    for (const name of Object.keys(schema)) {
      columns[name] = Column.ofArray({
        schema: schema[name], array: rows.map(row => row.values[name]),
        valueKind: i => {
          const row = rows[i];
          if (name === 'U' || name === 'U_esd') return row.property.data[name].valueKind(row.index);
          if (name === 'pdbx_label_seq_id') return row.labelSeqKind;
          return Column.ValueKind.Present;
        },
      });
    }
    return CifWriter.Category.ofTable(Table.ofColumns(schema, columns));
  },
});
