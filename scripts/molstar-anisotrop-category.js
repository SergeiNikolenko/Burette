import { Column, Table } from '@molstar/core/data/db';
import { Mat3, Tensor } from '@molstar/core/math/linear-algebra';
import { tensorFieldNameGetter } from '@molstar/io/reader/cif/data-model';
import { CifWriter } from '@molstar/io/writer/cif';
import { mmCIF_Schema } from '@molstar/io/reader/cif/schema/mmcif';
import { AtomSiteAnisotrop } from '@molstar/model/formats/structure/property/anisotropic';
import { StructureProperties as P } from '@molstar/model/model/structure';

const components = [[0, 0], [1, 1], [2, 2], [0, 1], [0, 2], [1, 2]];

function readComponents(model, property, index, name) {
  const source = model.sourceData;
  if (source.kind === 'cifCore' && name === 'U') {
    // Core CIF's scalar columns already resolve dictionary aliases and retain masks.
    return components.map(([i, j]) => {
      const column = source.data.db.atom_site_aniso[`u_${i + 1}${j + 1}`];
      return { value: column.value(index), kind: column.valueKind(index) };
    });
  }
  const category = source.kind === 'mmCIF' ? source.data.frame.categories.atom_site_anisotrop : undefined;
  if (category) {
    const key = name;
    const getName = tensorFieldNameGetter(key, 2, category.fieldNames.includes(`${key}[0][0]`),
      category.fieldNames.includes(`${key}_11`) ? 'underscore' : 'brackets');
    return components.map(([i, j]) => {
      const field = category.getField(getName(i, j));
      return { value: field?.float(index) ?? 0, kind: field?.valueKind(index) ?? Column.ValueKind.NotPresent };
    });
  }
  // PDB ANISOU supplies complete tensors; absent provider columns remain absent.
  const column = property.data[name];
  const matrix = Tensor.toMat3(Mat3(), property.data._schema[name].space, column.value(index));
  return components.map(([i, j]) => ({ value: Mat3.getValue(matrix, i, j), kind: column.valueKind(index) }));
}

function transformComponents(values, coefficients, uncertainty) {
  const permutation = coefficients.every(row => row.filter(value => Math.abs(value) > 1e-10).length === 1
    && row.some(value => Math.abs(Math.abs(value) - 1) < 1e-10));
  // Marginal standard uncertainties cannot be mixed without component covariances.
  if (uncertainty && !permutation && values.some(value => value.kind === Column.ValueKind.Present)) {
    throw new Error('Cannot rotate anisotropic displacement uncertainties without their component covariance matrix.');
  }
  return coefficients.map(row => {
    let value = 0;
    let kind = Column.ValueKind.Present;
    row.forEach((coefficient, index) => {
      const component = values[index];
      if (component.kind !== Column.ValueKind.Present) {
        if (Math.abs(coefficient) < 1e-10) return;
        // Unknown takes precedence over not-present when several inputs contribute.
        kind = Math.max(kind, component.kind);
      } else {
        // The tolerance identifies a signed permutation for uncertainties; known U
        // contributions retain full precision, even for very small coefficients.
        if (uncertainty && Math.abs(coefficient) < 1e-10) return;
        value += (uncertainty ? Math.abs(coefficient) : coefficient) * component.value;
      }
    });
    return { value, kind };
  });
}

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
        const model = location.unit.model;
        // R U R^T is linear in the six independent symmetric components.
        const coefficients = components.map(([i, j]) => components.map(([a, b]) =>
          Mat3.getValue(rotation, i, a) * Mat3.getValue(rotation, j, b)
          + (a === b ? 0 : Mat3.getValue(rotation, i, b) * Mat3.getValue(rotation, j, a))));
        const tensors = {};
        for (const name of ['U', 'U_esd']) {
          tensors[name] = transformComponents(readComponents(model, property, index, name), coefficients, name === 'U_esd');
        }
        const suffix = location.unit.conformation.operator.suffix;
        rows.push({
          tensors,
          labelSeqKind: model.atomicHierarchy.residues.label_seq_id.valueKind(model.atomicHierarchy.residueAtomSegments.index[location.element]),
          values: {
            id: options?.keepId ? P.atom.id(location) : atomId,
            type_symbol: P.atom.type_symbol(location),
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
    const schema = Object.fromEntries(Object.entries(mmCIF_Schema.atom_site_anisotrop)
      .filter(([name]) => name !== 'U' && name !== 'U_esd'));
    const columns = {};
    for (const name of Object.keys(schema)) {
      columns[name] = Column.ofArray({
        schema: schema[name], array: rows.map(row => row.values[name]),
        valueKind: i => {
          const row = rows[i];
          if (name === 'pdbx_label_seq_id') return row.labelSeqKind;
          return Column.ValueKind.Present;
        },
      });
    }
    const category = CifWriter.Category.ofTable(Table.ofColumns(schema, columns));
    // Table tensor fields share a tensor-wide mask. Scalar fields retain each component's
    // original CIF missing/unknown marker, including after signed permutations.
    for (const name of ['U', 'U_esd']) {
      for (let i = 0; i < 3; ++i) for (let j = 0; j < 3; ++j) {
        const component = components.findIndex(([a, b]) => a === Math.min(i, j) && b === Math.max(i, j));
        category.fields.push(CifWriter.Field.float(`${name}[${i + 1}][${j + 1}]`,
          row => rows[row].tensors[name][component].value, {
            digitCount: 6,
            valueKind: row => rows[row].tensors[name][component].kind,
          }));
      }
    }
    return category;
  },
});
