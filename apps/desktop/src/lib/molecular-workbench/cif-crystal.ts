import { parseCifText } from "molstar/lib/mol-io/reader/cif/text/parser.js";
import type { CifBlock } from "molstar/lib/mol-io/reader/cif/data-model.js";
import { ELEMENT_SYMBOLS } from "./elements";
import { cartesianToFractional, cellFromParameters, fractionalToCartesian } from "./crystal";
import type { MolecularAtom, UnitCell, Vec3 } from "./types";

type SymmetryOperation = { rotation: UnitCell; translation: Vec3 };
const wrap = (value: number) => value - Math.floor(value);
function field(block: CifBlock, ...names: string[]) {
  // A flat CIF loop stores complete tags as categories with an empty field;
  // a dotted loop stores category + field. Reconstruct exact admitted tags.
  const admitted = new Set(names.map(name => name.toLowerCase()));
  let found: ReturnType<CifBlock["categories"][string]["getField"]>;
  for (const [categoryName, category] of Object.entries(block.categories)) {
    for (const key of category.fieldNames) {
      const tag = (key ? `${categoryName}.${key}` : categoryName).toLowerCase();
      if (!admitted.has(tag)) continue;
      const candidate = category.getField(key);
      if (!candidate) continue;
      if (found) {
        if (candidate.rowCount !== found.rowCount) throw new Error(`Conflicting CIF aliases for ${names[0]}.`);
        for (let row = 0; row < found.rowCount; row++) {
          if (candidate.str(row) !== found.str(row)) throw new Error(`Conflicting CIF aliases for ${names[0]}.`);
        }
      }
      found = candidate;
    }
  }
  return found;
}
function cifNumber(text: string): number {
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?:\(\d+\))?$/.test(text)) throw new Error(`Invalid or missing CIF number: ${text}`);
  const value = Number(text.replace(/\(\d+\)$/, ""));
  if (!Number.isFinite(value) || Math.abs(value) > 1e6) throw new Error("CIF numeric values exceed the supported range.");
  return value;
}
function rational(text: string) {
  const [numerator, denominator = "1"] = text.split("/");
  const value = Number(numerator) / Number(denominator);
  if (!Number.isFinite(value) || Math.abs(value) > 24) throw new Error("Invalid symmetry coefficient or translation.");
  return value;
}
function operation(expression: string): SymmetryOperation {
  const rows = expression.toLowerCase().replace(/\s/g, "").split(",");
  if (rows.length !== 3) throw new Error("A CIF symmetry operation must contain three coordinates.");
  const translation: Vec3 = [0, 0, 0];
  const rotation = rows.map((row, axis) => {
    const result: Vec3 = [0, 0, 0];
    const terms = row.match(/[+-]?[^+-]+/g);
    if (!terms || terms.join("") !== row) throw new Error("Invalid CIF symmetry expression.");
    for (const term of terms) {
      const variable = term.match(/^([+-]?)(?:(\d+(?:\/\d+)?)\*?)?([xyz])$/);
      if (variable) result["xyz".indexOf(variable[3])] += (variable[1] === "-" ? -1 : 1) * rational(variable[2] ?? "1");
      else if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:\/\d+)?$/.test(term)) translation[axis] += rational(term);
      else throw new Error("Unsupported CIF symmetry expression.");
    }
    return result;
  }) as UnitCell;
  if (rotation.some(row => row.some(value => !Number.isInteger(value)))) throw new Error("Nonintegral CIF rotation coefficients are not supported.");
  const [a, b, c] = rotation;
  const determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(Math.abs(determinant) - 1) > 1e-8) throw new Error("CIF symmetry rotations must preserve cell volume.");
  return { rotation, translation: translation.map(wrap) as Vec3 };
}
function apply(symmetry: SymmetryOperation, point: Vec3): Vec3 {
  return symmetry.rotation.map((row, axis) => row.reduce((sum, value, index) => sum + value * point[index], symmetry.translation[axis])) as Vec3;
}
// Operation rotations are exact integers. Compare translations periodically at
// their numerical precision, capped by 1e-5 Å; neighboring bins avoid rounding ties.
function operationSet(operations: SymmetryOperation[], cell: UnitCell) {
  const bins = Math.ceil(Math.max(1e10, cell.reduce((sum, vector) => sum + Math.hypot(...vector), 0) / 1e-5));
  const entries = new Map<string, Vec3>();
  const bucket = (op: SymmetryOperation, offset: number[]) => `${op.rotation.flat().join(",")}:${op.translation.map((v, i) => (Math.min(bins - 1, Math.floor(wrap(v) * bins)) + offset[i] + bins) % bins).join(",")}`;
  const has = (op: SymmetryOperation) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const translation = entries.get(bucket(op, [i, j, k]));
      if (!translation) continue;
      const delta = op.translation.map((v, axis) => { const d = wrap(v) - translation[axis]; return d - Math.round(d); }) as Vec3;
      if (delta.every(v => Math.abs(v) <= 1 / bins) && Math.hypot(...fractionalToCartesian(delta, cell)) <= 1e-5) return true;
    }
    return false;
  };
  const unique: SymmetryOperation[] = [];
  const identity = operation("x,y,z");
  for (const declared of operations) {
    const delta = declared.translation.map(v => wrap(v) - Math.round(wrap(v))) as Vec3;
    const op = declared.rotation.flat().every((v, i) => v === identity.rotation.flat()[i])
      && delta.every(v => Math.abs(v) <= 1 / bins) && Math.hypot(...fractionalToCartesian(delta, cell)) <= 1e-5 ? identity : declared;
    if (has(op)) continue;
    const key = bucket(op, [0, 0, 0]);
    if (entries.has(key)) throw new Error("CIF symmetry translations are numerically ambiguous at the supported precision.");
    entries.set(key, op.translation.map(wrap) as Vec3);
    unique.push(op);
  }
  return { has, size: entries.size, operations: unique };
}
function validateOperations(operations: SymmetryOperation[], cell: UnitCell, keys: ReturnType<typeof operationSet>) {
  if (!keys.has(operation("x,y,z"))) throw new Error("The CIF symmetry table is missing the identity operation.");
  const basis: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const dot = (a: Vec3, b: Vec3) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
  for (const op of operations) {
    const transformed = basis.map(point => fractionalToCartesian(op.rotation.map(row => dot(row, point)) as Vec3, cell));
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      if (Math.abs(dot(transformed[a], transformed[b]) - dot(cell[a], cell[b])) > 1e-3 * Math.hypot(...cell[a]) * Math.hypot(...cell[b])) throw new Error("The CIF symmetry operations do not match the unit-cell metric.");
    }
  }
  // A partial symmetry table is not a complete unit cell. Check closure modulo
  // integer lattice translations rather than silently expanding an incomplete set.
  for (const a of operations) for (const b of operations) {
    const rotation = a.rotation.map(row => [0, 1, 2].map(column => row.reduce((sum, value, index) => sum + value * b.rotation[index][column], 0))) as UnitCell;
    if (!keys.has({ rotation, translation: apply(a, b.translation) })) throw new Error("The CIF symmetry-operation table is incomplete.");
  }
}

// Numerical equality of the same fractional site, not a nearest-lattice search.
// The adaptive bins cap positional error at 1e-5 Å even for very large cells;
// the fractional cap keeps physically near but distinct skew-cell sites distinct.
function siteIdentity(cell: UnitCell) {
  const physicalTolerance = 1e-5;
  const bins = Math.ceil(Math.max(1e8, cell.reduce((sum, vector) => sum + Math.hypot(...vector), 0) / physicalTolerance));
  const tolerance = 1 / bins;
  const sites = new Map<string, { point: Vec3; symbol: string }>();
  return (point: Vec3, symbol: string) => {
    const bucket = point.map(value => Math.min(bins - 1, Math.floor(value * bins)));
    const key = (offset: number[]) => bucket.map((value, axis) => (value + offset[axis] + bins) % bins).join(",");
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const site = sites.get(key([i, j, k]));
      if (!site) continue;
      const delta = point.map((value, axis) => { const d = value - site.point[axis]; return d - Math.round(d); }) as Vec3;
      if (delta.some(value => Math.abs(value) > tolerance) || Math.hypot(...fractionalToCartesian(delta, cell)) > physicalTolerance) continue;
      if (site.symbol !== symbol) throw new Error("Different elements occupy the same CIF site.");
      return true;
    }
    const own = key([0, 0, 0]);
    // Same-bin points obey both bounds by construction; do not silently lose
    // either atom if floating-point ambiguity violates that invariant.
    if (sites.has(own)) throw new Error("CIF site coordinates are numerically ambiguous at the supported precision.");
    sites.set(own, { point, symbol });
    return false;
  };
}

/** Materializes explicit CIF symmetry; it does not guess a space-group database.
 * Fractional sites become Cartesian angstrom in stable source-row/operator order. */
export async function readCifCrystal(text: string, options: { block?: string } = {}) {
  if (text.length > 20_000_000) throw new Error("Crystal CIF input exceeds 20 MB.");
  const parsed = await parseCifText(text).run();
  if (parsed.isError) throw new Error(`Invalid CIF: ${parsed.message}`);
  const blocks = parsed.result.blocks.filter(block => field(block, "atom_site_fract_x", "atom_site.fract_x", "atom_site_Cartn_x", "atom_site.Cartn_x"));
  const block = options.block ? blocks.find(block => block.header === options.block) : blocks.length === 1 ? blocks[0] : undefined;
  if (!block) throw new Error(options.block ? "The selected CIF crystal block was not found." : "Choose one CIF crystal block containing atom coordinates.");
  const cellValues = ["length_a", "length_b", "length_c", "angle_alpha", "angle_beta", "angle_gamma"].map(name => {
    const value = field(block, `cell_${name}`, `cell.${name}`);
    if (!value || value.rowCount !== 1) throw new Error("The CIF unit-cell parameters are incomplete.");
    return cifNumber(value.str(0));
  });
  const [a, b, c, alpha, beta, gamma] = cellValues;
  const cell = cellFromParameters({ a, b, c, alpha, beta, gamma });
  const symops = field(block, "space_group_symop_operation_xyz", "space_group_symop.operation_xyz", "symmetry_equiv_pos_as_xyz", "symmetry_equiv.pos_as_xyz");
  const groupNumber = field(block, "space_group_IT_number", "space_group.IT_number", "symmetry_Int_Tables_number", "symmetry.Int_Tables_number")?.str(0);
  const groupName = field(block, "space_group_name_H-M_alt", "space_group.name_H-M_alt", "symmetry_space_group_name_H-M", "symmetry.space_group_name_H-M")?.str(0);
  if (groupNumber && groupNumber !== "." && groupNumber !== "?") {
    const number = cifNumber(groupNumber);
    if (!Number.isInteger(number) || number < 1 || number > 230) throw new Error("The CIF space-group number must be between 1 and 230.");
    if (groupName && ![".", "?"].includes(groupName) && (number === 1) !== (groupName.replace(/\s/g, "").toUpperCase() === "P1")) throw new Error("The CIF space-group name and number disagree.");
  }
  if (!symops && !(groupNumber === "1" || groupName?.replace(/\s/g, "").toUpperCase() === "P1")) throw new Error("Provide explicit symmetry operations for a non-P1 or unspecified space group.");
  if (symops && (symops.rowCount < 1 || symops.rowCount > 384)) throw new Error("CIF symmetry operations exceed the supported limit.");
  const declaredOperations = symops ? Array.from({ length: symops.rowCount }, (_, index) => operation(symops.str(index))) : [operation("x,y,z")];
  const keys = operationSet(declaredOperations, cell);
  const operations = keys.operations;
  if (groupNumber && groupNumber !== "." && groupNumber !== "?" && ((cifNumber(groupNumber) === 1) !== (keys.size === 1))) throw new Error("The symmetry table disagrees with the CIF space-group number.");
  if (groupName && ![".", "?"].includes(groupName) && groupName.replace(/\s/g, "").toUpperCase() === "P1"
    && (keys.size !== 1 || !keys.has(operation("x,y,z")))) throw new Error("The symmetry table disagrees with the CIF P1 space-group name.");
  validateOperations(operations, cell, keys);
  const fractions = ["x", "y", "z"].map(axis => field(block, `atom_site_fract_${axis}`, `atom_site.fract_${axis}`));
  const fractional = fractions.every(Boolean);
  if (!fractional && fractions.some(Boolean)) throw new Error("The CIF fractional coordinates are incomplete.");
  const coordinates = fractional ? fractions : ["x", "y", "z"].map(axis => field(block, `atom_site_Cartn_${axis}`, `atom_site.Cartn_${axis}`));
  if (!coordinates.every(Boolean)) throw new Error("The CIF atom coordinates are incomplete.");
  const count = coordinates[0]!.rowCount;
  if (!count || count > 100_000 || count * operations.length > 500_000 || coordinates.some(value => value!.rowCount !== count)) throw new Error("CIF symmetry expansion exceeds the atom budget or has inconsistent coordinate rows.");
  const types = field(block, "atom_site_type_symbol", "atom_site.type_symbol");
  const labels = field(block, "atom_site_label", "atom_site.label", "atom_site.label_atom_id");
  const occupancies = field(block, "atom_site_occupancy", "atom_site.occupancy");
  const disorder = [field(block, "atom_site_disorder_group", "atom_site.disorder_group"), field(block, "atom_site_disorder_assembly", "atom_site.disorder_assembly"), field(block, "atom_site_label_alt_id", "atom_site.label_alt_id")].filter(Boolean);
  if ([types, labels, occupancies, ...disorder].some(value => value && value.rowCount !== count)) throw new Error("CIF atom metadata has inconsistent row counts.");
  const atoms: MolecularAtom[] = [], sourceAtomIndices: number[] = [], atomLabels: string[] = [];
  const alreadyPresent = siteIdentity(cell);
  for (let row = 0; row < count; row++) {
    const occupancy = occupancies ? cifNumber(occupancies.str(row)) : 1;
    if (occupancy === 0) continue;
    if (Math.abs(occupancy - 1) > 1e-8 || disorder.some(value => !["", ".", "?", "0"].includes(value!.str(row)))) throw new Error("Resolve partially occupied or disordered CIF sites before building a supercell.");
    const type = types?.str(row), label = labels?.str(row) ?? `Atom${row + 1}`;
    const symbol = type ? type.match(/^([A-Z][a-z]?)(?:\d*[+-])?$/)?.[1] : label.match(/^([A-Z][a-z]?)(?:\d.*|$)/)?.[1];
    if (!symbol || !ELEMENT_SYMBOLS.includes(symbol)) throw new Error(`CIF site ${label} has an unsupported or ambiguous element.`);
    const point = coordinates.map(value => cifNumber(value!.str(row))) as Vec3;
    const fraction = (fractional ? point : cartesianToFractional(point, cell)).map(wrap) as Vec3;
    for (const op of operations) {
      const transformed = apply(op, fraction).map(wrap) as Vec3;
      if (alreadyPresent(transformed, symbol)) continue;
      if (atoms.length >= 100_000) throw new Error("CIF symmetry expansion exceeds the 100000-atom limit.");
      const [x, y, z] = fractionalToCartesian(transformed, cell);
      atoms.push({ element: symbol, x, y, z }); sourceAtomIndices.push(row); atomLabels.push(label);
    }
  }
  if (!atoms.length) throw new Error("The CIF has no fully occupied atom sites.");
  return { atoms, cell, title: block.header, sourceAtomIndices, atomLabels };
}
